// WOLTSMS — JavaScript (Node.js / tarayıcı) entegrasyon örneği
// Gerekli: fetch (Node 18+ yerleşik).

const API_KEY = "wsk_live_..."; // panelde ürettiğiniz anahtar
const BASE_URL = "https://woltsms.com";

/**
 * SMS gönder
 * @param {string[]} recipients - 905XXXXXXXXX biçiminde alıcılar
 * @param {string} message
 * @param {{ scheduleAt?: string, idempotencyKey?: string }} [opts]
 */
export async function sendSms(recipients, message, opts = {}) {
  const res = await fetch(`${BASE_URL}/api/v1/sms/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      // Çift gönderimi engeller (aynı anahtar = aynı yanıt)
      "Idempotency-Key": opts.idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      recipients,
      message,
      schedule_at: opts.scheduleAt, // ISO 8601; 10:00–22:00 dışına kaydırılır
    }),
  });

  const data = await res.json();

  // HTTP durum kodları: 202 kuyruklandı, 402 yetersiz bakiye,
  // 422 doğrulama, 429 rate limit
  if (!data.success) {
    const err = new Error(data.message);
    err.code = data.code; // 402 / 422 / 429 ...
    throw err;
  }
  return data.data; // { order_id, total_count, segments, total_cost, balance_after, ... }
}

/** Bakiye sorgula */
export async function getBalance() {
  const res = await fetch(`${BASE_URL}/api/v1/balance`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const data = await res.json();
  return data.data; // { balance, reserved, available, unit_price, currency }
}

/** Mesaj durumu */
export async function getMessage(id) {
  const res = await fetch(`${BASE_URL}/api/v1/sms/${id}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return (await res.json()).data;
}

/** Sipariş listesi */
export async function listOrders(page = 1, perPage = 10) {
  const res = await fetch(`${BASE_URL}/api/v1/orders?page=${page}&per_page=${perPage}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const json = await res.json();
  return { orders: json.data, meta: json.meta };
}

// ---- Kullanım ----
(async () => {
  try {
    const order = await sendSms(["905XXXXXXXXX"], "Merhaba, kampanyamız başladı!");
    console.log("Sipariş:", order.order_id, "| Maliyet:", order.total_cost);
  } catch (e) {
    if (e.code === 402) console.error("Yetersiz bakiye — kredi yükleyin.");
    else console.error("Hata:", e.message);
  }
})();
