# WOLTSMS Bayi Entegrasyonu

Base URL: `https://woltsms.vercel.app`
Kimlik doğrulama: `Authorization: Bearer <TAM_API_ANAHTARI>`

## Anahtar nasıl alınır?
Panel → **API Anahtarları** → **Yeni Anahtar Üret**. Açılan pencerede **API Key** (`wsk_live_` + 48 karakter, toplam 57)
ve **API Secret** (`wss_...`) görünür. Daha sonra listeden **Göster** ile tekrar görülebilir.

> Listedeki kısa ön ek (ör. `wsk_live_b8ae809`) anahtarın kendisi DEĞİLDİR; istekte kullanılırsa `401 Geçersiz API anahtarı` döner.
> Veritabanındaki 64 karakterlik `key_hash` değeri de anahtar değildir.

## Bağlantı kontrolü
`GET /api/v1/connection` anahtarı `api_keys` tablosundan doğrular (user_id, key_encrypted, hmac_secret_encrypted kayıtları):

| Sonuç | Anlamı |
|---|---|
| `{"connected": true, "message": "Bağlandı"}` | Kayıt var, anahtar aktif |
| `{"connected": false, "message": "Bağlantı yok: ..."}` | Anahtar geçersiz/pasif/IP yetkisiz/kayıt yok |

`data.checks`: `key_encrypted:false` → anahtar eski sürümde üretilmiş (panelde tekrar gösterilemez, yenisini üretin);
`hmac_secret_encrypted:true` → `X-Signature` imzası kullanılabilir.

## İsteğe bağlı imza
`WOLTSMS_API_SECRET` tanımlıysa kodlar `X-Signature: hex(HMAC-SHA256(secret, ham_body))` ekler. Zorunlu değildir.

| Dosya | Açıklama |
|---|---|
| curl.sh | Terminal testi (bağlantı kontrolü + gönderim) |
| send.php / callback.php | PHP gönderim + teslim raporu alıcısı |
| send.mjs / callback-server.mjs | Node.js (18+) |
| send.py / callback_server.py | Python 3.10+ |

Ortak kurallar: alıcı `905XXXXXXXXX`, mesaj en fazla 918 karakter, istekte en fazla 5000 alıcı,
anahtar başına dakikada 120 istek. Her istekte `Idempotency-Key` gönderin.
Hata kodları: 401 hatalı anahtar · 402 yetersiz bakiye · 403 IP yetkisiz · 422 doğrulama · 429 limit.
