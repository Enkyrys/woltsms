import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden, badRequest, fail } from "@/lib/api-response";

export const runtime = "nodejs";

// Sağlayıcı API'sini tek tuşla aç / kapat (admin).
//   API AÇIK  → panelden gelen kampanyalar gecikme (vars. 5 dk) sonunda sağlayıcıya gönderilir.
//   API KAPALI → hiçbir sağlayıcı aktif değildir; bekleyen kampanyalar süre (vars. 5 dk) dolunca
//               otomatik "Gönderildi" olur ya da admin listeden seçip onaylar.
// Kapatırken o an aktif olan sağlayıcı `last_active_provider` ayarına yazılır; açınca o geri gelir.

const LAST_KEY = "last_active_provider";

type ProviderRow = { provider: string; is_active: boolean; credentials_encrypted: string | null; updated_at: string };

async function readState() {
  const admin = createAdminClient();
  const [{ data: rows }, { data: settings }, { count: pending }] = await Promise.all([
    admin.from("provider_settings").select("provider, is_active, credentials_encrypted, updated_at").order("updated_at", { ascending: false }),
    admin.from("system_settings").select("key, value").in("key", [LAST_KEY, "panel_send_delay_minutes", "auto_approve_minutes"]),
    admin.from("orders").select("id", { head: true, count: "exact" }).in("status", ["pending", "scheduled", "processing"]),
  ]);
  const list = (rows ?? []) as ProviderRow[];
  const map = new Map((settings ?? []).map((r) => [r.key as string, String(r.value)]));
  const active = list.find((r) => r.is_active) ?? null;
  const minutes = (k: string) => {
    const n = Number(map.get(k));
    return Number.isFinite(n) && n >= 0 ? n : 5;
  };
  return {
    list,
    lastProvider: map.get(LAST_KEY) || null,
    state: {
      active: Boolean(active),
      provider: active?.provider ?? null,
      lastProvider: map.get(LAST_KEY) || null,
      configured: list.map((r) => r.provider),
      sendDelayMinutes: minutes("panel_send_delay_minutes"),
      autoApproveMinutes: minutes("auto_approve_minutes"),
      pendingCount: pending ?? 0,
    },
  };
}

export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!s.isAdmin && !hasPermissionSync(s, "provider.view")) return forbidden();
  const { state } = await readState();
  return ok(state);
}

const Schema = z.object({ on: z.boolean({ required_error: "on (true/false) gerekli." }) });

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!s.isAdmin && !hasPermissionSync(s, "provider.manage")) return forbidden();

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz istek.");
  const { on } = parsed.data;

  const admin = createAdminClient();
  const { list, lastProvider, state } = await readState();

  if (!on) {
    if (!state.active) return ok((await readState()).state, "API zaten kapalı.");
    await admin
      .from("system_settings")
      .upsert(
        { key: LAST_KEY, value: state.provider!, description: "API kapatılmadan önce aktif olan sağlayıcı (API Aç ile geri gelir)" },
        { onConflict: "key" }
      );
    const { error } = await admin.from("provider_settings").update({ is_active: false }).eq("is_active", true);
    if (error) return fail(500, `API kapatılamadı: ${error.message}`);
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "provider.api_off", payload: { provider: state.provider } as never });
    return ok((await readState()).state, "API kapatıldı. Bekleyen kampanyalar süre dolunca otomatik Gönderildi olur.");
  }

  if (state.active) return ok(state, "API zaten açık.");

  // açılacak sağlayıcı: kapatılmadan önceki → yoksa kimlik bilgisi kayıtlı en son güncellenen gerçek sağlayıcı
  const target =
    (lastProvider && list.find((r) => r.provider === lastProvider)) ||
    list.find((r) => r.provider !== "mock" && r.credentials_encrypted) ||
    null;
  if (!target) {
    return fail(409, "Açılacak sağlayıcı bulunamadı. Önce Sistem > Entegrasyonlar'dan sağlayıcıyı kaydedin.");
  }

  // aynı anda tek aktif sağlayıcı (benzersiz indeks): önce diğerleri kapatılır
  await admin.from("provider_settings").update({ is_active: false }).neq("provider", target.provider);
  const { error } = await admin.from("provider_settings").update({ is_active: true }).eq("provider", target.provider);
  if (error) return fail(500, `API açılamadı: ${error.message}`);
  await admin.from("audit_logs").insert({ actor_id: s.id, action: "provider.api_on", payload: { provider: target.provider } as never });
  return ok((await readState()).state, `API açıldı (${target.provider}). Bekleyen kampanyalar sağlayıcıya gönderilecek.`);
}
