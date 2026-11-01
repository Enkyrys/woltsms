-- WOLTSMS - Bakiye & gönderim RPC'leri (tüm bakiye değişiklikleri buradan)
-- Bakiye modeli: create_order → balance-=total, reserved+=total (rezerve)
--                finalize    → reserved-=cost (kesinleşti, para gitti)
--                refund      → reserved-=cost, balance+=cost (iade)

-- ===================== segment & normalizasyon =====================
create or replace function public.sms_detect_encoding(p_msg text)
returns text
language plpgsql immutable
as $$
declare ch text; cp int;
begin
  for i in 1..char_length(p_msg) loop
    ch := substring(p_msg, i, 1);
    if ch in ('ş','Ş','ğ','Ğ','ı','İ') then return 'UCS2'; end if;
    cp := unicode(ch);
    if cp > 127 then
      if ch = '€' then continue; end if;
      if position(ch in 'çÇöÖüÜéèêëàâäîïôöùûÿñß ') = 0 then return 'UCS2'; end if;
    end if;
  end loop;
  return 'GSM';
end;
$$;

create or replace function public.sms_gsm_length(p_msg text)
returns integer
language plpgsql immutable
as $$
declare len int := 0; ch text;
begin
  for i in 1..char_length(p_msg) loop
    ch := substring(p_msg, i, 1);
    if ch in ('^','{','}','\','[','~',']','|','€') then len := len + 2; else len := len + 1; end if;
  end loop;
  return len;
end;
$$;

-- GSM: 160 tek parça / 153 çok parça; UCS-2: 70 tek / 67 çok
create or replace function public.sms_segments(p_msg text)
returns integer
language plpgsql immutable
as $$
declare enc text; len int; per int;
begin
  if p_msg is null or p_msg = '' then return 0; end if;
  enc := public.sms_detect_encoding(p_msg);
  if enc = 'UCS2' then
    len := char_length(p_msg);
    per := case when len <= 70 then 70 else 67 end;
  else
    len := public.sms_gsm_length(p_msg);
    per := case when len <= 160 then 160 else 153 end;
  end if;
  return greatest(1, ceil(len::numeric / per)::int);
end;
$$;

-- 05xx / +90 / 90 / 0090 / 5xx → 905xxxxxxxxx
create or replace function public.normalize_phone(p_phone text)
returns text
language plpgsql immutable
as $$
declare v text;
begin
  v := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if v like '+%' then v := substring(v from 2); end if;
  if v like '00%' then v := substring(v from 3); end if;
  if v like '0%' then v := substring(v from 2); end if;
  if v like '90%' then
    v := substring(v from 3);
  elsif v like '5%' then
    null; -- zaten 90'sız
  end if;
  if v !~ '^5[0-9]{9}$' then return null; end if;
  return '90' || v;
end;
$$;

create or replace function public.parse_recipients(p_text text)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(distinct x), '{}'::text[])
  from (
    select regexp_replace(trim(unnest(string_to_array(regexp_replace(coalesce(p_text, ''), E'[\r\n;]', ',', 'g'), ','))), '[^0-9+]', '', 'g') as x
  ) s
  where x <> '';
$$;

create or replace function public.normalize_recipients(p_text text)
returns text[]
language sql
as $$
  select coalesce(array_agg(distinct n), '{}'::text[])
  from (
    select public.normalize_phone(x) as n from unnest(public.parse_recipients(p_text)) x
  ) s
  where n is not null;
$$;

-- ===================== fiyat =====================
create or replace function public.get_unit_price(p_user_id uuid)
returns numeric(18,6)
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select unit_price from public.pricing where user_id = p_user_id),
    (select unit_price from public.pricing where user_id is null),
    1
  );
$$;

-- ===================== bakiye okuma =====================
create or replace function public.rpc_get_balance(p_user_id uuid default null)
returns table (balance numeric, reserved numeric, unit_price numeric)
language sql stable security definer set search_path = public
as $$
  select coalesce(w.balance,0), coalesce(w.reserved,0), public.get_unit_price(coalesce(p_user_id, auth.uid()))
  from (select coalesce(p_user_id, auth.uid()) as uid) u
  left join public.wallets w on w.user_id = u.uid
  where p_user_id is null or p_user_id = auth.uid() or public.is_admin();
$$;

-- ===================== kullanıcı bazlı yetki (service_role / API anahtarı çağrıları için) =====================
create or replace function public.user_has_permission(p_user_id uuid, p_code text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select r.name = 'admin' or exists (
      select 1 from public.role_permissions rp
      where rp.role_id = p.role_id and rp.permission_code = p_code
    )
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = p_user_id
  ), false);
$$;

-- ===================== rpc_create_order =====================
-- Not: p_user_id yalnız service_role ile (public API, çerezsiz) çağrıldığında kullanılır;
-- panel çağrılarında auth.uid() devreye girer.
drop function if exists public.rpc_create_order(jsonb, text, timestamptz, text, text, uuid);
create or replace function public.rpc_create_order(
  p_recipients jsonb,           -- ["905...", ...]
  p_message text,
  p_schedule_at timestamptz default null,
  p_source text default 'panel',
  p_idempotency_key text default null,
  p_contact_list_id uuid default null,
  p_user_id uuid default null   -- yalnız service_role: API anahtarı sahibinin kimliği
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_on_behalf boolean := false;
  v_jwt_role text := coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_setting('role', true)
  );
  v_profile public.profiles%rowtype;
  v_nums text[];
  v_bl text[];
  v_effective text[];
  v_enc text;
  v_segments int;
  v_unit numeric(18,6);
  v_cost numeric(18,4);
  v_bal numeric(18,4);
  v_order_id uuid;
  v_now timestamptz := now();
  v_start_hour int;
  v_end_hour int;
  v_scheduled timestamptz;
  v_blacklisted int := 0;
  v_idem jsonb;
  v_num text;
  v_max_recipients int;
begin
  if v_uid is null then
    -- public API: service_role + p_user_id (API anahtarı sahibi) ile kimlik belirlenir
    if v_jwt_role = 'service_role' and p_user_id is not null then
      v_uid := p_user_id;
      v_on_behalf := true;
    else
      raise exception 'AUTH_REQUIRED' using errcode = '401';
    end if;
  end if;

  -- idempotency: aynı anahtarla ikinci istek aynı yanıtı döner
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select response into v_idem from public.idempotency_keys
    where user_id = v_uid and key = p_idempotency_key;
    if v_idem is not null then
      return v_idem;
    end if;
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or not v_profile.is_active then
    raise exception 'ACCOUNT_DISABLED' using errcode = '403';
  end if;
  if v_on_behalf then
    -- API anahtarı kullanıcısının yetkisi doğrudan kontrol edilir
    if not public.user_has_permission(v_uid, 'sms.send') then
      raise exception 'NO_PERMISSION' using errcode = '403';
    end if;
  elsif not public.has_permission('sms.send') then
    raise exception 'NO_PERMISSION' using errcode = '403';
  end if;
  if p_message is null or btrim(p_message) = '' then
    raise exception 'EMPTY_MESSAGE' using errcode = '400';
  end if;

  -- alıcılar: liste seçildiyse ondan, yoksa verilen listeden
  if p_contact_list_id is not null then
    select coalesce(array_agg(phone), '{}'::text[]) into v_nums
    from public.contacts where list_id = p_contact_list_id
      and exists (select 1 from public.contact_lists cl where cl.id = p_contact_list_id and cl.user_id = v_uid);
    if v_nums = '{}'::text[] then raise exception 'EMPTY_RECIPIENTS' using errcode = '400'; end if;
  else
    select coalesce(array_agg(distinct x), '{}'::text[]) into v_nums
    from jsonb_array_elements_text(p_recipients) x where btrim(coalesce(x,'')) <> '';
  end if;
  if v_nums = '{}'::text[] then
    raise exception 'EMPTY_RECIPIENTS' using errcode = '400';
  end if;

  -- normalize + benzersiz + hatalıları çıkar
  select coalesce(array_agg(distinct n), '{}'::text[]) into v_nums
  from (select public.normalize_phone(x) as n from unnest(v_nums) x) s where n is not null;
  if v_nums = '{}'::text[] then
    raise exception 'NO_VALID_RECIPIENTS' using errcode = '422';
  end if;

  select value::int into v_max_recipients from public.system_settings where key = 'max_recipients_per_order';
  if v_max_recipients is not null and array_length(v_nums, 1) > v_max_recipients then
    raise exception 'TOO_MANY_RECIPIENTS' using errcode = '422';
  end if;

  -- kara liste filtresi (kullanıcı + global)
  select coalesce(array_agg(phone), '{}'::text[]) into v_bl
  from public.blacklist where user_id = v_uid or user_id is null;
  select coalesce(array_agg(n), '{}'::text[]) into v_effective
  from unnest(v_nums) n where not (n = any(v_bl));
  v_blacklisted := array_length(v_nums,1) - array_length(v_effective,1);
  if v_effective is null or v_effective = '{}'::text[] then
    raise exception 'ALL_BLACKLISTED' using errcode = '422';
  end if;

  -- segment hesabı (mesaj başına, tüm alıcılar aynı)
  v_enc := public.sms_detect_encoding(p_message);
  v_segments := public.sms_segments(p_message);
  v_unit := public.get_unit_price(v_uid);
  v_cost := round(v_segments * v_unit * array_length(v_effective, 1), 4);

  -- gönderim saati kuralı (Europe/Istanbul)
  select value::int into v_start_hour from public.system_settings where key = 'sending_start_hour';
  select value::int into v_end_hour from public.system_settings where key = 'sending_end_hour';
  v_scheduled := coalesce(p_schedule_at, v_now);
  if v_scheduled::time < make_time(coalesce(v_start_hour,10),0,0)
     or v_scheduled::time >= make_time(coalesce(v_end_hour,22),0,0) then
    if p_schedule_at is null then
      -- anlık gönderim pencere dışında: iptal (rezerve yok)
      return jsonb_build_object(
        'status','cancelled', 'reason','OUTSIDE_SENDING_WINDOW',
        'message','Gönderimler ' || coalesce(v_start_hour,10) || ':00–' || coalesce(v_end_hour,22) || ':00 arasında aktiftir.');
    end if;
    -- ileri tarihli gönderim: ertesi günün uygun ilk anına kaydır
    v_scheduled := date_trunc('day', v_scheduled) + make_time(coalesce(v_start_hour,10),0,0) + interval '1 day';
    if v_scheduled::time >= make_time(coalesce(v_end_hour,22),0,0) then
      v_scheduled := v_scheduled + interval '1 day';
    end if;
  end if;

  -- cüzdan kilidi + rezerve
  insert into public.wallets (user_id, balance, reserved) values (v_uid, 0, 0) on conflict do nothing;
  select balance into v_bal from public.wallets where user_id = v_uid for update;
  if v_bal < v_cost then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '402';
  end if;
  update public.wallets set balance = balance - v_cost, reserved = reserved + v_cost, updated_at = now()
  where user_id = v_uid;

  -- sipariş + mesajlar
  insert into public.orders (user_id, status, total_count, total_cost, message, scheduled_at, source, created_by, idempotency_key)
  values (v_uid, case when p_schedule_at is not null and p_schedule_at > v_now then 'scheduled' else 'pending' end,
          array_length(v_effective,1), v_cost, p_message, v_scheduled, p_source, v_uid, p_idempotency_key)
  returning id into v_order_id;

  foreach v_num in array v_effective loop
    insert into public.sms_messages (order_id, user_id, recipient, body, encoding, segments, cost, status, next_attempt_at)
    values (v_order_id, v_uid, v_num, p_message, v_enc, v_segments, round(v_segments * v_unit, 4), 'queued', v_scheduled);
  end loop;

  insert into public.wallet_transactions (user_id, type, credit, unit_price, total_price, balance_after, ref_type, ref_id, description)
  values (v_uid, 'reserve', -v_cost, v_unit, v_cost, v_bal - v_cost, 'order', v_order_id::text,
          'Gönderim rezerve (' || array_length(v_effective,1) || ' alıcı, ' || v_segments || ' segment)');

  insert into public.sent_message_history (user_id, body) values (v_uid, p_message);

  declare v_result jsonb;
  begin
    v_result := jsonb_build_object(
      'status','ok', 'order_id', v_order_id, 'total_count', array_length(v_effective,1),
      'blacklisted_count', v_blacklisted, 'segments', v_segments, 'encoding', v_enc,
      'unit_price', v_unit, 'total_cost', v_cost, 'balance_after', v_bal - v_cost,
      'scheduled_at', v_scheduled, 'invalid_count', array_length(v_nums,1) - array_length(v_effective,1) + v_blacklisted
    );
    if p_idempotency_key is not null and p_idempotency_key <> '' then
      insert into public.idempotency_keys (key, user_id, request_hash, response)
      values (p_idempotency_key, v_uid, md5(p_message || coalesce(v_order_id::text,'')), v_result)
      on conflict (user_id, key) do update set response = excluded.response;
    end if;
    return v_result;
  end;
end;
$$;

-- ===================== rpc_finalize_message =====================
-- Gönderim sağlayıcıya iletildi: rezerv kesinleşir (reserved → düşüklü kalır)
create or replace function public.rpc_finalize_message(
  p_message_id uuid,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.sms_messages%rowtype;
  v_order public.orders%rowtype;
  v_bal numeric; v_res numeric;
begin
  select * into m from public.sms_messages where id = p_message_id for update;
  if not found then raise exception 'MESSAGE_NOT_FOUND' using errcode = '404'; end if;
  if m.status in ('sent','delivered') then
    return jsonb_build_object('status','already_finalized', 'message_id', m.id, 'message_status', m.status);
  end if;
  if m.status in ('failed','refunded') then
    raise exception 'ALREADY_SETTLED' using errcode = '409';
  end if;

  update public.wallets set reserved = greatest(reserved - m.cost, 0), updated_at = now()
  where user_id = m.user_id
  returning balance, reserved into v_bal, v_res;

  update public.sms_messages
  set status = 'sent', provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      sent_at = now(), attempts = attempts + 1, error_code = null
  where id = m.id;

  select * into v_order from public.orders where id = m.order_id for update;
  update public.orders
  set processed_count = processed_count + 1,
      status = case when processed_count + 1 >= total_count then 'completed' else status end
  where id = m.order_id;

  insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
  values (m.user_id, 'debit', 0, m.cost, v_bal, 'message', m.id::text,
          'Gönderim kesinleşti (segment ' || m.segments || ')');

  return jsonb_build_object('status','finalized', 'message_id', m.id, 'order_id', m.order_id, 'balance', v_bal, 'reserved', v_res);
end;
$$;

-- ===================== rpc_refund_message =====================
-- Sağlayıcı hatası / DLR başarısızlık: rezerv iade edilir (mesaj başına tek iade)
create or replace function public.rpc_refund_message(
  p_message_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.sms_messages%rowtype;
  v_bal numeric; v_res numeric;
begin
  select * into m from public.sms_messages where id = p_message_id for update;
  if not found then raise exception 'MESSAGE_NOT_FOUND' using errcode = '404'; end if;
  if m.status = 'refunded' then
    return jsonb_build_object('status','already_refunded', 'message_id', m.id);
  end if;

  update public.wallets
  set reserved = greatest(reserved - m.cost, 0),
      balance = balance + m.cost,
      updated_at = now()
  where user_id = m.user_id
  returning balance, reserved into v_bal, v_res;

  update public.sms_messages
  set status = 'refunded', refunded_at = now(), error_code = coalesce(p_reason, error_code)
  where id = m.id;

  update public.orders set failed_count = failed_count + 1 where id = m.order_id;

  insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
  values (m.user_id, 'refund', m.cost, m.cost, v_bal, 'message', m.id::text,
          coalesce('Gönderim iadesi: ' || p_reason, 'Gönderim iadesi'));

  return jsonb_build_object('status','refunded', 'message_id', m.id, 'balance', v_bal, 'amount', m.cost);
end;
$$;

-- ===================== rpc_apply_dlr =====================
-- DLR idempotent uygulama: sent → delivered / failed(refund)
create or replace function public.rpc_apply_dlr(
  p_provider_message_id text,
  p_state text,
  p_error text default null,
  p_time timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.sms_messages%rowtype;
  v_target text;
begin
  select * into m from public.sms_messages where provider_message_id = p_provider_message_id for update;
  if not found then
    return jsonb_build_object('status','ignored', 'reason','UNKNOWN_PROVIDER_ID');
  end if;

  v_target := case upper(coalesce(p_state,''))
    when 'DELIVRD' then 'delivered'
    when 'UNDELIV' then 'failed'
    when 'EXPIRED' then 'failed'
    when 'ENROUTE' then 'sent'
    else 'sent' end;

  if m.status = 'delivered' and v_target = 'delivered' then
    return jsonb_build_object('status','already', 'message_id', m.id);
  end if;
  if m.status in ('failed','refunded') then
    return jsonb_build_object('status','already', 'message_id', m.id, 'message_status', m.status);
  end if;

  if v_target = 'delivered' then
    update public.sms_messages set status = 'delivered', delivered_at = coalesce(p_time, now()) where id = m.id;
    return jsonb_build_object('status','delivered', 'message_id', m.id, 'order_id', m.order_id);
  elsif v_target = 'failed' then
    update public.sms_messages set status = 'failed', error_code = coalesce(p_error, 'DLR_FAILED') where id = m.id;
    perform public.rpc_refund_message(m.id, coalesce(p_error, 'DLR_FAILED'));
    return jsonb_build_object('status','failed', 'message_id', m.id, 'order_id', m.order_id, 'refunded', true);
  else
    update public.sms_messages set status = 'sent' where id = m.id and status in ('queued','sending');
    return jsonb_build_object('status','sent', 'message_id', m.id);
  end if;
end;
$$;

-- ===================== rpc_approve_topup =====================
create or replace function public.rpc_approve_topup(
  p_topup_id uuid,
  p_credit_amount numeric,
  p_admin_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  t public.topup_requests%rowtype;
  v_bal numeric;
  v_desc text;
  v_report public.crypto_payment_reports%rowtype;
begin
  if not public.has_permission('credit.approve') then
    raise exception 'NO_PERMISSION' using errcode = '403';
  end if;

  select * into t from public.topup_requests where id = p_topup_id for update;
  if not found then raise exception 'TOPUP_NOT_FOUND' using errcode = '404'; end if;
  if t.status in ('approved','rejected','expired') then
    raise exception 'ALREADY_SETTLED' using errcode = '409';
  end if;
  if p_credit_amount is null or p_credit_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '422';
  end if;

  insert into public.wallets (user_id, balance, reserved) values (t.user_id, 0, 0) on conflict do nothing;
  update public.wallets set balance = balance + p_credit_amount, updated_at = now()
  where user_id = t.user_id
  returning balance into v_bal;

  v_desc := case when t.method = 'bank'
      then 'Kredi Yükleme (Havale) - ' || t.reference_code
      else 'Kredi Yükleme (Kripto) - ' || coalesce((
             select asset || ' ' || network || ' - TXID ' || txid
             from public.crypto_payment_reports where topup_request_id = t.id limit 1), t.reference_code)
    end;

  insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
  values (t.user_id, 'topup', p_credit_amount, p_credit_amount, v_bal, 'topup', t.id::text, v_desc);

  update public.topup_requests
  set status = 'approved', approved_by = auth.uid(), approved_at = now(),
      approved_amount_try = p_credit_amount, note = coalesce(p_admin_note, note)
  where id = t.id;

  insert into public.notifications (user_id, type, title, body)
  values (t.user_id, 'topup_approved', 'Kredi Yükleme Onaylandı',
          p_credit_amount || ' TL hesabınıza tanımlandı. Referans: ' || t.reference_code);

  return jsonb_build_object('status','approved', 'topup_id', t.id, 'credited', p_credit_amount,
    'balance_after', v_bal, 'user_id', t.user_id);
end;
$$;

-- ===================== rpc_admin_adjust =====================
create or replace function public.rpc_admin_adjust(
  p_user_id uuid,
  p_amount numeric,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_bal numeric;
begin
  if not public.has_permission('credit.adjust') then
    raise exception 'NO_PERMISSION' using errcode = '403';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '422';
  end if;

  insert into public.wallets (user_id, balance, reserved) values (p_user_id, 0, 0) on conflict do nothing;
  update public.wallets set balance = balance + p_amount, updated_at = now()
  where user_id = p_user_id and balance + p_amount >= 0
  returning balance into v_bal;
  if v_bal is null then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '402';
  end if;

  insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, description)
  values (p_user_id, 'adjust', p_amount, p_amount, v_bal, 'admin', coalesce(p_description, 'Manuel bakiye düzeltmesi'));

  return jsonb_build_object('status','adjusted', 'user_id', p_user_id, 'amount', p_amount, 'balance_after', v_bal);
end;
$$;

-- ===================== worker: parti al =====================
create or replace function public.rpc_claim_send_batch(p_limit int default 250)
returns setof public.sms_messages
language plpgsql security definer set search_path = public
as $$
declare
  v_max_attempts int;
begin
  select value::int into v_max_attempts from public.system_settings where key = 'send_max_attempts';
  v_max_attempts := coalesce(v_max_attempts, 3);

  -- bekleyen siparişleri işaretle
  update public.orders o
  set status = 'processing'
  where o.status in ('pending','scheduled')
    and exists (
      select 1 from public.sms_messages m
      where m.order_id = o.id and m.status = 'queued' and m.next_attempt_at <= now()
    );

  return query
  with claimed as (
    select m.id from public.sms_messages m
    where m.status = 'queued' and m.next_attempt_at <= now() and m.attempts < v_max_attempts
    order by m.created_at
    limit p_limit
    for update skip locked
  )
  update public.sms_messages m
  set status = 'sending', attempts = m.attempts + 1
  from claimed c
  where m.id = c.id
  returning m.*;
end;
$$;

-- ===================== worker: gönderim sonucu =====================
create or replace function public.rpc_complete_send(
  p_message_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.sms_messages%rowtype;
  v_max_attempts int;
begin
  select * into m from public.sms_messages where id = p_message_id for update;
  if not found or m.status <> 'sending' then
    return jsonb_build_object('status','ignored');
  end if;
  select value::int into v_max_attempts from public.system_settings where key = 'send_max_attempts';
  v_max_attempts := coalesce(v_max_attempts, 3);

  if p_ok then
    return public.rpc_finalize_message(p_message_id, p_provider_message_id);
  elsif m.attempts >= v_max_attempts then
    update public.sms_messages set status = 'failed', error_code = coalesce(p_error,'PROVIDER_ERROR') where id = m.id;
    perform public.rpc_refund_message(p_message_id, coalesce(p_error, 'PROVIDER_ERROR'));
    update public.orders set failed_count = failed_count + 1,
      status = case when processed_count + failed_count + 1 >= total_count then
        case when processed_count = 0 then 'failed' else 'completed' end else status end
    where id = m.order_id;
    return jsonb_build_object('status','failed', 'message_id', m.id, 'refunded', true);
  else
    -- tekrar dene
    update public.sms_messages
    set status = 'queued', next_attempt_at = now() + (interval '1 minute' * power(2, attempts))
    where id = m.id;
    return jsonb_build_object('status','retry_scheduled', 'message_id', m.id, 'attempts', m.attempts);
  end if;
end;
$$;

-- ===================== worker: 22:00 kuralı =====================
create or replace function public.rpc_cancel_out_of_window()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count int := 0; r record; v_start int; v_end int;
begin
  select value::int into v_start from public.system_settings where key = 'sending_start_hour';
  select value::int into v_end from public.system_settings where key = 'sending_end_hour';
  v_start := coalesce(v_start, 10); v_end := coalesce(v_end, 22);

  for r in
    select o.id from public.orders o
    where o.status = 'scheduled' and o.scheduled_at < now()
    for update skip locked
  loop
    -- vakti gelen scheduled sipariş sıradaki worker partisine düşer; burada iptal edilmez
    null;
  end loop;

  -- vakti gelmiş scheduled mesajlar pencere dışındaysa iptal et
  with cancelled as (
    update public.sms_messages m
    set status = 'refunded', error_code = 'OUTSIDE_SENDING_WINDOW', refunded_at = now()
    from public.orders o
    where m.order_id = o.id and m.status = 'queued'
      and o.status in ('pending','scheduled')
      and (m.next_attempt_at::time < make_time(v_start,0,0) or m.next_attempt_at::time >= make_time(v_end,0,0))
    returning m.id, m.user_id, m.cost, m.order_id
  ), refund as (
    insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
    select c.user_id, 'refund', c.cost, c.cost,
           (select balance + c.cost from public.wallets w where w.user_id = c.user_id),
           'message', c.id::text, 'Gönderim süresi doldu / pencere dışı iptal'
    from cancelled c
  ), wallet as (
    update public.wallets w
    set balance = balance + c.cost, reserved = greatest(w.reserved - c.cost, 0), updated_at = now()
    from cancelled c
    where w.user_id = c.user_id
  ), orderupd as (
    update public.orders o
    set status = 'cancelled',
        failed_count = o.failed_count + (select count(*) from cancelled c where c.order_id = o.id),
        note = coalesce(o.note,'') || ' [Pencere dışı iptal]'
    from (select distinct order_id from cancelled) c
    where o.id = c.order_id
  )
  select count(*) into v_count from cancelled;
  return v_count;
end;
$$;

-- ===================== worker: süresi dolan kredi talepleri =====================
create or replace function public.rpc_expire_topups()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  with expired as (
    update public.topup_requests
    set status = 'expired'
    where status = 'pending'
      and created_at < now() - (select make_interval(mins => request_ttl_minutes) from public.payment_settings limit 1)
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

-- ===================== yetkilendirilmiş kayıt işlemleri =====================
-- (RLS yazma kapalı; panel yazmaları bu fonksiyonlarla yapılır)
create or replace function public.rpc_upsert_blacklist(p_phones text[], p_remove boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int := 0; p text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;
  if not public.has_permission('blacklist.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  foreach p in array p_phones loop
    if p_remove then
      delete from public.blacklist where user_id = v_uid and phone = public.normalize_phone(p);
      if found then v_n := v_n + 1; end if;
    else
      insert into public.blacklist (user_id, phone) values (v_uid, public.normalize_phone(p))
      on conflict (user_id, phone) do nothing;
      if found then v_n := v_n + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('count', v_n);
end; $$;

create or replace function public.rpc_create_contact_list(p_title text, p_numbers text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_n int := 0; p text; v_norm text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;
  if not public.has_permission('contacts.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  insert into public.contact_lists (user_id, title) values (v_uid, p_title) returning id into v_id;
  foreach p in array p_numbers loop
    v_norm := public.normalize_phone(p);
    if v_norm is not null then
      insert into public.contacts (list_id, phone) values (v_id, v_norm)
      on conflict (list_id, phone) do nothing;
      if found then v_n := v_n + 1; end if;
    end if;
  end loop;
  update public.contact_lists set count = v_n where id = v_id;
  return jsonb_build_object('id', v_id, 'count', v_n);
end; $$;

create or replace function public.rpc_create_topup(p_method text, p_amount_try numeric, p_receipt_path text default null,
  p_sender_name text default null, p_note text default null, p_asset_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_ref text; v_id uuid; v_open int;
  v_min numeric; v_max numeric; v_max_open int;
  a public.crypto_assets%rowtype; v_est numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;
  if not public.has_permission('credit.topup') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;

  select min_topup_try, max_topup_try, max_open_requests into v_min, v_max, v_max_open
  from public.payment_settings limit 1;
  if p_amount_try < coalesce(v_min,100) or p_amount_try > coalesce(v_max,500000) then
    raise exception 'AMOUNT_OUT_OF_RANGE' using errcode = '422';
  end if;
  select count(*) into v_open from public.topup_requests where user_id = v_uid and status in ('pending','reported');
  if v_open >= coalesce(v_max_open,3) then
    raise exception 'TOO_MANY_OPEN_REQUESTS' using errcode = '422';
  end if;

  loop
    v_ref := 'WOLT-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0');
    exit when not exists (select 1 from public.topup_requests where reference_code = v_ref);
  end loop;

  v_est := null;
  if p_method = 'crypto' then
    select * into a from public.crypto_assets where id = p_asset_id and is_active for update;
    if not found then raise exception 'ASSET_NOT_FOUND' using errcode = '404'; end if;
    v_est := round(p_amount_try / nullif(a.rate_try,0), 8);
  end if;

  insert into public.topup_requests (user_id, method, amount_try, reference_code, receipt_path, sender_name, note, wallet_address_snapshot)
  values (v_uid, p_method, p_amount_try, v_ref, p_receipt_path, p_sender_name, p_note,
          case when p_method = 'crypto' then a.wallet_address else null end)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'reference_code', v_ref, 'method', p_method, 'amount_try', p_amount_try,
    'status', 'pending', 'wallet_address', case when p_method='crypto' then a.wallet_address else null end,
    'memo_tag', case when p_method='crypto' then a.memo_tag else null end,
    'asset', case when p_method='crypto' then a.asset else null end,
    'network', case when p_method='crypto' then a.network else null end,
    'estimated_crypto', v_est,
    'explorer_template', case when p_method='crypto' then a.explorer_tx_url_template else null end,
    'created_at', now()
  );
end; $$;

create or replace function public.rpc_report_topup(p_topup_id uuid, p_txid text, p_sent_amount numeric,
  p_sent_at timestamptz default null, p_from_address text default null, p_user_note text default null, p_receipt_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.topup_requests%rowtype; a public.crypto_assets%rowtype; v_rate numeric;
begin
  select * into t from public.topup_requests where id = p_topup_id and user_id = auth.uid() for update;
  if not found then raise exception 'TOPUP_NOT_FOUND' using errcode = '404'; end if;
  if t.status not in ('pending') then raise exception 'INVALID_STATUS' using errcode = '409'; end if;
  if t.method <> 'crypto' then raise exception 'NOT_CRYPTO' using errcode = '422'; end if;
  if p_txid is null or btrim(p_txid) = '' then raise exception 'TXID_REQUIRED' using errcode = '422'; end if;

  select * into a from public.crypto_assets where wallet_address = t.wallet_address_snapshot limit 1;
  v_rate := coalesce(a.rate_try, 1);

  insert into public.crypto_payment_reports (topup_request_id, asset, network, txid, sent_amount, sent_at, from_address, receipt_path, user_note, rate_try_applied)
  values (t.id, coalesce(a.asset,'?'), coalesce(a.network,'?'), btrim(p_txid), p_sent_amount,
          coalesce(p_sent_at, now()), p_from_address, p_receipt_path, p_user_note, v_rate);

  update public.topup_requests set status = 'reported', receipt_path = coalesce(p_receipt_path, receipt_path) where id = t.id;
  insert into public.notifications (user_id, type, title, body)
  select p.user_id, 'topup_reported', 'Yeni Kripto Ödeme Bildirimi', t.reference_code || ' - TXID: ' || p_txid
  from public.profiles p where public.has_permission('credit.approve') limit 1;

  return jsonb_build_object('status','reported', 'topup_id', t.id, 'txid', p_txid);
end; $$;

create or replace function public.rpc_report_bank_topup(p_topup_id uuid, p_sender_name text default null, p_note text default null, p_receipt_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.topup_requests%rowtype;
begin
  select * into t from public.topup_requests where id = p_topup_id and user_id = auth.uid() for update;
  if not found then raise exception 'TOPUP_NOT_FOUND' using errcode = '404'; end if;
  if t.status <> 'pending' then raise exception 'INVALID_STATUS' using errcode = '409'; end if;
  update public.topup_requests
  set status = 'reported', sender_name = coalesce(p_sender_name, sender_name),
      note = coalesce(p_note, note), receipt_path = coalesce(p_receipt_path, receipt_path)
  where id = t.id;
  return jsonb_build_object('status','reported', 'topup_id', t.id);
end; $$;

create or replace function public.rpc_reject_topup(p_topup_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.topup_requests%rowtype;
begin
  if not public.has_permission('credit.approve') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED' using errcode = '422'; end if;
  select * into t from public.topup_requests where id = p_topup_id for update;
  if not found then raise exception 'TOPUP_NOT_FOUND' using errcode = '404'; end if;
  if t.status in ('approved','rejected','expired') then raise exception 'ALREADY_SETTLED' using errcode = '409'; end if;
  update public.topup_requests set status = 'rejected', reject_reason = p_reason, approved_by = auth.uid() where id = t.id;
  insert into public.notifications (user_id, type, title, body)
  values (t.user_id, 'topup_rejected', 'Kredi Yükleme Reddedildi', t.reference_code || ' - Gerekçe: ' || p_reason);
  return jsonb_build_object('status','rejected', 'topup_id', t.id);
end; $$;

create or replace function public.rpc_save_api_key(p_key_id uuid, p_name text, p_ip_whitelist jsonb, p_callback_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;
  if not public.has_permission('apikey.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  update public.api_keys set name = coalesce(p_name, name), ip_whitelist = coalesce(p_ip_whitelist, ip_whitelist),
         callback_url = p_callback_url
  where id = p_key_id and user_id = v_uid
  returning id into v_uid;
  if not found then raise exception 'NOT_FOUND' using errcode = '404'; end if;
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.rpc_delete_api_key(p_key_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;
  delete from public.api_keys where id = p_key_id and user_id = v_uid;
  if not found then raise exception 'NOT_FOUND' using errcode = '404'; end if;
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.rpc_create_short_url(p_original_url text, p_business_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;
  if not public.has_permission('shorturl.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  insert into public.short_urls (user_id, business_name, original_url, slug)
  values (v_uid, p_business_name, p_original_url, p_slug) returning id into v_id;
  return jsonb_build_object('id', v_id, 'slug', p_slug);
end; $$;

create or replace function public.rpc_delete_short_url(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from public.short_urls where id = p_id and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND' using errcode = '404'; end if;
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.rpc_create_ticket(p_subject text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;
  insert into public.support_tickets (user_id, subject, status) values (v_uid, p_subject, 'open') returning id into v_id;
  insert into public.ticket_messages (ticket_id, user_id, is_admin, body) values (v_id, v_uid, false, p_body);
  return jsonb_build_object('id', v_id);
end; $$;

create or replace function public.rpc_reply_ticket(p_ticket_id uuid, p_body text, p_is_admin boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.support_tickets%rowtype; v_uid uuid := auth.uid();
begin
  select * into t from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = '404'; end if;
  if p_is_admin then
    if not public.has_permission('support.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  elsif t.user_id <> v_uid then raise exception 'NOT_FOUND' using errcode = '404'; end if;
  insert into public.ticket_messages (ticket_id, user_id, is_admin, body) values (t.id, v_uid, p_is_admin, p_body);
  update public.support_tickets set status = case when p_is_admin then 'answered' else 'open' end, updated_at = now() where id = t.id;
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.rpc_set_ticket_status(p_ticket_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('support.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  update public.support_tickets set status = p_status where id = p_ticket_id;
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.rpc_create_user(
  p_email text, p_password text, p_username text, p_name text,
  p_phone text, p_role_id uuid, p_quota_type text, p_unit_price numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_profile_id uuid; v_auth uuid;
begin
  if not public.has_permission('users.create') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  if exists (select 1 from public.profiles where username = lower(p_username)) then
    raise exception 'USERNAME_TAKEN' using errcode = '409';
  end if;
  v_auth := gen_random_uuid();
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, aud, role, created_at, updated_at)
  values (v_auth, '00000000-0000-0000-0000-000000000000', lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
          now(), '{"provider":"email","providers":["email"]}'::jsonb, 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, username, name, phone, role_id, quota_type, created_by)
  values (v_auth, lower(p_username), p_name, p_phone, p_role_id, coalesce(p_quota_type,'variable'), auth.uid());
  insert into public.wallets (user_id, balance, reserved) values (v_auth, 0, 0);
  if p_unit_price is not null then
    insert into public.pricing (user_id, unit_price) values (v_auth, p_unit_price) on conflict (user_id) do update set unit_price = excluded.unit_price;
  end if;
  insert into public.audit_logs (actor_id, action, payload)
  values (auth.uid(), 'user.create', jsonb_build_object('username', p_username, 'email', p_email));
  return jsonb_build_object('id', v_auth, 'username', lower(p_username));
end; $$;

-- kullanıcı adı → auth e-posta (giriş için)
create or replace function public.resolve_username_email(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select u.email from public.profiles p join auth.users u on u.id = p.id
  where lower(p.username) = lower(p_username) and p.is_active;
$$;

-- ===================== yetki & imzalı okuma yardımcıları =====================
-- (service_role ile çağrılır; auth.uid() boş olabilir, actor parametreli versiyonlar)
create or replace function public.admin_set_user_active(p_user_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('users.edit') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  update public.profiles set is_active = p_active where id = p_user_id;
  insert into public.audit_logs (actor_id, action, payload) values (auth.uid(), 'user.toggle_active',
    jsonb_build_object('user_id', p_user_id, 'active', p_active));
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.admin_update_role(p_role_id uuid, p_name text, p_read_only boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('roles.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  update public.roles set name = p_name, read_only = p_read_only where id = p_role_id;
  insert into public.audit_logs (actor_id, action, payload) values (auth.uid(), 'role.update',
    jsonb_build_object('role_id', p_role_id, 'name', p_name));
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.admin_create_role(p_name text, p_read_only boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('roles.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  insert into public.roles (name, read_only) values (p_name, p_read_only) returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $$;

create or replace function public.admin_set_role_permissions(p_role_id uuid, p_codes text[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('roles.manage') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_code)
  select p_role_id, c from unnest(p_codes) c
  where exists (select 1 from public.permissions where code = c);
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.admin_update_user(p_user_id uuid, p_name text, p_phone text, p_role_id uuid,
  p_quota_type text, p_email text, p_unit_price numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('users.edit') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  update public.profiles set name = coalesce(p_name, name), phone = coalesce(p_phone, phone),
         role_id = coalesce(p_role_id, role_id), quota_type = coalesce(p_quota_type, quota_type)
  where id = p_user_id;
  if p_email is not null then
    update auth.users set email = lower(p_email), updated_at = now() where id = p_user_id;
  end if;
  if p_unit_price is not null then
    insert into public.pricing (user_id, unit_price) values (p_user_id, p_unit_price)
    on conflict (user_id) do update set unit_price = excluded.unit_price;
  end if;
  insert into public.audit_logs (actor_id, action, payload) values (auth.uid(), 'user.update',
    jsonb_build_object('user_id', p_user_id));
  return jsonb_build_object('status','ok');
end; $$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('users.delete') then raise exception 'NO_PERMISSION' using errcode = '403'; end if;
  delete from auth.users where id = p_user_id;
  insert into public.audit_logs (actor_id, action, payload) values (auth.uid(), 'user.delete',
    jsonb_build_object('user_id', p_user_id));
  return jsonb_build_object('status','ok');
end; $$;

-- ===================== rpc_cancel_order =====================
-- Panelden sipariş iptali: gönderilmemiş (queued) mesajların rezervi iade edilir.
-- Sipariş zaten completed/failed/cancelled ise idempotent döner.
create or replace function public.rpc_cancel_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders%rowtype;
  v_uid uuid := auth.uid();
  v_refunded numeric := 0;
  v_count int := 0;
  v_bal numeric := 0;
  v_res numeric := 0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '401'; end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = '404'; end if;
  if o.user_id <> v_uid and not public.has_permission('users.manage') then
    raise exception 'NO_PERMISSION' using errcode = '403';
  end if;

  if o.status in ('completed','failed','cancelled') then
    return jsonb_build_object('status','already_settled','order_id', o.id,'order_status', o.status);
  end if;

  -- yalnız gönderilmemiş mesajlar iade edilir (sending/sent olanlar sağlayıcıya gitmiştir)
  with cancelled as (
    update public.sms_messages
    set status = 'refunded', error_code = 'ORDER_CANCELLED', refunded_at = now()
    where order_id = o.id and status = 'queued'
    returning cost
  )
  select coalesce(sum(cost),0), count(*) into v_refunded, v_count from cancelled;

  if v_count > 0 then
    update public.wallets
    set balance = balance + v_refunded,
        reserved = greatest(reserved - v_refunded, 0),
        updated_at = now()
    where user_id = o.user_id
    returning balance, reserved into v_bal, v_res;

    insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
    values (o.user_id, 'refund', v_refunded, v_refunded, v_bal, 'order', o.id::text,
            'Sipariş iptali (' || v_count || ' mesaj iade edildi)');
  else
    select balance, reserved into v_bal, v_res from public.wallets where user_id = o.user_id for update;
  end if;

  update public.orders
  set status = 'cancelled',
      failed_count = failed_count + v_count,
      note = coalesce(note,'') || ' [Kullanıcı iptali]'
  where id = o.id;

  insert into public.audit_logs (actor_id, action, payload)
  values (v_uid, 'order.cancel', jsonb_build_object('order_id', o.id,'refunded', v_refunded,'messages', v_count));

  return jsonb_build_object(
    'status','cancelled','order_id', o.id,
    'refunded', v_refunded,'cancelled_messages', v_count,
    'balance', v_bal,'reserved', v_res
  );
end;
$$;

-- ===================== RPC'leri authenticated role'e aç =====================
grant execute on function public.rpc_create_order(jsonb, text, timestamptz, text, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.user_has_permission(uuid, text) to authenticated, service_role;
grant execute on function public.rpc_finalize_message(uuid, text) to authenticated;
grant execute on function public.rpc_refund_message(uuid, text) to authenticated;
grant execute on function public.rpc_cancel_order(uuid) to authenticated;
grant execute on function public.rpc_apply_dlr(text, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_approve_topup(uuid, numeric, text) to authenticated;
grant execute on function public.rpc_admin_adjust(uuid, numeric, text) to authenticated;
grant execute on function public.rpc_get_balance(uuid) to authenticated;
grant execute on function public.rpc_upsert_blacklist(text[], boolean) to authenticated;
grant execute on function public.rpc_create_contact_list(text, text[]) to authenticated;
grant execute on function public.rpc_create_topup(text, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.rpc_report_topup(uuid, text, numeric, timestamptz, text, text, text) to authenticated;
grant execute on function public.rpc_report_bank_topup(uuid, text, text, text) to authenticated;
grant execute on function public.rpc_reject_topup(uuid, text) to authenticated;
grant execute on function public.rpc_save_api_key(uuid, text, jsonb, text) to authenticated;
grant execute on function public.rpc_delete_api_key(uuid) to authenticated;
grant execute on function public.rpc_create_short_url(text, text, text) to authenticated;
grant execute on function public.rpc_delete_short_url(uuid) to authenticated;
grant execute on function public.rpc_create_ticket(text, text) to authenticated;
grant execute on function public.rpc_reply_ticket(uuid, text, boolean) to authenticated;
grant execute on function public.rpc_set_ticket_status(uuid, text) to authenticated;
grant execute on function public.rpc_create_user(text, text, text, text, text, uuid, text, numeric) to authenticated;
grant execute on function public.resolve_username_email(text) to authenticated, service_role;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_update_role(uuid, text, boolean) to authenticated;
grant execute on function public.admin_create_role(text, boolean) to authenticated;
grant execute on function public.admin_set_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, uuid, text, text, numeric) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_any_permission(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.sms_segments(text) to authenticated;
grant execute on function public.sms_detect_encoding(text) to authenticated;
grant execute on function public.normalize_phone(text) to authenticated;
grant execute on function public.normalize_recipients(text) to authenticated;
grant execute on function public.short_url_click(text) to anon, authenticated, service_role;
grant execute on function public.rate_limit_check(text, int, int) to authenticated, service_role;

-- worker fonksiyonları: yalnız service_role
grant execute on function public.rpc_claim_send_batch(int) to service_role;
grant execute on function public.rpc_complete_send(uuid, boolean, text, text) to service_role;
grant execute on function public.rpc_cancel_out_of_window() to service_role;
grant execute on function public.rpc_expire_topups() to service_role;
