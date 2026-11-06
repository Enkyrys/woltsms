# Değişiklik özeti — Ana sayfada iletişim adresleri + Yeni Üyelik Aç

| Dosya | Değişiklik |
|---|---|
| `src/app/page.tsx` | Üst menü ve banner'daki "Giriş Yap" yerine Telegram / WhatsApp / e-posta adresleri ve "Yeni Üyelik Aç"; mobilde iletişim satırı; bayi girişi iletişim bölümünde ve sayfa altında; e-posta kartında satır kırılması düzeltildi |
| `src/app/kayit/page.tsx` | YENİ — Yeni Üyelik Aç formu (ad/firma, kullanıcı adı, telefon, e-posta, şifre + kural göstergesi, not, onay kutusu, bot tuzağı) ve iletişim adresleri |
| `src/app/api/auth/register/route.ts` | YENİ — başvuru: doğrulama, şifre politikası, IP başına sınır |
| `supabase/migrations/0020_member_signup.sql` | YENİ — `rpc_register_member` (hesap askıda, rol Consumer, bakiye 0), `admin_approve_member` (+ kullanıcıya bildirim), `signup_enabled` / `signup_default_role` ayarları, aynı IP'den günde en fazla 3 bekleyen başvuru |
| `src/app/api/auth/login/route.ts`, `login/page.tsx` | Onay bekleyen üye doğru şifreyle girerse "başvurunuz onay bekliyor" (yanlış şifrede genel hata); giriş sayfasında "Yeni Üyelik Aç" bağlantısı |
| `src/app/panel/admin/uyelikler/page.tsx`, `api/panel/users` | "Onay bekleyen başvurular" bölümü: Onayla / Reddet, WhatsApp bağlantılı telefon, başvuru notu |
| `src/components/AdminOrderAlert.tsx`, `api/panel/admin/activity` | Yeni başvuruda admin panelinde zil + "Yeni üyelik başvurusu" bildirimi |
| `tests/e2e-local/e2e-signup.mts` | Başvuru → onay bekleyen giriş → zil → onay/ret → kötüye kullanım uçtan uca testi |

# Değişiklik özeti — Kullanıcı düzenleme onarımı, Hesabım / Şifre Değiştir, Üyelik Yönetimi

| Dosya | Değişiklik |
|---|---|
| `supabase/migrations/0019_user_management.sql` | YENİ — `admin_update_user_v2` (telefon temizleme, 0/negatif fiyat engeli, aktif/pasif, kendi admin rolünü kaldırma / kendini pasifleştirme / son admini kapatma engeli, değişiklikler denetim kaydında); `admin_user_delete_preview`; `admin_delete_user_v2` (kendini, son admini ve gönderimi süren kullanıcıyı silmez, silmeden önce özet denetim kaydına). **Hata düzeltmesi:** `wallet_transactions` üzerindeki "do instead nothing" kuralları, işlem geçmişi olan kullanıcıların silinmesini tamamen engelliyordu (`referential integrity query ... gave unexpected result`); aynı korumayı sağlayan tetikleyiciyle değiştirildi |
| `src/app/api/panel/users/route.ts` | Düzenleme onarıldı: boş birim fiyat artık 0 yazmıyor, virgüllü fiyat kabul ediliyor, formdaki şifre alanı artık gerçekten şifreyi sıfırlıyor, e-posta Supabase Auth Admin API ile değişiyor (çakışma kontrolü), aktif/pasif, Türkçe ve alana özel hata mesajları; silme önizlemesi ve güvenli silme |
| `src/app/panel/kullanicilar/page.tsx` | Hesap durumu anahtarı, şifre göster/gizle + kural göstergesi, form içi hata mesajları, "Tehlikeli bölge · Üyeliği sil" |
| `src/app/panel/hesabim/page.tsx`, `api/panel/account*` | YENİ — Hesabım (isim, telefon, e-posta) ve Şifre Değiştir (mevcut şifre doğrulaması, politika göstergesi, diğer cihazlardaki oturumları kapatma, 15 dk'da 5 deneme sınırı) |
| `src/app/panel/admin/uyelikler/page.tsx`, `UserDeleteModal.tsx` | YENİ — Üyelik Yönetimi: askıya al / aktifleştir / kalıcı sil (silinecek verilerin özeti + kullanıcı adını yazarak onay) |
| `src/lib/auth.ts` | Askıya alınan hesabın açık oturumu ve API anahtarları da anında kapanır |
| `src/components/PanelShell.tsx` | Menü: Hesabım, Şifre Değiştir; profil menüsünde kısayollar; admin menüsünde Üyelik Yönetimi |
| `tests/e2e-local/` | Kullanıcı yönetimi SQL senaryoları + uçtan uca test (26 kontrol) |

# Değişiklik özeti — Kullanıcı Aktivitesi ve giriş zili

| Dosya | Değişiklik |
|---|---|
| `supabase/migrations/0018_user_activity.sql` | YENİ — `user_sessions` (giriş / yeniden aktif → çıkış / sinyal kesildi), `profiles.last_login_at`, `last_seen_at`, `presence_timeout_seconds` ayarı (vars. 180 sn) |
| `src/lib/presence.ts`, `api/auth/login`, `api/auth/logout`, `api/panel/presence` | Girişte oturum açılır (httpOnly `wsid` çerezi), panel açıkken dakikada bir sinyal, çıkışta oturum kapanır |
| `src/app/api/panel/admin/activity/route.ts` | YENİ — admin: kullanıcıların çevrimiçi/pasif durumu, aktif olduğu / pasif olduğu an, son giriş, bugünkü oturum ve süre, cihaz/IP, olay akışı; `?since=` ile giriş zili yoklaması |
| `src/app/panel/admin/kullanici-aktivitesi/page.tsx` | YENİ — Kullanıcı Aktivitesi sayfası (15 sn'de bir yenilenir), giriş zili aç/kapat ve "Zili dene" |
| `src/components/AdminOrderAlert.tsx` | Bir kullanıcı girdiğinde (ya da pasifken geri döndüğünde) "ding-dong" zil + ekran bildirimi; adminin kendi girişi hariç |
| `src/components/PanelShell.tsx` | Her kullanıcı için "buradayım" sinyali; admin menüsüne Kullanıcı Aktivitesi |
| `src/lib/services.ts` | Dakikalık zamanlayıcı sinyali kesilen oturumları kapatır |
| `tests/e2e-local/` | Aktivite senaryoları (SQL) + giriş/çıkış/sinyal/admin API uçtan uca testi |

# Değişiklik özeti — SMS kampanyaları, zamanlanmış gönderim, ENKYRYS marka adı

| Dosya | Değişiklik |
|---|---|
| `supabase/migrations/0017_campaigns.sql` | YENİ — kampanya durumları (Taslak, Zamanlandı, Gönderim Bekliyor, Gönderiliyor, Gönderildi, **Kısmen Gönderildi**, Başarısız, İptal Edildi); `orders.name`, `draft_payload`, `last_provider_response`, `dispatch_finished_at`; `sms_send_attempts` (her API denemesi ayrı satır: başarılı/başarısız, HTTP kodu, ham yanıt); kalıcı hatalar tekrar denenmez; tekrarlı sonuç `ignored` olarak kaydedilir; `rpc_update_scheduled_order` (başlamadan önce ad/mesaj/zaman düzenleme, ücret farkı rezerv/iade); `rpc_save_order_draft` (bakiye rezervsiz taslak). Mevcut kayıt silinmez |
| `src/lib/providers/gatum.ts` | SMS POST'u HTTP katmanında **tekrarlanmaz** (HTTP 500'de aynı SMS'in iki kez gitme riski kapatıldı; yeniden deneme kontrollü DB kuyruğunda); her yanıt (yalnız ilgili numara) kaydedilir |
| `src/lib/services.ts` | Worker API yanıtını, HTTP kodunu ve hata sınıfını (geçici/kalıcı) kaydeder; her çalışmada `worker_last_run_at` yazılır |
| `src/app/api/panel/orders/route.ts` | Kampanya adı, taslak kaydet/gönder, `PATCH` ile zamanlanmış kampanya düzenleme, detayda gönderilen/başarılı/başarısız sayıları, gerçek başlangıç zamanı, API yanıtı ve deneme listesi |
| `src/app/panel/dashboard/page.tsx` | "Hemen Gönder / İleri Tarihte Gönder" seçimi, kampanya adı, "Taslak Kaydet", form başına sabit tekrar koruma anahtarı (çift tıklama yeni kampanya açmaz) |
| `src/app/panel/zamanlanmis/page.tsx` | YENİ — Zamanlanmış Kampanyalar: zamanlananlar (geri sayım, düzenle, iptal), taslaklar, gönderilenler |
| `src/app/panel/siparisler/page.tsx` | Kampanyalar listesi + ayrıntılı kampanya detayı |
| `src/components/CampaignEditModal.tsx`, `ui.tsx`, `PanelShell.tsx` | Düzenleme penceresi, kampanya durum etiketleri, menü |
| Sistem > Sağlık | Zamanlayıcı durumu (son çalışma), zamanlanmış kampanya sayısı |
| Marka | Projedeki tüm SEMPICO referansları ENKYRYS oldu. Yalnız sağlayıcının teknik API adresi (`restapi.sempico.solutions`) korunur: `src/config/provider.ts` (`ENKYRYS_API_BASE_URL` ile değiştirilebilir), `supabase/seed.sql`, `0010` migration'ındaki eski adres eşleştirmesi ve kök klasördeki eski yedek dosyalar |
| `tests/providers.test.ts` | Tekrar koruması, kalıcı/geçici hata ve API yanıtı testleri |
| `tests/e2e-local/` | YENİ — gerçek migration'lar + gerçek worker kodu + sahte ENKYRYS API ile uçtan uca test (`bash tests/e2e-local/run.sh`) |

# Değişiklik özeti — 24 saat çalışma, İngiltere saati, admin sesli bildirim

| Dosya | Değişiklik |
|---|---|
| `supabase/migrations/0012_24h_sending_window.sql` | YENİ — çalışma saati 24 saat (başlangıç 24:00 = 00:00, bitiş 23:59). `sending_start_hour=0`, `sending_end_hour=24`; 24/0 normalizasyonu, başlangıç=bitiş → 24 saat, gece yarısını aşan pencere desteği; duyuru metni güncellendi |
| `supabase/migrations/0013_provider_schedule.sql` | YENİ — `orders.provider_scheduled_at` (ENKYRYS saati, UTC), `provider_timezone`, `provider_triggered_at` sütunları; `scheduled_at` yazılınca tetikleyici sağlayıcı saatini hesaplar; worker siparişi yalnızca ENKYRYS saati gönderim saatine geldiğinde alır ve ENKYRYS API ile gönderir |
| `supabase/migrations/0014_send_on_create.sql` | YENİ — ileri tarihli sipariş kaldırıldı: gönderim anı = kayıt anı (`created_at`); `provider_scheduled_at` = oluşturma saatinin UTC karşılığı |
| `src/app/api/panel/orders`, `v1/sms/send`, `v1/sms/bulk` | Sipariş kaydedilince `after()` ile hemen ENKYRYS API'ye gönderilir (önceki tetikleme panelde hiç çalışmıyordu, Vercel'de de yarıda kesilebiliyordu); `schedule_at` yok sayılır |
| `src/app/panel/dashboard/page.tsx` | "Gönderileceği tarih" alanı kaldırıldı |
| `src/app/panel/siparisler/page.tsx` | "Sağlayıcı Saati (ENKYRYS)" sütunu + detayda gönderici/sağlayıcı saati ve gönderim durumu |
| `supabase/migrations/0015_hour_setting_format.sql` | YENİ — `invalid input syntax for type integer: "23:59"` hatası düzeltildi: çalışma saatleri "24:00"/"23:59" yazılsa da (panel ya da Table Editor) kayıt öncesi tam saate çevrilir (24:00→0, 23:59→24); eski 10:00–22:00 duyurusu güncellenir |
| `src/app/panel/admin/sistem/page.tsx`, `admin/settings` API | Başlangıç/bitiş SS:DD biçiminde girilir ve gösterilir (24:00 / 23:59), geçersiz biçim reddedilir |
| `supabase/migrations/0016_optional_future_schedule.sql` | YENİ — isteğe bağlı ileri tarihli sipariş: tarih boşsa kayıt anında, oluşturma saatinden sonraki bir tarih seçilirse o an gelince (ENKYRYS UTC saatine göre) worker ENKYRYS API ile gönderir. 0014'teki "her zaman hemen" kuralının yerini alır |
| `src/app/panel/dashboard/page.tsx` | "Gönderileceği tarih" alanı geri geldi (isteğe bağlı, en erken şimdi+1 dk); seçilen saat ve ENKYRYS UTC karşılığı gösterilir; geçmiş zaman reddedilir |
| `src/lib/timezone.ts` | YENİ — kullanıcı saati ↔ UTC ↔ sağlayıcı saati çevirileri |
| `src/app/panel/dashboard/page.tsx` | Seçilen tarih tarayıcının saat dilimine göre UTC ISO olarak gönderilir (önceden saat dilimsiz gidiyor, sunucu UTC sandığı için UTC+4'te SMS 4 saat geç çıkıyordu); altında "sağlayıcıya iletilecek (UTC)" saati gösterilir |
| `src/lib/providers/gatum.ts` | Her SMS paketine `beginDate` (YYYY-MM-DD) + `beginTime` (HH:MM) **UTC (ENKYRYS saati)** ile eklenir; UTC+4 kullanıcının 10:02'si → 06:02. `config.timezone` / `config.send_schedule=false` ile ayarlanabilir |
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
