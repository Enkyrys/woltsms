-- WOLTSMS - Temel şema (uuid PK, RLS açık)
-- Uygula: supabase db push  veya  psql -f 0001_schema.sql

create extension if not exists pgcrypto;

-- ============================= yardımcılar =============================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================= roller & yetkiler =============================
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  read_only boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  group_name text not null default 'genel'
);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  unique (role_id, permission_code)
);

-- ============================= kullanıcılar =============================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null default '',
  phone text,
  role_id uuid references public.roles(id),
  quota_type text not null default 'variable' check (quota_type in ('variable','fixed')),
  is_active boolean not null default true,
  two_factor_enabled boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_id_idx on public.profiles(role_id);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================= cüzdan & hareketler =============================
create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(18,4) not null default 0,
  reserved numeric(18,4) not null default 0,
  updated_at timestamptz not null default now(),
  constraint wallets_balance_non_negative check (balance >= 0),
  constraint wallets_reserved_non_negative check (reserved >= 0)
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('topup','debit','refund','adjust','reserve','release')),
  credit numeric(18,4) not null default 0,
  unit_price numeric(18,6),
  total_price numeric(18,4),
  currency text not null default 'TRY',
  balance_after numeric(18,4) not null,
  ref_type text,
  ref_id text,
  description text,
  created_at timestamptz not null default now()
);
create index wallet_transactions_user_idx on public.wallet_transactions(user_id, created_at desc);

-- append-only: UPDATE/DELETE engelli
create rule wt_no_update as on update to public.wallet_transactions do instead nothing;
create rule wt_no_delete as on delete to public.wallet_transactions do instead nothing;

-- ============================= fiyatlandırma =============================
create table public.pricing (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  unit_price numeric(18,6) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);
create unique index pricing_default_idx on public.pricing ((user_id is null)) where user_id is null;
create trigger trg_pricing_updated before update on public.pricing
  for each row execute function public.set_updated_at();

-- ============================= sipariş & mesajlar =============================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','scheduled','processing','completed','failed','cancelled')),
  total_count integer not null default 0,
  processed_count integer not null default 0,
  failed_count integer not null default 0,
  total_cost numeric(18,4) not null default 0,
  message text,
  note text,
  scheduled_at timestamptz,
  source text not null default 'panel' check (source in ('panel','api')),
  created_by uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_user_idx on public.orders(user_id, created_at desc);
create index orders_status_idx on public.orders(status);
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_message_id text,
  recipient text not null,
  body text not null,
  encoding text not null default 'GSM' check (encoding in ('GSM','UCS2')),
  segments integer not null default 1,
  cost numeric(18,4) not null default 0,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','delivered','failed','refunded')),
  attempts integer not null default 0,
  error_code text,
  next_attempt_at timestamptz,
  refunded_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sms_messages_order_status_idx on public.sms_messages(order_id, status);
create index sms_messages_claim_idx on public.sms_messages(status, next_attempt_at);
create index sms_messages_provider_idx on public.sms_messages(provider_message_id);
create unique index sms_messages_provider_unique on public.sms_messages(provider_message_id)
  where provider_message_id is not null;
create trigger trg_sms_messages_updated before update on public.sms_messages
  for each row execute function public.set_updated_at();

-- ============================= rehber =============================
create table public.contact_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_lists_user_idx on public.contact_lists(user_id, created_at desc);
create trigger trg_contact_lists_updated before update on public.contact_lists
  for each row execute function public.set_updated_at();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.contact_lists(id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now(),
  unique (list_id, phone)
);
create index contacts_list_idx on public.contacts(list_id);

-- ============================= kara liste =============================
create table public.blacklist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade, -- null = global
  phone text not null,
  created_at timestamptz not null default now(),
  unique (user_id, phone)
);
create index blacklist_phone_idx on public.blacklist(phone);

-- ============================= kısa url =============================
create table public.short_urls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_name text not null default '',
  original_url text not null,
  slug text not null unique,
  clicks integer not null default 0,
  created_at timestamptz not null default now()
);
create index short_urls_user_idx on public.short_urls(user_id, created_at desc);

-- ============================= gönderim geçmişi =============================
create table public.sent_message_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index sent_history_user_idx on public.sent_message_history(user_id, created_at desc);

-- ============================= destek =============================
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'open' check (status in ('open','answered','closed')),
  subject text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
create trigger trg_support_tickets_updated before update on public.support_tickets
  for each row execute function public.set_updated_at();

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade, -- null = admin
  is_admin boolean not null default false,
  body text not null,
  attachment_path text,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages(ticket_id, created_at);

-- ============================= api anahtarları =============================
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Varsayılan',
  key_prefix text not null,
  key_hash text not null,
  ip_whitelist jsonb not null default '[]'::jsonb,
  callback_url text,
  status text not null default 'active' check (status in ('active','disabled')),
  hmac_secret_encrypted text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_keys_user_idx on public.api_keys(user_id);
create index api_keys_hash_idx on public.api_keys(key_hash);

-- ============================= idempotency =============================
create table public.idempotency_keys (
  key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_hash text,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ============================= işler (kuyruk) =============================
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('send_batch','import_file','callback','dlr_poll','export_file','file_scan')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_claim_idx on public.jobs(status, run_at);

-- ============================= oran sınırı =============================
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- ============================= banka & kripto =============================
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_holder text not null,
  iban text not null,
  branch text,
  currency text not null default 'TRY',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_bank_accounts_updated before update on public.bank_accounts
  for each row execute function public.set_updated_at();

create table public.crypto_assets (
  id uuid primary key default gen_random_uuid(),
  asset text not null,
  network text not null,
  wallet_address text not null,
  memo_tag text,
  explorer_tx_url_template text not null default '',
  rate_try numeric(18,6) not null default 1,
  rate_updated_at timestamptz not null default now(),
  min_amount_try numeric(18,4) not null default 100,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset, network)
);
create trigger trg_crypto_assets_updated before update on public.crypto_assets
  for each row execute function public.set_updated_at();

create table public.payment_settings (
  id uuid primary key default gen_random_uuid(),
  min_topup_try numeric(18,4) not null default 100,
  max_topup_try numeric(18,4) not null default 500000,
  request_ttl_minutes integer not null default 1440,
  max_open_requests integer not null default 3,
  bank_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_payment_settings_updated before update on public.payment_settings
  for each row execute function public.set_updated_at();

create table public.topup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  method text not null check (method in ('bank','crypto')),
  amount_try numeric(18,4) not null,
  reference_code text not null unique,
  status text not null default 'pending'
    check (status in ('pending','reported','approved','rejected','expired')),
  receipt_path text,
  sender_name text,
  note text,
  wallet_address_snapshot text,
  approved_by uuid,
  approved_at timestamptz,
  approved_amount_try numeric(18,4),
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index topup_requests_user_idx on public.topup_requests(user_id, created_at desc);
create index topup_requests_status_idx on public.topup_requests(status, created_at desc);
create trigger trg_topup_requests_updated before update on public.topup_requests
  for each row execute function public.set_updated_at();

create table public.crypto_payment_reports (
  id uuid primary key default gen_random_uuid(),
  topup_request_id uuid not null references public.topup_requests(id) on delete cascade,
  asset text not null,
  network text not null,
  txid text not null unique,
  sent_amount numeric(24,8) not null,
  sent_at timestamptz,
  from_address text,
  receipt_path text,
  user_note text,
  rate_try_applied numeric(18,6),
  credited_amount_try numeric(18,4),
  admin_note text,
  created_at timestamptz not null default now()
);
create index crypto_reports_request_idx on public.crypto_payment_reports(topup_request_id);

-- ============================= sağlayıcılar (entegrasyon) =============================
create table public.provider_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  base_url text not null default '',
  sender_id text not null default '',
  credentials_encrypted text,        -- AES-256-GCM (ENCRYPTION_KEY)
  is_active boolean not null default false,
  low_balance_threshold numeric(18,4) not null default 1000,
  balance numeric(18,4),
  balance_currency text default 'TRY',
  last_balance_at timestamptz,
  last_error text,
  config jsonb not null default '{}'::jsonb,  -- uçlar, timeout, imza başlığı vs.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_provider_settings_updated before update on public.provider_settings
  for each row execute function public.set_updated_at();

-- ============================= duyuru, bildirim, log =============================
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_announcements_updated before update on public.announcements
  for each row execute function public.set_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null default 'info',
  title text not null default '',
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  ip text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_action_idx on public.audit_logs(action, created_at desc);

create rule audit_no_update as on update to public.audit_logs do instead nothing;
create rule audit_no_delete as on delete to public.audit_logs do instead nothing;

create table public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('inbound','outbound')),
  url text,
  payload jsonb,
  response_code integer,
  created_at timestamptz not null default now()
);
create index webhook_logs_created_idx on public.webhook_logs(created_at desc);

-- ============================= callback kuyruğu =============================
create table public.callback_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  url text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  run_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);
create index callback_queue_claim_idx on public.callback_queue(status, run_at);

-- ============================= sistem ayarları =============================
create table public.system_settings (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

-- ============================= import dosyaları =============================
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'contact_list' check (kind in ('contact_list','blacklist')),
  list_id uuid references public.contact_lists(id) on delete set null,
  storage_path text not null,
  filename text not null,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  total integer not null default 0,
  imported integer not null default 0,
  duplicates integer not null default 0,
  blacklisted integer not null default 0,
  invalid integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_jobs_user_idx on public.import_jobs(user_id, created_at desc);
create trigger trg_import_jobs_updated before update on public.import_jobs
  for each row execute function public.set_updated_at();

-- ============================= yetki anahtarları seed =============================
insert into public.permissions (code, name, group_name) values
  ('sms.send','SMS Gönder','sms'),
  ('sms.view','Siparişleri Gör','sms'),
  ('contacts.manage','Rehber Yönet','rehber'),
  ('contacts.import','Rehber İçe Aktar','rehber'),
  ('users.view','Kullanıcıları Gör','kullanici'),
  ('users.manage','Kullanıcı Yönet','kullanici'),
  ('users.create','Kullanıcı Oluştur','kullanici'),
  ('users.edit','Kullanıcı Düzenle','kullanici'),
  ('users.delete','Kullanıcı Sil','kullanici'),
  ('users.balance','Bakiye Ekle/Çıkar','kullanici'),
  ('roles.view','Rolleri Gör','kullanici'),
  ('roles.manage','Rol Yönet','kullanici'),
  ('blacklist.manage','Karaliste Yönet','sms'),
  ('credit.topup','Kredi Yükle','odeme'),
  ('credit.view','Kredi Taleplerini Gör','odeme'),
  ('credit.approve','Kredi Onayla/Reddet','odeme'),
  ('credit.settings','Ödeme Ayarları','odeme'),
  ('credit.adjust','Manuel Kredi Ekle','odeme'),
  ('transactions.view','İşlem Geçmişi','odeme'),
  ('shorturl.manage','Kısa URL Yönet','arac'),
  ('support.manage','Destek Yönet','destek'),
  ('apikey.manage','API Anahtarı Yönet','api'),
  ('apikeys.view','API Anahtarlarını Gör','api'),
  ('provider.manage','Sağlayıcı Yönet','sistem'),
  ('provider.view','Sağlayıcı Ayarlarını Gör','sistem'),
  ('announcement.manage','Duyuru Yönet','sistem'),
  ('settings.view','Sistem Ayarlarını Gör','sistem'),
  ('settings.manage','Sistem Ayarları','sistem'),
  ('audit.view','Audit Log','sistem'),
  ('system.health','Sistem Sağlığı','sistem'),
  ('reports.view','Kâr/Maliyet Raporu','rapor'),
  ('exports.manage','Dışa Aktarma','arac')
on conflict (code) do nothing;

insert into public.roles (name, read_only, is_system) values
  ('Consumer', false, true),
  ('Consumer_admin', false, true),
  ('admin', false, true)
on conflict (name) do nothing;

-- Consumer: temel kullanıcı yetkileri (kendi verisi; support.manage admin yetkisidir)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in (
  'sms.send','sms.view','contacts.manage','contacts.import','blacklist.manage',
  'credit.topup','transactions.view','shorturl.manage','apikey.manage','apikeys.view','exports.manage'
)
where r.name = 'Consumer'
on conflict do nothing;

-- Consumer_admin: yönetim + kullanıcı/rol görüntüleme, kredi onay
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in (
  'sms.send','sms.view','contacts.manage','contacts.import','blacklist.manage',
  'credit.topup','credit.view','credit.approve','credit.settings','credit.adjust',
  'transactions.view','shorturl.manage','support.manage','apikey.manage','apikeys.view',
  'users.view','users.manage','users.create','users.edit','users.balance',
  'roles.view','exports.manage'
)
where r.name = 'Consumer_admin'
on conflict do nothing;

-- admin rolü: is_admin=true sayılır, tek tek yetki verilmez.

-- ============================= sistem ayarları seed =============================
insert into public.system_settings (key, value, description) values
  ('sending_start_hour','10','Gönderim başlangıç saati (Europe/Istanbul)'),
  ('sending_end_hour','22','Gönderim bitiş saati (Europe/Istanbul)'),
  ('sender_id','WOLTSMS','Varsayılan gönderen (senderID)'),
  ('max_recipients_per_order','5000','Sipariş başına azami alıcı'),
  ('max_body_bytes','4096000','API istek gövdesi sınırı (byte)'),
  ('import_max_bytes','26214400','Dosya içe aktarma azami boyutu (25 MB)'),
  ('receipt_max_bytes','5242880','Dekont azami boyutu (5 MB)'),
  ('message_retention_days','180','KVKK mesaj saklama süresi (gün)'),
  ('send_max_attempts','3','Sağlayıcıya azami deneme'),
  ('worker_batch_size','250','Worker partisi boyutu'),
  ('default_unit_price','1','Varsayılan birim fiyat (TL)')
on conflict (key) do nothing;

insert into public.payment_settings (min_topup_try, max_topup_try, request_ttl_minutes, max_open_requests, bank_note)
values (100, 500000, 1440, 3, 'Havale açıklamasına talep referans kodunuzu mutlaka yazınız.')
on conflict do nothing;

insert into public.pricing (user_id, unit_price) values (null, 1)
on conflict do nothing;

-- varsayılan duyuru
insert into public.announcements (text, is_active) values
  ('Gönderimler 10:00–22:00 saatleri arasında aktiftir. 22:00 sonrası yapılan SMS gönderimleri iptal edilecektir. Bilginize sunar, iyi çalışmalar dileriz.', true);

-- örnek banka (seed.sql üzerinden değiştirin)
insert into public.bank_accounts (bank_name, account_holder, iban, branch, sort_order)
values ('Örnek Bank', 'WOLTSMS ÖDEME HİZMETLERİ LTD. ŞTİ.', 'TR00 0000 0000 0000 0000 0000 00', 'Merkez', 1);

-- örnek kripto (adresleri DEĞİŞTİRİN)
insert into public.crypto_assets (asset, network, wallet_address, explorer_tx_url_template, rate_try, min_amount_try, sort_order)
values
  ('USDT','TRC20','REPLACE_WITH_YOUR_TRC20_ADDRESS','https://tronscan.org/#/transaction/{txid}',36.25,100,1),
  ('USDT','BEP20','REPLACE_WITH_YOUR_BEP20_ADDRESS','https://bscscan.com/tx/{txid}',36.25,100,2),
  ('BTC','BTC','REPLACE_WITH_YOUR_BTC_ADDRESS','https://blockchair.com/bitcoin/transaction/{txid}',3600000,500,3),
  ('ETH','ERC20','REPLACE_WITH_YOUR_ETH_ADDRESS','https://etherscan.io/tx/{txid}',130000,500,4),
  ('TRX','TRC20','REPLACE_WITH_YOUR_TRX_ADDRESS','https://tronscan.org/#/transaction/{txid}',4.10,100,5),
  ('LTC','LTC','REPLACE_WITH_YOUR_LTC_ADDRESS','https://blockchair.com/litecoin/transaction/{txid}',3200,200,6);

-- ============================= RLS =============================
alter table public.roles                 enable row level security;
alter table public.permissions           enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.profiles              enable row level security;
alter table public.wallets               enable row level security;
alter table public.wallet_transactions   enable row level security;
alter table public.pricing               enable row level security;
alter table public.orders                enable row level security;
alter table public.sms_messages          enable row level security;
alter table public.contact_lists         enable row level security;
alter table public.contacts              enable row level security;
alter table public.blacklist             enable row level security;
alter table public.short_urls            enable row level security;
alter table public.sent_message_history  enable row level security;
alter table public.support_tickets       enable row level security;
alter table public.ticket_messages       enable row level security;
alter table public.api_keys              enable row level security;
alter table public.idempotency_keys      enable row level security;
alter table public.jobs                  enable row level security;
alter table public.rate_limits           enable row level security;
alter table public.bank_accounts         enable row level security;
alter table public.crypto_assets         enable row level security;
alter table public.payment_settings      enable row level security;
alter table public.topup_requests        enable row level security;
alter table public.crypto_payment_reports enable row level security;
alter table public.provider_settings     enable row level security;
alter table public.announcements         enable row level security;
alter table public.notifications         enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.webhook_logs          enable row level security;
alter table public.callback_queue        enable row level security;
alter table public.system_settings       enable row level security;
alter table public.import_jobs           enable row level security;

-- ============================= yetki yardımcıları =============================
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select r.name = 'admin'
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or coalesce((
    select count(*) > 0
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid() and rp.permission_code = p_code
  ), false);
$$;

create or replace function public.has_any_permission(p_codes text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or coalesce((
    select count(*) > 0
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid() and rp.permission_code = any(p_codes)
  ), false);
$$;

create or replace function public.is_self_or_admin(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or auth.uid() = p_user_id;
$$;

-- ============================= RLS politikaları =============================
-- Kimse doğrudan yazamaz; tüm hassas yazma service_role + RPC üzerinden.

create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.has_permission('users.view'));

create policy roles_select on public.roles for select using (true);
create policy permissions_select on public.permissions for select using (true);
create policy role_permissions_select on public.role_permissions for select using (true);

create policy wallets_select on public.wallets for select using (user_id = auth.uid() or public.is_admin());

create policy wallet_tx_select on public.wallet_transactions for select using (user_id = auth.uid() or public.is_admin());

create policy pricing_select on public.pricing for select using (true);

create policy orders_select on public.orders for select
  using (user_id = auth.uid() or public.has_permission('users.manage'));

create policy sms_messages_select on public.sms_messages for select
  using (user_id = auth.uid() or public.has_permission('users.manage'));

create policy contact_lists_select on public.contact_lists for select using (user_id = auth.uid() or public.is_admin());
create policy contacts_select on public.contacts for select using (
  exists (select 1 from public.contact_lists cl where cl.id = list_id and (cl.user_id = auth.uid() or public.is_admin()))
);

create policy blacklist_select on public.blacklist for select using (user_id = auth.uid() or user_id is null or public.is_admin());

create policy short_urls_select on public.short_urls for select using (user_id = auth.uid() or public.is_admin());
create policy sent_history_select on public.sent_message_history for select using (user_id = auth.uid());

create policy support_tickets_select on public.support_tickets for select
  using (user_id = auth.uid() or public.has_permission('support.manage'));
create policy ticket_messages_select on public.ticket_messages for select using (
  exists (select 1 from public.support_tickets t where t.id = ticket_id and (t.user_id = auth.uid() or public.has_permission('support.manage')))
);

create policy api_keys_select on public.api_keys for select using (user_id = auth.uid());

create policy idem_select on public.idempotency_keys for select using (user_id = auth.uid());

create policy jobs_admin_select on public.jobs for select using (public.is_admin());

create policy bank_accounts_select on public.bank_accounts for select using (true);
create policy crypto_assets_select on public.crypto_assets for select using (true);
create policy payment_settings_select on public.payment_settings for select using (true);

create policy topup_select on public.topup_requests for select
  using (user_id = auth.uid() or public.has_any_permission(array['credit.view','credit.approve']));

create policy crypto_reports_select on public.crypto_payment_reports for select using (
  exists (select 1 from public.topup_requests t where t.id = topup_request_id and (t.user_id = auth.uid() or public.has_any_permission(array['credit.view','credit.approve'])))
);

create policy provider_select on public.provider_settings for select using (false); -- yalnız service_role
create policy announcements_select on public.announcements for select using (true);
create policy notifications_select on public.notifications for select using (user_id = auth.uid());
create policy audit_select on public.audit_logs for select using (public.has_any_permission(array['audit.view']));
create policy webhook_logs_select on public.webhook_logs for select using (public.is_admin());
create policy system_settings_select on public.system_settings for select using (true);
create policy import_jobs_select on public.import_jobs for select using (user_id = auth.uid() or public.is_admin());

-- ============================= kısa url sayaç (RLS uyumlu) =============================
create or replace function public.short_url_click(p_slug text)
returns table (original_url text)
language plpgsql security definer set search_path = public
as $$
begin
  update public.short_urls set clicks = clicks + 1 where slug = p_slug
  returning short_urls.original_url into original_url;
  return next;
exception when no_data_found then
  return;
end;
$$;

-- ============================= oran sınırı (varsayılan) =============================
create or replace function public.rate_limit_check(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rate_limits.count + 1 end,
    window_start = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now() else rate_limits.window_start end
  returning count into v_count;
  return v_count <= p_max;
end;
$$;

-- ============================= Realtime =============================
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.sms_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.topup_requests;
alter publication supabase_realtime add table public.import_jobs;
