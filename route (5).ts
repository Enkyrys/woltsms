import { applyCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderByName } from "@/lib/providers";
import { applyDlr } from "@/lib/services";
import { timingSafeEqualStr } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 15;

// Gatum DLR: GET /api/v1/webhooks/dlr/{provider}?id_state=&state=&time=&error=
// (+ API_KEY header; onay modunda yanıt gövdesi id_state olmalı)
async function handle(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await ctx.params;
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());

  // POST varyantı da desteklenir
  let body: Record<string, unknown> = raw;
  if (req.method === "POST") {
    const text = await req.text();
    try {
      body = { ...raw, ...(JSON.parse(text) as Record<string, unknown>) };
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
      payload: body as never,
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

  const items = provider.parseDlrWebhook(body, headers);

  // idempotent uygulama
  const results: unknown[] = [];
  for (const item of items) {
    const r = await applyDlr(item.providerMessageId, item.status === "delivered" ? "DELIVRD" : item.status === "failed" ? "UNDELIV" : "ENROUTE", item.errorCode, item.time);
    results.push(r);
  }

  await admin.from("webhook_logs").insert({
    direction: "inbound",
    url: `/api/v1/webhooks/dlr/${providerName}`,
    payload: body as never,
    response_code: 200,
  });

  // Gatum onay modu: 200 + gövde = id_state
  const idState = String(body["id_state"] ?? body["idState"] ?? "");
  if (idState && providerName === "gatum") {
    return new Response(idState, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return applyCorsHeaders(
    Response.json({ success: true, code: 200, message: "OK", data: { processed: results.length } }),
    req
  );
}

// Gatum DLR'ı GET ile gönderir; diğer sağlayıcılar için POST da açıktır.
export const GET = handle;
export const POST = handle;
