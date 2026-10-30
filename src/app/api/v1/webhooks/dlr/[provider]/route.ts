import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookLogs, apiKeys } from "@/db/schema";
import { getActiveProvider } from "@/lib/providers";
import { applyDlr } from "@/lib/services";

// Sağlayıcıdan gelen DLR (imza doğrulamalı)
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const raw = await req.text();
  let payload: unknown = {};
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  const sig = req.headers.get("x-provider-signature") || req.headers.get("x-signature") || "";
  const expectedSecret = process.env.SMS_PROVIDER_SECRET || process.env.SMS_PROVIDER_API_KEY || "";
  // imza varsa doğrula (HMAC-SHA256)
  if (expectedSecret && sig) {
    const crypto = await import("crypto");
    const exp = crypto.createHmac("sha256", expectedSecret).update(raw).digest("hex");
    if (exp !== sig.toLowerCase() && exp !== sig) {
      await db.insert(webhookLogs).values({ direction: "inbound", url: `/api/v1/webhooks/dlr/${provider}`, payload: raw.slice(0, 5000), responseCode: 401 });
      return NextResponse.json({ success: false, code: 401, message: "Geçersiz DLR imzası." }, { status: 401 });
    }
  }
  await db.insert(webhookLogs).values({ direction: "inbound", url: `/api/v1/webhooks/dlr/${provider}`, payload: raw.slice(0, 5000), responseCode: 200 });
  const adapter = await getActiveProvider();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  const items = adapter.parseDlrWebhook(payload, headers);
  for (const it of items) {
    await applyDlr(it.providerMessageId, it.status === "delivered" ? "delivered" : it.status === "failed" ? "failed" : "delivered", it.errorCode).catch(() => {});
  }
  // Kullanıcı callback'lerine iletim (best-effort)
  try {
    if (items.length > 0) {
      const { pool } = await import("@/db");
      for (const it of items) {
        const r = await pool.query(`SELECT m.user_id, k.callback_url FROM sms_messages m LEFT JOIN api_keys k ON k.user_id=m.user_id AND k.callback_url IS NOT NULL WHERE m.provider_message_id=$1 LIMIT 1`, [it.providerMessageId]);
        const cb = r.rows[0]?.callback_url;
        if (cb) {
          fetch(cb, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerMessageId: it.providerMessageId, status: it.status }) }).catch(() => {});
          await db.insert(webhookLogs).values({ direction: "outbound", url: String(cb).slice(0, 500), payload: JSON.stringify(it).slice(0, 2000), responseCode: 0 });
        }
      }
    }
  } catch {}
  return NextResponse.json({ success: true, code: 200, message: "DLR işlendi.", data: { count: items.length } });
}
