-- =====================================================================
-- WOLTSMS - 0019 : Kullanıcı düzenleme onarımı + üyelik silme
-- 0018 SONRASINDA çalıştırılır (idempotent).
--
-- admin_update_user sorunları:
--   * boş telefon temizlenemiyordu (coalesce eski değeri koruyordu)
--   * birim fiyat boş gelince 0 yazılabiliyordu; negatif/0 fiyat engellenmiyordu
--   * hesap aktif/pasif yapılamıyordu
--   * rol kontrolü yoktu: admin kendi admin rolünü kaldırabiliyor, son admin pasifleşebiliyordu
--   * e-posta doğrudan auth.users'a yazılıyordu (identities güncellenmiyordu) → artık
--     uygulama Supabase Auth Admin API ile değiştirir
-- Yeni:
--   * admin_update_user_v2  — doğrulamalı güncelleme, değişiklikler denetim kaydına yazılır
--   * admin_user_delete_preview — silinecek verilerin özeti
--   * admin_delete_user_v2  — güvenli silme (kendini / son admini / gönderimi süren kullanıcıyı
--     silmez); silinmeden önce kullanıcının özeti denetim kaydına yazılır
-- Eski fonksiyonlar korunur (geri uyumluluk).
-- =====================================================================

-- ---------- işlem geçmişi (wallet_transactions) koruması ----------
-- 0001'deki "do instead nothing" kuralları, kullanıcı silinirken bağlı kayıtların
-- otomatik silinmesini (ON DELETE CASCADE) bozuyordu:
--   referential integrity query ... gave unexpected result
-- Bu yüzden işlem geçmişi olan hiçbir kullanıcı silinemiyordu.
-- Kurallar aynı korumayı sağlayan tetikleyiciyle değiştirildi: değiştirme her zaman,
-- silme yalnız admin_delete_user_v2 içinde (işlem bazlı izinle) yapılabilir.
drop rule if exists wt_no_update on public.wallet_transactions;
drop rule if exists wt_no_delete on public.wallet_transactions;

create or replace function public.wallet_transactions_guard()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('woltsms.allow_ledger_delete', true) = 'on' then
    return old;  -- yalnız üyelik silme işlemi sırasında
  end if;
  raise exception 'LEDGER_IMMUTABLE' using errcode = 'P0409',
    hint = 'wallet_transactions yalnız eklenebilir (append-only).';
end;
$$;

drop trigger if exists trg_wallet_transactions_guard on public.wallet_transactions;
create trigger trg_wallet_transactions_guard
  before update or delete on public.wallet_transactions
  for each row execute function public.wallet_transactions_guard();

create or replace function public.is_admin_role(p_role_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.roles where id = p_role_id and name = 'admin') $$;

create or replace function public.active_admin_count()
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.profiles p join public.roles r on r.id = p.role_id
  where r.name = 'admin' and p.is_active
$$;

create or replace function public.admin_update_user_v2(
  p_user_id uuid,
  p_name text default null,
  p_phone text default null,          -- '' → telefonu temizle
  p_role_id uuid default null,
  p_quota_type text default null,
  p_unit_price numeric default null,
  p_is_active boolean default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype;
  v_was_admin boolean;
  v_will_admin boolean;
  v_will_active boolean;
  v_changes jsonb := '{}'::jsonb;
  v_old_price numeric;
begin
  if not public.has_permission('users.edit') then raise exception 'NO_PERMISSION' using errcode = 'P0403'; end if;

  select * into p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0404'; end if;

  if p_name is not null and btrim(p_name) = '' then raise exception 'NAME_REQUIRED' using errcode = 'P0400'; end if;
  if p_quota_type is not null and p_quota_type not in ('variable','fixed') then raise exception 'INVALID_QUOTA_TYPE' using errcode = 'P0400'; end if;
  if p_unit_price is not null and p_unit_price <= 0 then raise exception 'INVALID_UNIT_PRICE' using errcode = 'P0400'; end if;
  if p_role_id is not null and not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'ROLE_NOT_FOUND' using errcode = 'P0404';
  end if;

  v_was_admin := public.is_admin_role(p.role_id);
  v_will_admin := public.is_admin_role(coalesce(p_role_id, p.role_id));
  v_will_active := coalesce(p_is_active, p.is_active);

  if p_user_id = v_uid and v_was_admin and not v_will_admin then
    raise exception 'SELF_ADMIN_REMOVAL' using errcode = 'P0409';
  end if;
  if p_user_id = v_uid and not v_will_active then
    raise exception 'SELF_DEACTIVATE' using errcode = 'P0409';
  end if;
  if v_was_admin and p.is_active and (not v_will_admin or not v_will_active) and public.active_admin_count() <= 1 then
    raise exception 'LAST_ADMIN' using errcode = 'P0409';
  end if;

  if p_name is not null and btrim(p_name) is distinct from p.name then v_changes := v_changes || jsonb_build_object('name', btrim(p_name)); end if;
  if p_phone is not null and nullif(btrim(p_phone), '') is distinct from p.phone then v_changes := v_changes || jsonb_build_object('phone', nullif(btrim(p_phone), '')); end if;
  if p_role_id is not null and p_role_id is distinct from p.role_id then v_changes := v_changes || jsonb_build_object('role_id', p_role_id); end if;
  if p_quota_type is not null and p_quota_type is distinct from p.quota_type then v_changes := v_changes || jsonb_build_object('quota_type', p_quota_type); end if;
  if p_is_active is not null and p_is_active is distinct from p.is_active then v_changes := v_changes || jsonb_build_object('is_active', p_is_active); end if;

  update public.profiles
  set name = coalesce(nullif(btrim(p_name), ''), name),
      phone = case when p_phone is null then phone else nullif(btrim(p_phone), '') end,
      role_id = coalesce(p_role_id, role_id),
      quota_type = coalesce(p_quota_type, quota_type),
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
  where id = p_user_id;

  if p_unit_price is not null then
    select unit_price into v_old_price from public.pricing where user_id = p_user_id;
    if v_old_price is distinct from p_unit_price then
      insert into public.pricing (user_id, unit_price) values (p_user_id, p_unit_price)
      on conflict (user_id) do update set unit_price = excluded.unit_price;
      v_changes := v_changes || jsonb_build_object('unit_price', p_unit_price);
    end if;
  end if;

  -- pasifleştirilen kullanıcının açık oturumları kapanır (aktivite ekranında "pasif")
  if p_is_active = false and p.is_active then
    update public.user_sessions set ended_at = now(), end_reason = 'logout'
    where user_id = p_user_id and ended_at is null;
  end if;

  insert into public.audit_logs (actor_id, action, payload)
  values (v_uid, 'user.update', jsonb_build_object('user_id', p_user_id, 'username', p.username, 'changes', v_changes));

  return jsonb_build_object('status', 'ok', 'changes', v_changes);
end;
$$;
revoke all on function public.admin_update_user_v2(uuid, text, text, uuid, text, numeric, boolean) from public, anon;
grant execute on function public.admin_update_user_v2(uuid, text, text, uuid, text, numeric, boolean) to authenticated;

-- silmeden önce: kullanıcıyla birlikte silinecek verilerin özeti
create or replace function public.admin_user_delete_preview(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  p public.profiles%rowtype;
  v jsonb;
begin
  if not public.has_permission('users.delete') then raise exception 'NO_PERMISSION' using errcode = 'P0403'; end if;
  select * into p from public.profiles where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0404'; end if;

  select jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'name', p.name,
    'is_active', p.is_active,
    'is_admin', public.is_admin_role(p.role_id),
    'is_self', p.id = auth.uid(),
    'balance', coalesce((select balance from public.wallets where user_id = p.id), 0),
    'reserved', coalesce((select reserved from public.wallets where user_id = p.id), 0),
    'orders', (select count(*) from public.orders where user_id = p.id),
    'active_orders', (select count(*) from public.orders where user_id = p.id and status in ('pending','scheduled','processing')),
    'messages', (select count(*) from public.sms_messages where user_id = p.id),
    'transactions', (select count(*) from public.wallet_transactions where user_id = p.id),
    'last_login_at', p.last_login_at,
    'created_at', p.created_at
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_user_delete_preview(uuid) from public, anon;
grant execute on function public.admin_user_delete_preview(uuid) to authenticated;

-- güvenli silme
create or replace function public.admin_delete_user_v2(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_preview jsonb;
begin
  if not public.has_permission('users.delete') then raise exception 'NO_PERMISSION' using errcode = 'P0403'; end if;
  if p_user_id = v_uid then raise exception 'SELF_DELETE' using errcode = 'P0409'; end if;

  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0404'; end if;

  v_preview := public.admin_user_delete_preview(p_user_id);
  if (v_preview ->> 'is_admin')::boolean and (v_preview ->> 'is_active')::boolean and public.active_admin_count() <= 1 then
    raise exception 'LAST_ADMIN' using errcode = 'P0409';
  end if;
  if (v_preview ->> 'active_orders')::int > 0 or (v_preview ->> 'reserved')::numeric > 0 then
    raise exception 'USER_HAS_ACTIVE_CAMPAIGNS' using errcode = 'P0409';
  end if;

  -- silinmeden önce özet denetim kaydına (kullanıcı satırı silinince de kalır)
  insert into public.audit_logs (actor_id, action, payload)
  values (v_uid, 'user.delete', v_preview);

  -- bu işlem süresince işlem geçmişinin cascade silinmesine izin ver (yalnız bu transaction)
  perform set_config('woltsms.allow_ledger_delete', 'on', true);
  delete from auth.users where id = p_user_id;   -- profiles ve bağlı tüm kayıtlar cascade
  delete from public.profiles where id = p_user_id; -- auth kaydı yoksa (manuel profil) güvence

  perform set_config('woltsms.allow_ledger_delete', 'off', true);
  return jsonb_build_object('status', 'deleted', 'user', v_preview);
end;
$$;
revoke all on function public.admin_delete_user_v2(uuid) from public, anon;
grant execute on function public.admin_delete_user_v2(uuid) to authenticated;

notify pgrst, 'reload schema';
