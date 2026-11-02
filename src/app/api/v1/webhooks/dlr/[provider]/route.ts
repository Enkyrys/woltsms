import { applyCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderByName } from "@/lib/providers";
import { applyDlr } from "@/lib/services";
import { timingSafeEqualStr } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 15;

// Gatum REST API DLR: POST /api/v1/webhooks/dlr/{provider}
//   JSON dizisi: [{id_state, phone, state, time, error, ...}, ...]
//   (+ API_KEY header; hesapta onay modu açıksa yanıt gövdesi
//    onaylanan id_state'lerden oluşan JSON dizisi olmalı)
// Eski tekil nesne / query-string varyantları da desteklenir.
async function handle(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await ctx.params;
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());

  // POST gövdesi: dizi (REST API) veya nesne (eski varyant)
  let payload: unknown = raw;
  if (req.method === "POST") {
    const text = await req.text();
    try {
      const parsed: unknown = JSON.parse(text);
      payload = Array.isArray(parsed) ? parsed : { ...raw, ...(parsed as Record<string, unknown>) };
    } catch {
      // query parametreleri yeterli
    }
  }

  const admin = createAdminClient();

  // doğrulama: sağlayıcının security key'i API_KEY header'ı olarak gelir
  const provider = await getProviderByName(providerName);
  if (!provider) {
    await admin.from("webhook_logs").insert({
      direction: "inbound",
      url: `/api/v1/webhooks/dlr/${providerName}`,
      payload: (payload ?? raw) as never,
      response_code: 404,
    });
    return Response.json({ error: "unknown provider" }, { status: 404 });
  }

  // ek doğrulama: WEBHOOK_SECRET env varsa (opsiyonel ikinci katman)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const given = url.searchParams.get("secret") || req.headers.get("x-webhook-secret") || "";
    if (!timingSafeEqualStr(webhookSecret, given)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  const items = provider.parseDlrWebhook(payload, headers);

  // idempotent uygulama
  const results: unknown[] = [];
  for (const item of items) {
    const r = await applyDlr(item.providerMessageId, item.status === "delivered" ? "DELIVRD" : item.status === "failed" ? "UNDELIV" : "ENROUTE", item.errorCode, item.time);
    results.push(r);
  }

  await admin.from("webhook_logs").insert({
    direction: "inbound",
    url: `/api/v1/webhooks/dlr/${providerName}`,
    payload: (payload ?? raw) as never,
    response_code: 200,
  });

  // Gatum onay modu: 200 + gövde = onaylanan id_state'lerin JSON dizisi
  if (providerName === "gatum") {
    return Response.json(items.map((i) => i.providerMessageId), { status: 200 });
  }
  return applyCorsHeaders(
    Response.json({ success: true, code: 200, message: "OK", data: { processed: results.length } }),
    req
  );
}

// Gatum DLR'ı GET ile gönderir; diğer sağlayıcılar için POST da açıktır.
export const GET = handle;
export const POST = handle;
