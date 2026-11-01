-- SQL ile (auth.users'a doğrudan INSERT) eklenen kullanıcıların Supabase Auth ile
-- giriş yapabilmesi için gereken düzeltmeler.
-- Belirti: giriş ekranında "Geçersiz kullanıcı veya şifre"

-- 1) Doğrulanmamış kullanıcıları doğrulanmış yap
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email_confirmed_at is null;

-- 2) GoTrue, bu token sütunlarında NULL görürse giriş sırasında hata verir ('' olmalı)
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where confirmation_token is null or recovery_token is null
   or email_change_token_new is null or email_change is null
   or email_change_token_current is null or phone_change is null
   or phone_change_token is null or reauthentication_token is null;

-- 3) Eksik e-posta kimliklerini (auth.identities) oluştur
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- 4) Bundan sonra eklenecek kullanıcılar için otomatik düzeltme (trigger)
create or replace function public.auto_confirm_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email_confirmed_at         := coalesce(new.email_confirmed_at, now());
  new.confirmation_token         := coalesce(new.confirmation_token, '');
  new.recovery_token             := coalesce(new.recovery_token, '');
  new.email_change_token_new     := coalesce(new.email_change_token_new, '');
  new.email_change               := coalesce(new.email_change, '');
  new.email_change_token_current := coalesce(new.email_change_token_current, '');
  new.phone_change               := coalesce(new.phone_change, '');
  new.phone_change_token         := coalesce(new.phone_change_token, '');
  new.reauthentication_token     := coalesce(new.reauthentication_token, '');
  return new;
end; $$;

drop trigger if exists trg_auto_confirm_auth_user on auth.users;
create trigger trg_auto_confirm_auth_user
  before insert on auth.users
  for each row execute function public.auto_confirm_auth_user();

create or replace function public.auto_create_auth_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.identities i where i.user_id = new.id and i.provider = 'email') then
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (new.id::text, new.id,
            jsonb_build_object('sub', new.id::text, 'email', new.email, 'email_verified', true),
            'email', now(), now(), now());
  end if;
  return new;
end; $$;

drop trigger if exists trg_auto_create_auth_identity on auth.users;
create trigger trg_auto_create_auth_identity
  after insert on auth.users
  for each row execute function public.auto_create_auth_identity();

-- 5) Teşhis: sonucu kontrol et (her kullanıcı için email_confirmed=true, identity_count=1 olmalı)
select p.username, p.is_active, u.email,
       (u.email_confirmed_at is not null) as email_confirmed,
       (select count(*) from auth.identities i where i.user_id = u.id) as identity_count
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.created_at desc;
