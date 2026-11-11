import { z } from "zod";
import { after } from "next/server";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { createOrder, sendOrderNow } from "@/lib/services";
import { parseRecipients } from "@/lib/sms-segments";
import { parseTurkeyDateTime } from "@/lib/timezone";
import { ok, accepted, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";
export const maxDuration = 30;

// SMS kampanyaları (orders).
//   GET    ?id=          → kampanya detayı (sayaçlar, API yanıtları, denemeler) · ?export=csv
//   GET    ?status=&q=   → liste (draft/scheduled/pending/processing/completed/partial/failed/cancelled)
//   POST   {mode:"send"} → kampanya oluştur (Hemen Gönder / İleri Tarihte Gönder)
//   POST   {mode:"draft"}→ taslak kaydet (bakiye rezervi yok) · draftId ile güncelle
//   POST   {mode:"send", draftId} → taslağı gönder
//   PATCH  {id, name?, message?, scheduleAt?} → zamanlanmış kampanyayı düzenle (gönderim başlamadan)
//   DELETE ?id=          → iptal (gönderilmemiş mesajlar iade edilir)

const RPC_ERRORS: Record<string, { msg: string; code: number }> = {
  ORDER_NOT_EDITABLE: { msg: "Gönderimi başlamış ya da zamanlanmamış kampanya düzenlenemez.", code: 409 },
  SCHEDULE_IN_PAST: { msg: "Gönderim zamanı şu andan (oluşturma saatinden) sonra olmalıdır.", code: 422 },
  INSUFFICIENT_BALANCE: { msg: "Yetersiz bakiye: yeni mesajın ücret farkı karşılanamıyor.", code: 402 },
  EMPTY_MESSAGE: { msg: "Mesaj boş olamaz.", code: 400 },
  ORDER_NOT_FOUND: { msg: "Kampanya bulunamadı.", code: 404 },
  NO_PERMISSION: { msg: "Yetkiniz yok.", code: 403 },
  AUTH_REQUIRED: { msg: "Oturum gerekli.", code: 401 },
};
function rpcError(message: string) {
  const key = Object.keys(RPC_ERRORS).find((k) => message.includes(k));
  const e = key ? RPC_ERRORS[key] : { msg: message, code: 400 };
  return Response.json({ success: false, code: e.code, message: e.msg }, { status: e.code });
}

const isUuid = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

// GET: liste (?id= ile detay)
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();

  const admin = createAdminClient();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const { data: order } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
    if (!order || (!s.isAdmin && order.user_id !== s.id)) {
      return Response.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
    }
    const { data: messages } = await admin
      .from("sms_messages")
      .select("id, recipient, status, segments, cost, attempts, error_code, provider_message_id, provider_response, sent_at, last_attempt_at, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true })
      .limit(1000);

    // CSV dışa aktarım (?export=csv)
    if (url.searchParams.get("export") === "csv") {
      const esc = (v: unknown) => `"${String(typeof v === "object" && v !== null ? JSON.stringify(v) : v ?? "").replace(/"/g, '""')}"`;
      const lines = [
        "recipient;status;segments;cost;attempts;error_code;provider_message_id;sent_at;provider_response;created_at",
        ...(messages ?? []).map((m) =>
          [m.recipient, m.status, m.segments, m.cost, m.attempts, m.error_code, m.provider_message_id, m.sent_at, m.provider_response, m.created_at]
            .map(esc).join(";")
        ),
      ];
      return new Response("﻿" + lines.join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="kampanya-${id}.csv"`,
        },
      });
    }

    // sayaçlar (mesaj durumlarından; iptal/pencere dışı iadeler "gönderilemedi" sayılmaz)
    const ms = messages ?? [];
    const cancelledCodes = new Set(["ORDER_CANCELLED", "OUTSIDE_SENDING_WINDOW"]);
    const successCount = ms.filter((m) => m.status === "sent" || m.status === "delivered").length;
    const failedCount = ms.filter((m) => m.status === "failed" || (m.status === "refunded" && !cancelledCodes.has(String(m.error_code ?? "")))).length;
    const dispatchedCount = ms.filter((m) => (m.attempts ?? 0) > 0).length; // API'ye iletilen
    const deliveredCount = ms.filter((m) => m.status === "delivered").length;

    const { data: attempts } = await admin
      .from("sms_send_attempts")
      .select("id, message_id, attempt, ok, outcome, provider, http_status, error_code, provider_message_id, response, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    const recipientById = new Map(ms.map((m) => [m.id, m.recipient]));

    const editable = order.status === "scheduled" && !order.provider_triggered_at && ms.every((m) => m.status === "queued");

    return Response.json({
      success: true,
      code: 200,
      message: "OK",
      data: {
        order: {
          id: order.id,
          name: order.name ?? null,
          status: order.status,
          totalCount: order.total_count,
          processedCount: order.processed_count,
          failedCount: order.failed_count,
          dispatchedCount,
          successCount,
          deliveredCount,
          unsentFailedCount: failedCount,
          totalCost: order.total_cost,
          message: order.message,
          note: order.note,
          scheduledAt: order.scheduled_at,
          providerScheduledAt: order.provider_scheduled_at ?? null,
          providerTimezone: order.provider_timezone ?? "UTC",
          providerTriggeredAt: order.provider_triggered_at ?? null,
          dispatchFinishedAt: order.dispatch_finished_at ?? null,
          lastProviderResponse: order.last_provider_response ?? null,
          draftPayload: order.status === "draft" ? order.draft_payload ?? null : null,
          editable,
          source: order.source,
          createdAt: order.created_at,
        },
        messages: ms.map((m) => ({
          id: m.id,
          recipient: m.recipient,
          status: m.status,
          segments: m.segments,
          cost: m.cost,
          attempts: m.attempts,
          errorCode: m.error_code,
          providerMessageId: m.provider_message_id,
          providerResponse: m.provider_response ?? null,
          sentAt: m.sent_at,
          createdAt: m.created_at,
        })),
        attempts: (attempts ?? []).map((a) => ({
          id: a.id,
          recipient: recipientById.get(a.message_id) ?? "",
          attempt: a.attempt,
          ok: a.ok,
          outcome: a.outcome,
          provider: a.provider,
          httpStatus: a.http_status,
          errorCode: a.error_code,
          providerMessageId: a.provider_message_id,
          response: a.response,
          createdAt: a.created_at,
        })),
      },
    });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("perPage") || 10)));
  const statusParam = url.searchParams.get("status") || "";
  const search = (url.searchParams.get("q") || "").trim();
  const sort = url.searchParams.get("sort") === "scheduled" ? "scheduled_at" : "created_at";

  let q = admin.from("orders").select("*", { count: "exact" });
  if (!s.isAdmin) q = q.eq("user_id", s.id);
  const statuses = statusParam.split(",").map((x) => x.trim()).filter(Boolean);
  if (statuses.length === 1) q = q.eq("status", statuses[0]);
  else if (statuses.length > 1) q = q.in("status", statuses);
  const safeSearch = search.replace(/[%,()]/g, "");
  if (search) q = q.or(`name.ilike.%${safeSearch}%,message.ilike.%${safeSearch}%`);

  // admin: filtreye uyan "Gönderildi" yapılabilir (bekleyen) kampanya sayısı → "Hepsini seç"
  const DELIVERABLE = ["pending", "scheduled", "processing"];
  const deliverableStatuses = statuses.length ? DELIVERABLE.filter((x) => statuses.includes(x)) : DELIVERABLE;
  const deliverableCountPromise =
    s.isAdmin && deliverableStatuses.length
      ? (() => {
          let dq = admin.from("orders").select("id", { head: true, count: "exact" }).in("status", deliverableStatuses);
          if (search) dq = dq.or(`name.ilike.%${safeSearch}%,message.ilike.%${safeSearch}%`);
          return Promise.resolve(dq).then((r) => r.count ?? 0);
        })()
      : Promise.resolve(0);

  const [{ count, data }, deliverableTotal] = await Promise.all([
    q.order(sort, { ascending: sort === "scheduled_at" }).range((page - 1) * perPage, page * perPage - 1),
    deliverableCountPromise,
  ]);

  const rows = (data ?? []).map((o) => ({
    id: o.id,
    name: o.name ?? null,
    status: o.status,
    totalCount: o.total_count,
    processedCount: o.processed_count,
    failedCount: o.failed_count,
    totalCost: o.total_cost,
    message: o.message,
    note: o.note,
    scheduledAt: o.status === "draft" ? ((o.draft_payload as { scheduleAt?: string } | null)?.scheduleAt ?? null) : o.scheduled_at,
    providerScheduledAt: o.provider_scheduled_at ?? null,
    providerTimezone: o.provider_timezone ?? "UTC",
    providerTriggeredAt: o.provider_triggered_at ?? null,
    dispatchFinishedAt: o.dispatch_finished_at ?? null,
    source: o.source,
    username: "",
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  }));

  // admin görünümünde kullanıcı adlarını ekle
  if (s.isAdmin && rows.length) {
    const uids = [...new Set(data!.map((o) => o.user_id))];
    const { data: profiles } = await admin.from("profiles").select("id, username").in("id", uids);
    const map = new Map((profiles ?? []).map((p) => [p.id, p.username]));
    for (const r of rows) {
      const o = data!.find((x) => x.id === r.id);
      r.username = map.get(o!.user_id) ?? "";
    }
  }

  return Response.json({
    success: true,
    code: 200,
    message: "OK",
    data: rows,
    meta: { total: count ?? 0, page, perPage, ...(s.isAdmin ? { deliverableTotal } : {}) },
  });
}

const CreateSchema = z.object({
  mode: z.enum(["send", "draft"]).optional(),
  draftId: z.string().uuid().optional(),
  name: z.string().max(120, "Kampanya adı en fazla 120 karakter.").optional(),
  numbers: z.string().optional(),
  message: z.string().min(1, "Mesaj gerekli."),
  contactListId: z.string().uuid().optional(),
  scheduleAt: z.string().optional(),
  shortUrl: z.string().url().optional(),
  shortUrlBusiness: z.string().optional(),
});

// POST: kampanya oluştur / taslak kaydet / taslağı gönder
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "sms.send")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Geçersiz JSON.");
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
  const b = parsed.data;
  const user = await createUserClient(); // RPC'ler auth.uid() ister

  // ---- taslak kaydet (bakiye rezervi yapılmaz, sağlayıcıya gönderilmez)
  if (b.mode === "draft") {
    const { data, error } = await user.rpc("rpc_save_order_draft", {
      p_name: b.name ?? null,
      p_message: b.message,
      p_payload: {
        numbers: b.numbers ?? "",
        contactListId: b.contactListId ?? null,
        scheduleAt: b.scheduleAt ?? null,
        shortUrl: b.shortUrl ?? null,
        shortUrlBusiness: b.shortUrlBusiness ?? null,
      },
      p_draft_id: b.draftId ?? null,
    });
    if (error) return rpcError(error.message);
    const d = data as { order_id: string; total_count: number };
    return ok({ orderId: d.order_id, status: "draft", totalCount: d.total_count }, "Taslak kaydedildi.");
  }

  // ---- gönderim zamanı kontrolü (İleri Tarihte Gönder: oluşturma saatinden sonra olmalı)
  if (b.scheduleAt) {
    const iso = parseTurkeyDateTime(b.scheduleAt);
    if (!iso) return badRequest("Geçersiz gönderim tarihi.");
    if (Date.parse(iso) <= Date.now()) {
      return Response.json({ success: false, code: 422, message: RPC_ERRORS.SCHEDULE_IN_PAST.msg }, { status: 422 });
    }
  }

  // taslaktan gönderiliyorsa sahiplik kontrolü
  const admin = createAdminClient();
  if (b.draftId) {
    const { data: draft } = await admin.from("orders").select("id, user_id, status").eq("id", b.draftId).maybeSingle();
    if (!draft || draft.user_id !== s.id || draft.status !== "draft") {
      return Response.json({ success: false, code: 404, message: "Taslak bulunamadı." }, { status: 404 });
    }
  }

  // kısa URL oluşturup mesaja ekle
  let message = b.message;
  if (b.shortUrl) {
    const { data: su } = await user.rpc("rpc_create_short_url", {
      p_original_url: b.shortUrl,
      p_business_name: b.shortUrlBusiness || "",
      p_slug: Math.random().toString(36).slice(2, 9),
    });
    if (su?.slug) {
      const base = process.env.APP_URL || "";
      message = `${message} ${base}/s/${su.slug}`;
    }
  }

  const recipients = b.contactListId ? [] : parseRecipients(b.numbers || "");
  // Kampanya bazlı tekrar koruması: istemci form başına sabit bir anahtar gönderir;
  // aynı anahtarla gelen ikinci istek (çift tıklama, ağ tekrarı) yeni kampanya OLUŞTURMAZ.
  const idemKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key") || (b.draftId ? `draft-${b.draftId}` : null);

  const result = await createOrder({
    userId: s.id,
    recipients,
    message,
    scheduleAt: b.scheduleAt || null,
    source: "panel",
    idempotencyKey: idemKey,
    contactListId: b.contactListId || null,
  });

  if (!result.ok) {
    return Response.json({ success: false, code: result.code, message: result.error }, { status: result.code });
  }

  if (b.name?.trim()) {
    await admin.from("orders").update({ name: b.name.trim() }).eq("id", result.orderId).eq("user_id", s.id);
  }
  // taslak gönderildi: taslak kaydı gerçek kampanyaya dönüştüğü için kaldırılır
  if (b.draftId) {
    await admin.from("orders").delete().eq("id", b.draftId).eq("user_id", s.id).eq("status", "draft");
  }

  // kampanya kaydedildi → zamanı gelmişse hemen ENKYRYS API ile gönder (ileri tarihliler beklemede kalır)
  after(() => sendOrderNow(250));

  const { data: saved } = await admin
    .from("orders")
    .select("status, scheduled_at, created_at, provider_scheduled_at")
    .eq("id", result.orderId)
    .maybeSingle();
  // panel gecikmesi (0021): "hemen gönder" kampanyası N dakika sonra sağlayıcıya gider
  const delayMin =
    saved && !b.scheduleAt && saved.status === "pending" && saved.scheduled_at && saved.created_at
      ? Math.round((Date.parse(saved.scheduled_at) - Date.parse(saved.created_at)) / 60_000)
      : 0;

  return accepted({
    orderId: result.orderId,
    status: saved?.status ?? result.status,
    totalCount: result.totalCount,
    total: result.totalCount,
    blacklistedCount: result.blacklistedCount,
    invalidCount: result.invalidCount,
    segments: result.segments,
    encoding: result.encoding,
    unitPrice: result.unitPrice,
    totalCost: result.totalCost,
    balanceAfter: result.balanceAfter,
    scheduledAt: saved?.scheduled_at ?? result.scheduledAt,
    providerScheduledAt: saved?.provider_scheduled_at ?? null,
    sendDelayMinutes: delayMin,
  }, saved?.status === "scheduled"
    ? "Kampanya zamanlandı."
    : delayMin > 0
      ? `Kampanya oluşturuldu, ${delayMin} dakika sonra gönderilecek.`
      : "Kampanya oluşturuldu, gönderim başlatıldı.");
}

const PatchSchema = z.object({
  id: z.string().uuid("Geçersiz kampanya id."),
  name: z.string().max(120).optional(),
  message: z.string().optional(),
  scheduleAt: z.string().optional(),
});

// PATCH: zamanlanmış kampanyayı gönderim başlamadan önce düzenle
export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "sms.send") && !s.isAdmin) return forbidden();

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
  const b = parsed.data;

  let scheduleIso: string | null = null;
  if (b.scheduleAt) {
    scheduleIso = parseTurkeyDateTime(b.scheduleAt);
    if (!scheduleIso) return badRequest("Geçersiz gönderim tarihi.");
  }

  const user = await createUserClient();
  const { data, error } = await user.rpc("rpc_update_scheduled_order", {
    p_order_id: b.id,
    p_name: b.name ?? null,
    p_message: b.message ?? null,
    p_schedule_at: scheduleIso,
  });
  if (error) return rpcError(error.message);
  return ok(data, "Zamanlanmış kampanya güncellendi.");
}

// DELETE: iptal — gönderilmemiş mesajların rezervi rpc_cancel_order ile iade edilir (taslak da iptal edilir)
export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "sms.send") && !s.isAdmin) return forbidden();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id gerekli.");
  if (!isUuid(id)) return badRequest("Geçersiz kampanya id.");

  const user = await createUserClient();
  const { data, error } = await user.rpc("rpc_cancel_order", { p_order_id: id });
  if (error) return rpcError(error.message);

  const d = data as { status?: string; refunded?: number; cancelled_messages?: number };
  if (d.status === "already_settled") return badRequest("Bu kampanya zaten sonuçlanmış; iptal edilemez.");
  return ok(
    { cancelled: true, refunded: d.refunded ?? 0, cancelledMessages: d.cancelled_messages ?? 0 },
    "Kampanya iptal edildi; gönderilmemiş mesajların bedeli iade edildi."
  );
}
