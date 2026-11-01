-- WOLTSMS seed.sql
-- Supabase CLI ile: supabase db reset  (veya SQL editor'de çalıştırın)
-- Not: seed.sql auth.users'a doğrudan yazar; production'da ilk admin'i
-- /api/seed/first-admin üzerinden (env'deki ADMIN_EMAIL + BOOTSTRAP_TOKEN) oluşturun.

-- ===================== ilk admin =====================
do $$
declare
  v_uid uuid := 'a0000000-0000-4000-8000-000000000001';
  v_role uuid;
begin
  select id into v_role from public.roles where name = 'admin';

  if not exists (select 1 from auth.users where email = 'admin@woltsms.local') then
    insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, aud, role, created_at, updated_at)
    values (v_uid, '00000000-0000-0000-0000-000000000000', 'admin@woltsms.local',
      extensions.crypt('Admin123!', extensions.gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, 'authenticated', 'authenticated', now(), now());

    insert into public.profiles (id, username, name, phone, role_id, quota_type, is_active)
    values (v_uid, 'admin', 'Sistem Yöneticisi', '905000000000', v_role, 'variable', true);

    insert into public.wallets (user_id, balance, reserved) values (v_uid, 10000, 0);
    insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, description)
    values (v_uid, 'adjust', 10000, 10000, 10000, 'seed', 'Seed başlangıç bakiyesi');
  end if;
end $$;

-- ===================== demo bayi (Consumer) =====================
do $$
declare
  v_uid uuid := 'a0000000-0000-4000-8000-000000000002';
  v_role uuid;
begin
  select id into v_role from public.roles where name = 'Consumer';

  if not exists (select 1 from auth.users where email = 'demo@woltsms.local') then
    insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, aud, role, created_at, updated_at)
    values (v_uid, '00000000-0000-0000-0000-000000000000', 'demo@woltsms.local',
      extensions.crypt('Demo123!', extensions.gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, 'authenticated', 'authenticated', now(), now());

    insert into public.profiles (id, username, name, phone, role_id, quota_type, is_active)
    values (v_uid, 'demo', 'Demo Bayi', '905001112233', v_role, 'variable', true);

    insert into public.wallets (user_id, balance, reserved) values (v_uid, 500, 0);
    insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, description)
    values (v_uid, 'adjust', 500, 500, 500, 'seed', 'Seed demo bakiyesi');

    -- demo API anahtarı: wsk_live_demo00000000000000000000000000 (hash'i aşağıda)
    insert into public.api_keys (user_id, name, key_prefix, key_hash, ip_whitelist)
    values (v_uid, 'Demo Anahtar', 'wsk_live_demo',
      encode(digest('wsk_live_demo00000000000000000000000000', 'sha256'), 'hex'), '[]'::jsonb);
  end if;
end $$;

-- varsayılan sağlayıcı satırı (admin panelinden yapılandırılır)
insert into public.provider_settings (provider, base_url, sender_id, is_active, config)
values ('gatum', 'https://api.sempico.solutions', 'WOLTSMS', false,
        '{"send_endpoint":"/send","balance_endpoint":"/balance","timeout_ms":15000,"max_retries":2}'::jsonb)
on conflict (provider) do nothing;

insert into public.provider_settings (provider, base_url, sender_id, is_active, config)
values ('mock', '', 'WOLTSMS', true, '{}'::jsonb)
on conflict (provider) do nothing;
