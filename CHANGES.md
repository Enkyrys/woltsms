# Değişiklik özeti

| Dosya | Değişiklik |
|---|---|
| `docs/API.md` | YENİ — gerçek sunucu davranışına göre tam Türkçe dokümantasyon |
| `docs/openapi.json` | v1.1: Bearer şeması, yanıt şemaları, 10:00–22:00 kuralı, callback olayları |
| `docs/examples/*` | Bearer + env tabanlı istemciler (JS/PHP/Python/cURL), callback alıcıları, env örneği |
| `src/app/panel/api-docs/page.tsx` | Panel dokümanı güncellendi (pencere kuralı, callback, doğru yanıt örneği) |
| `src/app/panel/api-anahtarlari/page.tsx` | Hata düzeltmesi: yeni anahtar penceresi `apiKey/apiSecret` okuyordu, API `key` döndürür; yanlış `X-API-Key/X-Signature` notu kaldırıldı |
| `src/app/sms-calback/route.ts` | YENİ — callback_url için alıcı (daha önce 404 → olaylar boşuna 5 kez tekrarlanıyordu) |
| `src/app/sms-callback/route.ts` | YENİ — doğru yazımlı takma ad |
