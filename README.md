# WOLTSMS — Bayi SMS Paneli

WOLTSMS markalı, Supabase tabanlı bayi (reseller) SMS yönetim paneli.
Vercel + Next.js App Router üzerinde çalışır; tüm bakiye işlemleri veritabanında
**SECURITY DEFINER RPC'ler** ile atomik yapılır (SELECT ... FOR UPDATE + idempotency).

> Tasarım: teal (#0FB5A0) marka rengi, Türkçe arayüz, Europe/Istanbul saat dilimi,
> numeric(18,4) TL tutarları.

---

## Mimarisi

| Katman | Teknoloji |
|---|---|
| Uygulama | Next.js (App Router, TypeScript, Node runtime) |
| Kimlik | Supabase Auth (kullanıcı adı → e-posta çözümleme) |
| Veri | Supabase Postgres + RLS + SECURITY DEFINER RPC'ler |
| Dosya | Supabase Storage (imzalı upload URL'leri; Vercel gövde sınırı aşılmaz) |
| Zamanlayıcı | pg_cron → pg_net → `POST /api/internal/worker` |
| Sağlayıcı | Admin panelinden tanımlanır (Gatum / Generic HTTP / Mock), AES-256-GCM şifreli |
| Public API | `/api/v1` — `{success, code, message, data, meta?}` zarfı |

**Bakiye akışı:** `rpc_create_order` → `balance -= total, reserved += total` →
`rpc_finalize_message` (`reserved -= cost`) veya `rpc_refund_message`
(`reserved -= cost, balance += cost`). Yetersiz bakiye → **HTTP 402**.

---

## 1. Supabase projesi oluşturun

1. [supabase.com](https://supabase.com) → yeni proje (bölge: hedef kitlenize yakın, örn. Frankfurt).
2. **Database → Extensions** içinden şu uzantıları etkinleştirin:
   - `pg_cron`
   - `pg_net`
   - `uuid-ossp` / `pgcrypto` (migration'lar da idempotent açar)
3. Dashboard → **Project Settings → API** değerlerini kopyalayın:
   - `Project URL`
   - `anon public` key
   - `service_role` key (gizli!)

---

## 2. Veritabanı migration + seed

CLI ile (önerilen):

```bash
# supabase CLI kurulu ve login olunmuş olmalı
supabase link --project-ref <PROJECT_REF>

supabase db push
# eşdeğeri: migration dosyalarını sırayla SQL Editor'de çalıştırın
#   supabase/migrations/0001_schema.sql
#   supabase/migrations/0002_functions.sql
#   supabase/migrations/0003_storage_cron.sql
#   supabase/migrations/0004_prompt_alignment.sql   <-- ZORUNLU (güvenlik + bakiye düzeltmeleri)

# demo veriler (admin/demo hesapları, roller, örnek bankalar)
supabase db seed    # supabase/seed.sql dosyasını çalıştırır
```

CLI yoksa: SQL Editor'de dosyaları sırasıyla tek tek çalıştırın, ardından
`supabase/seed.sql` içeriğini yapıştırıp çalıştırın.

**Seed hesapları:**

| Rol | Kullanıcı adı | Şifre |
|---|---|---|
| Admin | `admin` | `Admin123!` |
| Bayi | `demo` | `Demo123!` |

> **Üretimde seed kullanıcılarını çalıştırmayın** (`Admin123!` herkesçe bilinen şifredir). Bunun yerine
> `POST /api/seed/first-admin` ile kendi admin'inizi açın. Gerekirse şifreleri en az değiştirin ya da `seed.sql`'in kullanıcı
> bölümlerini çalıştırıp kendi admin'inizi `POST /api/seed/first-admin` ile açın.

---

## 3. Custom config (pg_cron → pg_net için)

Worker, pg_cron tarafından **pg_net** ile çağrılır. Uygulama URL'i ve gizli
anahtar Postgres'te saklanır. SQL Editor'de:

```sql
alter database postgres set app.cron_secret = '<CRON_SECRET>';   -- .env'deki değerle aynısı
alter database postgres set app.internal_worker_url = '<APP_URL>'; -- örn https://woltsms.vercel.app

notify pgrst, 'reload config';
```

Migration içindeki `pg_cron` işleri (her dakika worker, saatlik üst/alt
sertifika temizliği) bu değerleri `current_setting(..., true)` ile okur.

---

## 4. Ortam değişkenleri

`.env.example` dosyasını kopyalayın:

```bash
cp .env.example .env.local
```

| Değişken | Açıklama |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Proje URL'i |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key (RLS korur) |
| `SUPABASE_SERVICE_ROLE_KEY` | **yalnızca sunucu**, ASLA istemciye gitmez |
| `APP_URL` | Deploy edilen alan adı |
| `CRON_SECRET` | worker çağrısı için (3. adımla eşleşmeli) |
| `BOOTSTRAP_TOKEN` | ilk admin oluşturucu için tek kullanımlık token |
| `ENCRYPTION_KEY` | AES-256-GCM anahtarı (32 byte) — **üretimde değiştirin, kaybetmeyin** |
| `API_CORS_ORIGINS` | public API için CORS izin listesi |
| `API_RATE_LIMIT_PER_MIN` | anahtar başına dk istek (varsayılan 120) |

Sağlayıcı kimlik bilgileri (Gatum token vs.) **ENV'de değil**, admin panelinde
"Entegrasyonlar" sekmesinden girilir ve AES-256-GCM ile şifrelenerek saklanır.

---

## 5. Vercel'e deploy

1. GitHub deposunu Vercel'e import edin (kök dizin: `woltsms/`).
2. Project Settings → Environment Variables: `.env.local` ile aynı anahtarları girin.
3. Deploy. Build komutu `package.json`'daki standarttır: `next build`.
4. `APP_URL` değerini gerçek alan adınızla güncelleyin ve 3. adımdaki
   `app.internal_worker_url` değerini **bunu güncelleyin**.

### İlk admin'i oluşturmak (seed kullanmadıysanız)

```bash
curl -X POST https://woltsms.vercel.app/api/seed/first-admin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <BOOTSTRAP_TOKEN>" \
  -d '{"username":"admin","password":"<GÜÇLÜ-ŞİFRE>","email":"admin@woltsms.com","name":"Yönetici"}'
```

Token'ı **tek kullanımdan sonra değiştirin veya iptal edin**.

---

## 6. Sağlayıcı (Gatum) tanımı

Panel → **Yönetici → Sistem & Sağlayıcı → Entegrasyonlar**:

- **Sağlayıcı:** `Gatum SMS (sempico.solutions)`
- **Base URL:** `https://api.sempico.solutions`
- **Gönderim Ucu:** `/send`
- **Token:** Gatum dashboard'dan oluşturulan anahtar
- **Güvenlik Anahtarı:** (opsiyonel) DLR isteklerinde `API_KEY` header'ı olarak gelir
- **Gönderen:** API'nizin onaylı senderID'si (ör. `WOLTSMS`)

DLR callback adresi otomatik olarak
`https://woltsms.vercel.app/api/v1/webhooks/dlr/gatum` olarak gönderilir.

Test için panelde **MockProvider** seçip "Bakiye Sorgulama & Test" düğmesini
kullanabilirsiniz (dışarıya istek atmaz).

---

## 7. Public API kullanımı

- Spesifikasyon: `docs/openapi.json` (API'nizde `GET /api/openapi.json`)
- Örnekler: `docs/examples/php.php`, `docs/examples/javascript.js`, `docs/examples/python.py`

```bash
curl -X POST https://woltsms.vercel.app/api/v1/sms/send \
  -H "Authorization: Bearer wsk_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 9f2c...-0001" \
  -d '{"recipients":["905XXXXXXXXX"],"message":"Merhaba, kampanyamız başladı!"}'
```

Durum kodları: `202` kuyruklandı · `400` geçersiz istek · `401` hatalı anahtar ·
`402` **yetersiz bakiye** · `403` yetki · `422` doğrulama · `429` rate limit.

---

## Yerel geliştirme

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm test           # vitest (unit)
```

**Entegrasyon testleri** (`tests/integration.balances.test.ts`) gerçek Supabase
projesine karşı çalışır; `.env.local` içinde `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` yoksa otomatik atlanır. Önce migration'ların
uygulanmış olması gerekir.

> Not: Bu depo `.env.local` içeriğini **commit etmez** (bkz. `.gitignore`).
> Test kullanıcısı email'leri `*@woltsms.test` ile biter; test sonunda
> otomatik temizlenirler.

---

## İşleyiş notları

- **Gönderim penceresi:** 24 saat — başlangıç 24:00, bitiş 23:59 (Europe/Istanbul,
  `0012_24h_sending_window.sql`). Admin farklı bir pencere tanımlarsa dışına atanan
  siparişler pencereye kaydırılır; pencere dışında kalanlar `rpc_cancel_out_of_window`
  ile iptal + rezerv iadesi yapılır.
- **Saat dilimi / sağlayıcı:** Panelde ve API'de saat dilimsiz girilen tarih/saat
  Türkiye saatidir; panelde kullanıcı kendi saatini seçer, tarayıcı saat dilimli
  gönderir. Sağlayıcı (Gatum/Sempico) saati UTC olduğundan gönderim tarihi/saati
  `beginDate` / `beginTime` alanlarında **UTC'ye** çevrilerek iletilir
  (UTC+4'te 10:02 → 06:02; `src/lib/timezone.ts`).
  Farklı bir saat dilimi gerekirse sağlayıcı `config.timezone` ile değiştirilebilir.
- **Gönderim anı:** İleri tarihli sipariş yoktur. Sipariş veritabanına kaydedildiği
  an Sempico API'ye gönderilir; oluşturma saati UTC'ye çevrilip `beginDate`/`beginTime`
  olarak iletilir (`0014_send_on_create.sql`). `schedule_at` alanı yok sayılır.
- **Sağlayıcı saati:** `orders.provider_scheduled_at` Sempico'nun saatiyle (UTC) gönderim
  zamanını tutar ve Siparişler sayfasında gösterilir. Worker (her dakika) siparişi
  ancak Sempico saati bu zamana geldiğinde alır ve Sempico API'ye gönderir;
  gönderim başladığında `provider_triggered_at` yazılır.
- **Admin sipariş bildirimi:** Bayilerden yeni sipariş geldiğinde admin panelinde
  5 saniyelik güçlü sesli uyarı çalar (üst bardaki 🔊 düğmesiyle aç/kapat).
- **Segment:** GSM 160/153, UCS-2 70/67. Kodlama GSM 03.38 tablosuna göre belirlenir:
  ş, Ş, ğ, Ğ, ı, İ ve küçük **ç** tabloda olmadığı için UCS-2'ye zorlar; Ç, ö, ü, Ö, Ü GSM'dir.
  UCS-2 uzunluğu UTF-16 kod birimidir (emoji = 2). TS (`lib/sms-segments.ts`) ve SQL
  (`sms_segments`) aynı tabloyu kullanır.
- **Kara liste:** otomatik filtrelenir (sipariş oluştururken).
- **Kredi yükleme:** Havale/EFT fişi Storage'a imzalı URL ile yüklenir; kripto
  TXID benzersizdir (UNIQUE). Onay `rpc_approve_topup` ile tek adımda ve
  transaction içinde yapılır.
- **Webhook DLR:** `GET /api/v1/webhooks/dlr/{provider}` — Gatum onay modunda
  yanıt gövdesinin `id_state` olmasını bekler; route bunu döndürür.
- **Bakiye sorgulama:** sağlayıcı bakiyesi `/api/v1/sms/balance` (Gatum) ile
  çekilir; eşik altına düşerse admin'e bildirim yazılır.

---

## Güvenlik özeti

- Bakiye mutasyonları yalnızca SECURITY DEFINER RPC'leri (RLS bile bypass eder).
- `wallet_transactions` **append-only** (UPDATE/DELETE politikası kapalı).
- Sağlayıcı kimlik bilgileri AES-256-GCM + `ENCRYPTION_KEY`.
- API anahtarları SHA-256 hash ile saklanır, bir kez gösterilir.
- Panel rotaları middleware + `getSession()` ile; public API `verifyApiKey` +
  IP whitelist + opsiyonel HMAC + rate limit.
- Storage: kendi klasörünüze (`<uid>/...`) yazabilir; herkesin okuması kapatılır
  (maskeli listeler download route'undan verilir).

---

## Dizin yapısı (özet)

```
woltsms/
├─ supabase/
│  ├─ migrations/0001_schema.sql      # tablolar + RLS + roller
│  ├─ migrations/0002_functions.sql   # RPC'ler (bakiye, gönderim, topup…)
│  ├─ migrations/0003_storage_cron.sql# bucket'lar + pg_cron işleri
│  └─ seed.sql                        # admin/demo + roller + örnek veri
├─ src/
│  ├─ app/                            # panel sayfaları + API rotaları
│  ├─ components/                     # PanelShell, ui bileşenleri
│  ├─ lib/                            # auth, security, services, providers/
│  └─ db/types.ts                     # Supabase tipleri
├─ docs/openapi.json                  # API spesifikasyonu
├─ docs/examples/                     # PHP / JS / Python
├─ tests/                             # vitest unit + entegrasyon
└─ .env.example
```

---

## 0004 düzeltmeleri (prompta uyum)

| Konu | Düzeltme |
|---|---|
| **Güvenlik** | `rpc_refund_message`, `rpc_finalize_message`, `rpc_apply_dlr`, `rpc_claim_send_batch` vb. artık yalnızca `service_role` tarafından çağrılabilir. Önceden anon/authenticated çağırabiliyordu (kendi mesajını iade ettirme, başkasının numara/mesaj verisini okuma). Yeni migration'larda oluşturduğunuz fonksiyonlar için `grant execute ... to authenticated` açıkça yazılmalıdır. |
| **Saat dilimi** | 10:00–22:00 penceresi `Europe/Istanbul` ile hesaplanır (önceden UTC oturum saatine göre; zamanlanmış gönderimler yanlış iptal edilebiliyordu). |
| **Bakiye** | DLR başarısızlığında kesinleşmiş mesaj iadesi diğer siparişlerin rezervini düşürmüyor; pencere dışı toplu iptal kullanıcı başına tüm mesajları iade ediyor; `failed_count` çift artmıyor; sipariş durumu mesajlardan yeniden hesaplanıyor. |
| **Idempotency** | Kontrol kullanıcı kilidinden sonra; aynı anahtar + farklı istek `422`. |
| **Onay** | Kullanıcı kendi talebini onaylayamaz; kripto talebi TXID bildirimi olmadan onaylanamaz; onay/ret/manuel kredi `audit_logs`'a yazılır. |
| **Worker** | Eşzamanlı gönderim (varsayılan 10) + süre bütçesi (`WORKER_TIME_BUDGET_MS`); takılı `sending` mesajlar 5 dk'lık cron ile kurtarılır. |
| **API** | Rate limit gerçekten uygulanıyor (önceden RPC cevabı boolean sanıldığı için hiç tetiklenmiyordu). |

### Tip notları
- Supabase istemcileri (`lib/supabase/*`) bilerek **tipsiz** oluşturulur. `src/db/types.ts` elle yazılmıştı ve
  supabase-js'in beklediği `Database` biçimine (Views/Relationships) uymadığı için `rpc()` çağrıları
  derleme hatası veriyordu. İsterseniz `supabase gen types typescript --linked > src/db/types.ts`
  ile gerçek tipleri üretip istemcilere `<Database>` ekleyebilirsiniz.
- Route Handler yardımcıları `Request`/`Response` kullanır (`NextRequest`/`NextResponse` değil).
