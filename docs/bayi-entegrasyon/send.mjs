// WOLTSMS — Node.js entegrasyonu (Node 18+, sunucu tarafında çalıştırın)
// Kullanım: WOLTSMS_API_KEY="wsk_live_290e1bb...TAM_ANAHTAR" node send.mjs 905300000000 "Merhaba WOLTSMS!"
import { randomUUID } from "node:crypto";

const BASE_URL = "https://woltsms.vercel.app";
const CALLBACK_URL = "https://woltsms.vercel.app/sms-callback"; // isteğe bağlı: teslim raporu adresi
const API_KEY = process.env.WOLTSMS_API_KEY;

if (!API_KEY) {
  console.error("Tam API anahtarını WOLTSMS_API_KEY olarak tanımlayın (wsk_live_290e1bb... ile başlar).");
  process.exit(1);
}

async function call(method, path, json, idempotencyKey) {
  const headers = { Authorization: `Bearer ${API_KEY}` };
  if (json) {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = idempotencyKey ?? randomUUID();
  }
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: json ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({ success: false, message: "Geçersiz yanıt" }));
  return { status: res.status, ...data };
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

console.log("Bakiye:", (await getBalance()).data);
const r = await sendSms([to], msg);
if (r.success) {
  console.log(`Sipariş: ${r.data.order_id} | Segment: ${r.data.segments} | Maliyet: ${r.data.total_cost}`);
} else {
  // 401 anahtar hatalı · 402 yetersiz bakiye · 403 IP yetkisiz · 422 doğrulama · 429 istek limiti
  console.error(`Hata (${r.code ?? r.status}): ${r.message}`);
}
