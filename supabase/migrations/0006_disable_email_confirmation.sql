-- E-posta doğrulamasını devre dışı bırakır.
-- 1) Doğrulanmamış tüm mevcut kullanıcıları doğrulanmış yap
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email_confirmed_at is null;

-- 2) Bundan sonra eklenecek her kullanıcı otomatik doğrulanmış olsun
--    (Dashboard'dan, API'den veya SQL ile eklenmiş fark etmez)
create or replace function public.auto_confirm_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_confirm_auth_user on auth.users;
create trigger trg_auto_confirm_auth_user
  before insert on auth.users
  for each row execute function public.auto_confirm_auth_user();
