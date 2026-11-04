import { after } from "next/server";
import { authenticateApiRequest } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCorsHeaders } from "@/lib/cors";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;

const SendSchema = z.object({
  recipients: z.array(z.string()).min(1).max(5000),
  message: z.string().min(1).max(918),
  schedule_at: z.string().optional(),
  callback_url: z.string().url().optional(),
});

// POST /api/v1/sms/send
export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return applyCorsHeaders(
      Response.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code }),
      req
    );
  }

  // imza modu (opsiyonel)
  const sig = req.headers.get("x-signature");
  if (sig) {
    const raw = await req.clone().text();
    const { verifyHmacSignature } = await import("@/lib/auth");
    const valid = await verifyHmacSignature(auth.apiKeyId, raw, sig);
    if (!valid) {
      return applyCorsHeaders(
        Response.json({ success: false, code: 401, message: "İmza doğrulaması başarısız." }, { status: 401 }),
        req
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return applyCorsHeaders(
      Response.json({ success: false, code: 400, message: "Geçersiz JSON." }, { status: 400 }),
      req
    );
  }
  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) {
    return applyCorsHeaders(
      Response.json(
        { success: false, code: 422, message: parsed.error.errors[0]?.message || "Geçersiz istek." },
        { status: 422 }
      ),
      req
    );
  }
  const { recipients, message, schedule_at, callback_url } = parsed.data;

  const { createOrder } = await import("@/lib/services");
  const idemKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");

  // callback URL'i API anahtarına kaydet (varsa, DLR için)
  if (callback_url) {
    try {
      const admin = createAdminClient();
      await admin.from("api_keys").update({ callback_url }).eq("id", auth.apiKeyId);
    } catch {
      // callback kaydı başarısız olsa da gönderim devam eder
    }
  }

  const result = await createOrder({
    userId: auth.userId,
    recipients,
    message,
    scheduleAt: schedule_at ?? null, // boş: hemen; dolu: o an gelince Sempico'ya gönderilir
    source: "api",
    idempotencyKey: idemKey,
    viaServiceRole: true, // çerez yok; RPC service_role + p_user_id ile çağrılır
  });

  if (!result.ok) {
    return applyCorsHeaders(
      Response.json({ success: false, code: result.code, message: result.error }, { status: result.code }),
      req
    );
  }

  // sipariş kaydedildi → zamanı gelmişse hemen Sempico API ile gönder (ileri tarihliler beklemede kalır)
  after(async () => {
    const { sendOrderNow } = await import("@/lib/services");
    await sendOrderNow(250);
  });

  return applyCorsHeaders(
    Response.json(
      {
        success: true,
        code: 202,
        message: "Mesaj kuyruğa alındı.",
        data: {
          order_id: result.orderId,
          status: result.status,
          total_count: result.totalCount,
          segments: result.segments,
          encoding: result.encoding,
          total_cost: result.totalCost,
          balance_after: result.balanceAfter,
          scheduled_at: result.scheduledAt,
          blacklisted_count: result.blacklistedCount,
        },
      },
      { status: 202 }
    ),
    req
  );
}
