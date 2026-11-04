// WOLTSMS — örnek teslim raporu (callback) alıcısı.
// API anahtarının callback_url alanına https://<alan-adiniz>/sms-callback yazarsanız
// WOLTSMS buraya JSON POST eder: { event, message_id, order_id?, recipient, status, error? }
// Gerçek bayi kendi sitesinde benzer bir uç nokta yayınlar; bu yalnızca test içindir.
// 2xx dönmezseniz istek 5 kez tekrar denenir.
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  console.log("[sms-callback]", JSON.stringify(body));
  return Response.json({ ok: true });
}

export async function GET() {
  return Response.json({ ok: true, info: "WOLTSMS callback alıcısı — POST bekler" });
}
