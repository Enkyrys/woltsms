// WOLTSMS — Node.js entegrasyonu (Node 18+, sunucu tarafında çalıştırın)
// Kullanım: WOLTSMS_API_KEY="wsk_live_...TAM_ANAHTAR" node send.mjs 905300000000 "Merhaba WOLTSMS!"
// İsteğe bağlı imza: WOLTSMS_API_SECRET="wss_..."
import { randomUUID, createHmac } from "node:crypto";

const BASE_URL = "https://woltsms.vercel.app";
const CALLBACK_URL = "https://woltsms.vercel.app/sms-callback"; // isteğe bağlı: teslim raporu adresi
const API_KEY = process.env.WOLTSMS_API_KEY ?? "";
const API_SECRET = process.env.WOLTSMS_API_SECRET ?? "";

// 57 karakter: "wsk_live_" + 48 hex. Kısa ön ek (ör. wsk_live_b8ae809) ÇALIŞMAZ.
if (!/^wsk_live_[0-9a-f]{48}$/.test(API_KEY)) {
  console.error("Bağlantı yok: WOLTSMS_API_KEY tam anahtar değil (wsk_live_ + 48 karakter olmalı).");
  process.exit(1);
}

async function call(method, path, json, idempotencyKey) {
  const headers = { Authorization: `Bearer ${API_KEY}` };
  let body;
  if (json) {
    body = JSON.stringify(json);
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = idempotencyKey ?? randomUUID();
    if (API_SECRET) headers["X-Signature"] = createHmac("sha256", API_SECRET).update(body).digest("hex");
  }
  const res = await fetch(BASE_URL + path, { method, headers, body, signal: AbortSignal.timeout(30_000) });
  const data = await res.json().catch(() => ({ success: false, message: "Geçersiz yanıt" }));
  return { status: res.status, ...data };
}

/** api_keys tablosunda anahtar kaydı varsa "Bağlandı", yoksa "Bağlantı yok" */
export async function checkConnection() {
  const r = await call("GET", "/api/v1/connection");
  return r.connected
    ? { connected: true, message: "Bağlandı", checks: r.data?.checks ?? {} }
    : { connected: false, message: r.message ?? "Bağlantı yok" };
}

export const sendSms = (recipients, message, { callbackUrl = CALLBACK_URL, scheduleAt, idempotencyKey } = {}) =>
  call(
    "POST",
    "/api/v1/sms/send",
    { recipients, message, ...(scheduleAt && { schedule_at: scheduleAt }), ...(callbackUrl && { callback_url: callbackUrl }) },
    idempotencyKey
  );
export const getBalance = () => call("GET", "/api/v1/balance");
export const getMessage = (id) => call("GET", `/api/v1/sms/${encodeURIComponent(id)}`);

// ---- Kullanım ----
const to = process.argv[2] ?? "905300000000";
const msg = process.argv[3] ?? "Merhaba WOLTSMS!";

const k = await checkConnection();
if (!k.connected) {
  console.error(k.message); // ör. "Bağlantı yok: Geçersiz API anahtarı."
  process.exit(1);
}
console.log(`Bağlandı (key_encrypted: ${k.checks.key_encrypted ? "var" : "yok"}, hmac_secret_encrypted: ${k.checks.hmac_secret_encrypted ? "var" : "yok"})`);

const r = await sendSms([to], msg);
if (r.success) {
  console.log(`Sipariş: ${r.data.order_id} | Segment: ${r.data.segments} | Maliyet: ${r.data.total_cost}`);
} else {
  // 401 anahtar hatalı · 402 yetersiz bakiye · 403 IP yetkisiz · 422 doğrulama · 429 istek limiti
  console.error(`Hata (${r.code ?? r.status}): ${r.message}`);
}
