import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/panel/admin/orders/new?since=<ISO>
// Admin paneli sesli bildirim için yoklar: bayilerden (admin rolü dışındaki
// kullanıcılardan) gelen ve `since` anından sonra oluşturulan siparişler.
// `since` verilmezse yalnızca en son siparişin zamanı (başlangıç noktası) döner.
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!s.isAdmin) return forbidden();

  const admin = createAdminClient();
  const sinceRaw = new URL(req.url).searchParams.get("since");
  const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;

  // admin rolündeki kullanıcılar (kendi siparişleri bildirim üretmez)
  const { data: adminRoles } = await admin.from("roles").select("id").eq("name", "admin");
  const adminRoleIds = (adminRoles ?? []).map((r) => r.id);
  const adminIds = new Set<string>([s.id]);
  if (adminRoleIds.length) {
    const { data: admins } = await admin.from("profiles").select("id").in("role_id", adminRoleIds);
    for (const a of admins ?? []) adminIds.add(a.id);
  }

  let q = admin
    .from("orders")
    .select("id, user_id, total_count, total_cost, source, status, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  // since değeri veritabanındaki created_at'in kendisidir (mikrosaniye hassasiyeti korunur)
  if (Number.isFinite(sinceMs)) q = q.gt("created_at", sinceRaw!);
  if (adminIds.size) q = q.not("user_id", "in", `(${[...adminIds].join(",")})`);
  const { data: rows } = await q;

  const list = rows ?? [];
  const uids = [...new Set(list.map((o) => o.user_id))];
  const names = new Map<string, string>();
  if (uids.length) {
    const { data: profiles } = await admin.from("profiles").select("id, username, name").in("id", uids);
    for (const p of profiles ?? []) names.set(p.id, p.name || p.username);
  }

  const orders = Number.isFinite(sinceMs)
    ? list.map((o) => ({
        id: o.id,
        dealer: names.get(o.user_id) ?? "",
        totalCount: o.total_count,
        totalCost: o.total_cost,
        source: o.source,
        status: o.status,
        createdAt: o.created_at,
      }))
    : [];

  return ok({
    latest: list[0]?.created_at ?? (Number.isFinite(sinceMs) ? sinceRaw : null),
    serverTime: new Date().toISOString(),
    count: orders.length,
    orders,
  });
}
