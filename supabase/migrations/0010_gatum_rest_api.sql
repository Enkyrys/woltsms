-- ============================================================
-- 0010_gatum_rest_api.sql
-- Gatum REST API v1 (9.20.0) geçişi
--
-- Eski sürümler GET tabanlı uçtu:
--   GET https://api.sempico.solutions/send?token=...&phone=...
-- Yeni API (OAuth 2.0 benzeri iki adımlı yetki):
--   POST /authorize    {username, password}  -> authorization_code
--   POST /access-token {authorization_code}  -> access_token
--   Sonraki isteklerde header: X-Access-Token
--   POST /send   -> JSON dizisi paket, istek başına en fazla 100 numara
--   GET  /me     -> bakiye (IP başına 15 dakikada 1 istek; aşarsa 429)
--   POST /replacement -> ücretsiz bağlantı testi (SMS göndermez)
--   DLR: callback_url'e POST JSON dizisi + API_KEY header
--
-- Dikkat: eski dashboard "token"ı bu API'de geçerli değildir. Kimlik
-- bilgileri (kullanıcı adı/şifre veya access token) Panel → Yönetici →
-- Sistem & Sağlayıcı → Entegrasyonlar sekmesinden yeniden girilir ve
-- AES-256-GCM ile şifrelenerek saklanır (ENCRYPTION_KEY, Vercel env).
-- ============================================================

update public.provider_settings
   set base_url = 'https://restapi.sempico.solutions/v1',
       config = case
                  when coalesce(config, '{}'::jsonb) ? 'send_endpoint'
                    then coalesce(config, '{}'::jsonb)
                  else coalesce(config, '{}'::jsonb) || '{"send_endpoint": "/send"}'::jsonb
                end
 where provider = 'gatum'
   and base_url in (
     '',
     'https://api.sempico.solutions',
     'https://api.sempico.solutions/v1',
     'https://restapi.sempico.solutions'
   );

-- eski GET tabanlı çağrılardan kalan hata metnini temizle
update public.provider_settings
   set last_error = null
 where provider = 'gatum'
   and last_error is not null;
