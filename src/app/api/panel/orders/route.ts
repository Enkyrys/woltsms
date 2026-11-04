import { z } from "zod";
import { after } from "next/server";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { createOrder, sendOrderNow } from "@/lib/services";
import { parseRecipients } from "@/lib/sms-segments";
import { ok, accepted, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: sipariş listesi (?id= ile detay)
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
      .select("id, recipient, status, segments, cost, error_code, provider_message_id, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true })
      .limit(1000);

    // CSV dışa aktarım (?export=csv)
    if (new URL(req.url).searchParams.get("export") === "csv") {
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [
        "recipient;status;segments;cost;error_code;provider_message_id;created_at",
        ...(messages ?? []).map((m) =>
          [m.recipient, m.status, m.segments, m.cost, m.error_code, m.provider_message_id, m.created_at]
            .map(esc).join(";")
        ),
      ];
      return new Response("\uFEFF" + lines.join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="siparis-${id}.csv"`,
        },
      });
    }
    return Response.json({
      success: true,
      code: 200,
      message: "OK",
      data: {
        order: {
          id: order.id,
          status: order.status,
          totalCount: order.total_count,
          processedCount: order.processed_count,
          failedCount: order.failed_count,
          totalCost: order.total_cost,
          message: order.message,
          note: order.note,
          scheduledAt: order.scheduled_at,
          providerScheduledAt: order.provider_scheduled_at ?? null,
          providerTimezone: order.provider_timezone ?? "UTC",
          providerTriggeredAt: order.provider_triggered_at ?? null,
          source: order.source,
          createdAt: order.created_at,
        },
        messages: (messages ?? []).map((m) => ({
          id: m.id,
          recipient: m.recipient,
          status: m.status,
          segments: m.segments,
          cost: m.cost,
          errorCode: m.error_code,
          providerMessageId: m.provider_message_id,
          createdAt: m.created_at,
        })),
      },
    });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("perPage") || 10)));
  const status = url.searchParams.get("status") || "";

  let q = admin.from("orders").select("*", { count: "exact" });
  if (!s.isAdmin) q = q.eq("user_id", s.id);
  if (status) q = q.eq("status", status);
  const { count, data } = await q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const rows = (data ?? []).map((o) => ({
    id: o.id,
    status: o.status,
    totalCount: o.total_count,
    processedCount: o.processed_count,
    failedCount: o.failed_count,
    totalCost: o.total_cost,
    message: o.message,
    note: o.note,
    scheduledAt: o.scheduled_at,
    providerScheduledAt: o.provider_scheduled_at ?? null,
    providerTimezone: o.provider_timezone ?? "UTC",
    providerTriggeredAt: o.provider_triggered_at ?? null,
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
    meta: { total: count ?? 0, page, perPage },
  });
}

const CreateSchema = z.object({
  numbers: z.string().optional(),
  message: z.string().min(1, "Mesaj gerekli."),
  contactListId: z.string().uuid().optional(),
  scheduleAt: z.string().optional(),
  shortUrl: z.string().url().optional(),
  shortUrlBusiness: z.string().optional(),
});

// POST: sipariş oluştur (rpc_create_order ile atomik)
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

  // kısa URL oluşturup mesaja ekle
  let message = b.message;
  if (b.shortUrl) {
    const user = await createUserClient(); // rpc_create_short_url auth.uid() ister
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
  const idemKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");

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

  // sipariş veritabanına kaydedildi → hemen Sempico API ile gönder
  // (RPC durum olarak "ok" döndürür; önceki "pending" kontrolü hiç tutmuyordu)
  after(() => sendOrderNow(250));

  return accepted({
    orderId: result.orderId,
    status: result.status,
    totalCount: result.totalCount,
    total: result.totalCount,
    blacklistedCount: result.blacklistedCount,
    invalidCount: result.invalidCount,
    segments: result.segments,
    encoding: result.encoding,
    unitPrice: result.unitPrice,
    totalCost: result.totalCost,
    balanceAfter: result.balanceAfter,
    scheduledAt: result.scheduledAt,
  }, "Sipariş oluşturuldu.");
}

// DELETE: sipariş iptali — gönderilmemiş mesajların rezervi rpc_cancel_order ile iade edilir
export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "sms.send") && !s.isAdmin) return forbidden();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id gerekli.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("Geçersiz sipariş id.");

  const user = await createUserClient();
  const { data, error } = await user.rpc("rpc_cancel_order", { p_order_id: id });
  if (error) return badRequest(error.message);

  const d = data as { status?: string; refunded?: number; cancelled_messages?: number };
  if (d.status === "already_settled") return badRequest("Bu sipariş zaten sonuçlanmış; iptal edilemez.");
  return ok(
    { cancelled: true, refunded: d.refunded ?? 0, cancelledMessages: d.cancelled_messages ?? 0 },
    "Sipariş iptal edildi; gönderilmemiş mesajların bedeli iade edildi."
  );
}
