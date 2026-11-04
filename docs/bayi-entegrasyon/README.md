# WOLTSMS Bayi Entegrasyonu

Base URL: `https://woltsms.vercel.app`
Kimlik doğrulama: `Authorization: Bearer <TAM_API_ANAHTARI>`

API anahtarı `wsk_live_290e1bb` ile başlar ve **tam hali yalnızca panelde üretildiği anda bir kez gösterilir**.
Panelde sadece ön ek (prefix) ve hash saklanır; hash ile istek atılamaz. Tam anahtarı kaybettiyseniz
panelde yeni anahtar üretin.

| Dosya | Açıklama |
|---|---|
| curl.sh | Terminal testi |
| send.php / callback.php | PHP gönderim + teslim raporu alıcısı |
| send.mjs / callback-server.mjs | Node.js (18+) |
| send.py / callback_server.py | Python 3.10+ |

Ortak kurallar: alıcı `905XXXXXXXXX`, mesaj en fazla 918 karakter, istekte en fazla 5000 alıcı,
anahtar başına dakikada 120 istek. Her istekte `Idempotency-Key` gönderin.
Hata kodları: 401 hatalı anahtar · 402 yetersiz bakiye · 403 IP yetkisiz · 422 doğrulama · 429 limit.

Teslim raporu (callback) olayları: `message.sent`, `message.delivered`, `message.failed`.
Alıcı adresiniz 2xx dönmezse 5 kez, artan aralıkla tekrar denenir.
