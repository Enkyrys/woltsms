# Değişiklik özeti — 24 saat çalışma, İngiltere saati, admin sesli bildirim

| Dosya | Değişiklik |
|---|---|
| `supabase/migrations/0012_24h_sending_window.sql` | YENİ — çalışma saati 24 saat (başlangıç 24:00 = 00:00, bitiş 23:59). `sending_start_hour=0`, `sending_end_hour=24`; 24/0 normalizasyonu, başlangıç=bitiş → 24 saat, gece yarısını aşan pencere desteği; duyuru metni güncellendi |
| `src/lib/timezone.ts` | YENİ — Türkiye saati ↔ UTC ↔ İngiltere saati (Europe/London, GMT/BST otomatik) çevirileri |
| `src/lib/providers/gatum.ts` | Her SMS paketine `beginDate` (YYYY-MM-DD) + `beginTime` (HH:MM) **İngiltere saatiyle** eklenir. `config.timezone` / `config.send_schedule=false` ile ayarlanabilir |
| `src/lib/providers/types.ts` | `SendOptions.sendAt` (planlanan gönderim anı) |
| `src/lib/services.ts` | Worker mesajın planlanan anını sağlayıcıya iletir; panel/API'den saat dilimsiz gelen tarih Türkiye saati kabul edilip UTC'ye çevrilir (önceden UTC sanılıyor, 3 saat kayıyordu) |
| `src/lib/sms/segments.ts`, `src/lib/sms-segments.ts` | Varsayılan pencere 0–24, SQL ile aynı normalizasyon kuralları |
| `src/app/api/panel/admin/orders/new/route.ts` | YENİ — admin için bayi (admin dışı) yeni sipariş yoklama ucu |
| `src/components/AdminOrderAlert.tsx` | YENİ — yeni bayi siparişinde 5 sn güçlü siren (Web Audio), ekran bildirimi, 🔊/🔇 düğmesi |
| `src/components/PanelShell.tsx` | Admin üst barına sesli bildirim bileşeni eklendi |
| `src/app/panel/admin/sistem/page.tsx`, `dashboard`, `siparisler`, `brand.ts`, docs | 24 saat metinleri, Türkiye saati gösterimi |
| `tests/timezone.test.ts`, `tests/segments.test.ts`, `tests/providers.test.ts` | Yeni/uyarlanmış testler |

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
