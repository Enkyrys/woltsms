-- =====================================================================
-- WOLTSMS - 0004 : Prompta uyum düzeltmeleri
-- 0001-0003 SONRASINDA çalıştırılır (idempotent: create or replace / if not exists).
--
--  1) GÜVENLİK   : RPC'lerin EXECUTE yetkileri sıkılaştırıldı (anon/authenticated
--                  artık rpc_refund/finalize/apply_dlr/claim vb. çağıramaz).
--  2) SAAT DİLİMİ: Gönderim penceresi (10:00-22:00) Europe/Istanbul'a göre hesaplanır
--                  (önceden oturum saat dilimine / UTC'ye göre hesaplanıyordu).
--  3) BAKİYE     : Gönderilmiş mesajın DLR iadesinde 'reserved' yanlışlıkla
--                  düşülüyordu; toplu iptalde kullanıcı başına yalnız 1 mesaj
--                  iade ediliyordu; failed_count iki kez artıyordu. Düzeltildi.
--  4) IDEMPOTENCY: Kilit sonrası kontrol + istek özeti (aynı anahtar, farklı istek => 422).
--  5) SEGMENT    : Standart GSM 03.38 tablosu + UCS-2 için UTF-16 birim sayımı.
--  6) ONAY       : Kendi talebini onaylama engeli, kripto için TXID bildirimi şartı,
--                  onay/ret/manuel kredi için audit_logs kaydı.
--  7) ÇALIŞMA    : Takılı kalan 'sending' mesajlar için kurtarma + cron işleri.
-- =====================================================================

-- ===================== 0) Saat dilimi yardımcıları =====================
create or replace function public.in_sending_window(p_at timestamptz default now())
returns boolean
language plpgsql stable set search_path = public
as $$
declare v_start int; v_end int; v_hour int;
begin
  select value::int into v_start from public.system_settings where key = 'sending_start_hour';
  select value::int into v_end   from public.system_settings where key = 'sending_end_hour';
  v_start := coalesce(v_start, 10);
  v_end   := coalesce(v_end, 22);
  v_hour  := extract(hour from (p_at at time zone 'Europe/Istanbul'))::int;
  return v_hour >= v_start and v_hour < v_end;
end;
$$;

-- p_at pencere içindeyse kendisini, değilse penceredeki ilk uygun anı döner.
create or replace function public.next_window_start(p_at timestamptz default now())
returns timestamptz
language plpgsql stable set search_path = public
as $$
declare v_start int; v_local timestamp; v_day date; v_hour int;
begin
  if public.in_sending_window(p_at) then
    return p_at;
  end if;
  select value::int into v_start from public.system_settings where key = 'sending_start_hour';
  v_start := coalesce(v_start, 10);
  v_local := p_at at time zone 'Europe/Istanbul';
  v_day   := v_local::date;
  v_hour  := extract(hour from v_local)::int;
  if v_hour < v_start then
    return (v_day + make_time(v_start, 0, 0)) at time zone 'Europe/Istanbul';
  end if;
  return ((v_day + 1) + make_time(v_start, 0, 0)) at time zone 'Europe/Istanbul';
end;
$$;

-- ===================== 5) Segment / kodlama =====================
-- GSM 03.38 temel alfabe (tek septet) + genişletme tablosu (2 septet).
-- Türkçe ş Ş ğ Ğ ı İ ve küçük ç tabloda YOK => UCS-2. (Ç, ö, ü, Ö, Ü tabloda VAR.)
create or replace function public.sms_detect_encoding(p_msg text)
returns text
language plpgsql immutable
as $$
declare
  v_basic text := '@£$¥èéùìòÇ' || chr(10) || 'Øø' || chr(13) || 'ÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ'
                  || ' !"#¤%&''()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  v_ext text := '^{}\[~]|€';
  ch text;
begin
  if p_msg is null then return 'GSM'; end if;
  for i in 1..char_length(p_msg) loop
    ch := substring(p_msg from i for 1);
    if position(ch in v_basic) = 0 and position(ch in v_ext) = 0 then
      return 'UCS2';
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
  if p_msg is null then return 0; end if;
  for i in 1..char_length(p_msg) loop
    ch := substring(p_msg from i for 1);
    if position(ch in '^{}\[~]|€') > 0 then len := len + 2; else len := len + 1; end if;
  end loop;
  return len;
end;
$$;

-- UCS-2 uzunluğu = UTF-16 kod birimi sayısı (emoji gibi BMP dışı karakter = 2)
create or replace function public.sms_ucs2_length(p_msg text)
returns integer
language plpgsql immutable
as $$
declare len int := 0; ch text;
begin
  if p_msg is null then return 0; end if;
  for i in 1..char_length(p_msg) loop
    ch := substring(p_msg from i for 1);
    if ascii(ch) > 65535 then len := len + 2; else len := len + 1; end if;
  end loop;
  return len;
end;
$$;

create or replace function public.sms_segments(p_msg text)
returns integer
language plpgsql immutable
as $$
declare enc text; len int; per int;
begin
  if p_msg is null or p_msg = '' then return 0; end if;
  enc := public.sms_detect_encoding(p_msg);
  if enc = 'UCS2' then
    len := public.sms_ucs2_length(p_msg);
    per := case when len <= 70 then 70 else 67 end;
  else
    len := public.sms_gsm_length(p_msg);
    per := case when len <= 160 then 160 else 153 end;
  end if;
  return greatest(1, ceil(len::numeric / per)::int);
end;
$$;

-- ===================== sipariş durumunu mesajlardan yeniden hesapla =====================
create or replace function public.rpc_refresh_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_ok int; v_fail int; v_total int;
begin
  select total_count into v_total from public.orders where id = p_order_id;
  if not found then return; end if;
  select count(*) filter (where status in ('sent','delivered')),
         count(*) filter (where status in ('failed','refunded'))
    into v_ok, v_fail
  from public.sms_messages where order_id = p_order_id;

  update public.orders
  set processed_count = v_ok,
      failed_count = v_fail,
      status = case
        when status = 'cancelled' then status
        when v_ok + v_fail >= v_total then
          case when v_ok > 0 then 'completed' when v_fail > 0 then 'failed' else status end
        else status
      end
  where id = p_order_id;
end;
$$;

-- ===================== rpc_create_order =====================
create or replace function public.rpc_create_order(
  p_recipients jsonb,
  p_message text,
  p_schedule_at timestamptz default null,
  p_source text default 'panel',
  p_idempotency_key text default null,
  p_contact_list_id uuid default null,
  p_user_id uuid default null          -- yalnız service_role: API anahtarı sahibi
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
  v_raw text[];
  v_nums text[];
  v_bl text[];
  v_effective text[];
  v_input_count int;
  v_enc text;
  v_segments int;
  v_unit numeric(18,6);
  v_msg_cost numeric(18,4);
  v_cost numeric(18,4);
  v_bal numeric(18,4);
  v_order_id uuid;
  v_now timestamptz := now();
  v_scheduled timestamptz;
  v_blacklisted int := 0;
  v_max_recipients int;
  v_hash text;
  v_prev record;
  v_result jsonb;
  v_start_hour int;
  v_end_hour int;
begin
  -- kimlik
  if v_uid is null then
    if v_jwt_role = 'service_role' and p_user_id is not null then
      v_uid := p_user_id;
      v_on_behalf := true;
    else
      raise exception 'AUTH_REQUIRED' using errcode = '401';
    end if;
  end if;

  -- KULLANICI SATIRINI KİLİTLE: aynı kullanıcının eşzamanlı istekleri sıraya girer
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or not v_profile.is_active then
    raise exception 'ACCOUNT_DISABLED' using errcode = '403';
  end if;

  if v_on_behalf then
    if not public.user_has_permission(v_uid, 'sms.send') then
      raise exception 'NO_PERMISSION' using errcode = '403';
    end if;
  elsif not public.has_permission('sms.send') then
    raise exception 'NO_PERMISSION' using errcode = '403';
  end if;

  if p_message is null or btrim(p_message) = '' then
    raise exception 'EMPTY_MESSAGE' using errcode = '400';
  end if;

  -- idempotency (kilit alındıktan SONRA; yarış durumu kapalı)
  v_hash := md5(coalesce(p_message, '') || '|' || coalesce(p_recipients::text, '') || '|'
                || coalesce(p_schedule_at::text, '') || '|' || coalesce(p_contact_list_id::text, ''));
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select request_hash, response into v_prev
    from public.idempotency_keys where user_id = v_uid and key = p_idempotency_key;
    if found then
      if v_prev.request_hash is distinct from v_hash then
        raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '422';
      end if;
      return v_prev.response;
    end if;
  end if;

  -- alıcılar
  if p_contact_list_id is not null then
    select coalesce(array_agg(c.phone), '{}'::text[]) into v_raw
    from public.contacts c
    join public.contact_lists cl on cl.id = c.list_id
    where c.list_id = p_contact_list_id and cl.user_id = v_uid;
  else
    select coalesce(array_agg(distinct btrim(x)), '{}'::text[]) into v_raw
    from jsonb_array_elements_text(p_recipients) x where btrim(coalesce(x, '')) <> '';
  end if;
  v_input_count := coalesce(array_length(v_raw, 1), 0);
  if v_input_count = 0 then
    raise exception 'EMPTY_RECIPIENTS' using errcode = '400';
  end if;

  select coalesce(array_agg(distinct n), '{}'::text[]) into v_nums
  from (select public.normalize_phone(x) as n from unnest(v_raw) x) s where n is not null;
  if coalesce(array_length(v_nums, 1), 0) = 0 then
    raise exception 'NO_VALID_RECIPIENTS' using errcode = '422';
  end if;

  select value::int into v_max_recipients from public.system_settings where key = 'max_recipients_per_order';
  if v_max_recipients is not null and array_length(v_nums, 1) > v_max_recipients then
    raise exception 'TOO_MANY_RECIPIENTS' using errcode = '422';
  end if;

  -- kara liste (kullanıcı + global)
  select coalesce(array_agg(phone), '{}'::text[]) into v_bl
  from public.blacklist where user_id = v_uid or user_id is null;
  select coalesce(array_agg(n), '{}'::text[]) into v_effective
  from unnest(v_nums) n where not (n = any(v_bl));
  v_blacklisted := array_length(v_nums, 1) - coalesce(array_length(v_effective, 1), 0);
  if coalesce(array_length(v_effective, 1), 0) = 0 then
    raise exception 'ALL_BLACKLISTED' using errcode = '422';
  end if;

  -- segment / maliyet (toplam = mesaj başına maliyet x alıcı; iadeler toplamı tam tutar)
  v_enc := public.sms_detect_encoding(p_message);
  v_segments := public.sms_segments(p_message);
  v_unit := public.get_unit_price(v_uid);
  v_msg_cost := round(v_segments * v_unit, 4);
  v_cost := v_msg_cost * array_length(v_effective, 1);

  -- gönderim penceresi (Europe/Istanbul)
  select value::int into v_start_hour from public.system_settings where key = 'sending_start_hour';
  select value::int into v_end_hour from public.system_settings where key = 'sending_end_hour';
  if p_schedule_at is null then
    if not public.in_sending_window(v_now) then
      return jsonb_build_object(
        'status', 'cancelled', 'reason', 'OUTSIDE_SENDING_WINDOW',
        'message', 'Gönderimler ' || coalesce(v_start_hour, 10) || ':00–' || coalesce(v_end_hour, 22)
                   || ':00 arasında aktiftir.');
    end if;
    v_scheduled := v_now;
  else
    v_scheduled := public.next_window_start(greatest(p_schedule_at, v_now));
  end if;

  -- cüzdan kilidi + rezerve
  insert into public.wallets (user_id, balance, reserved) values (v_uid, 0, 0) on conflict do nothing;
  select balance into v_bal from public.wallets where user_id = v_uid for update;
  if v_bal < v_cost then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = '402';
  end if;
  update public.wallets
  set balance = balance - v_cost, reserved = reserved + v_cost, updated_at = now()
  where user_id = v_uid;

  insert into public.orders (user_id, status, total_count, total_cost, message, scheduled_at, source, created_by, idempotency_key)
  values (v_uid,
          case when v_scheduled > v_now + interval '1 minute' then 'scheduled' else 'pending' end,
          array_length(v_effective, 1), v_cost, p_message, v_scheduled,
          case when p_source in ('panel','api') then p_source else 'panel' end,
          v_uid, p_idempotency_key)
  returning id into v_order_id;

  -- tek sorguda toplu ekleme (binlerce alıcıda döngüden çok hızlı)
  insert into public.sms_messages (order_id, user_id, recipient, body, encoding, segments, cost, status, next_attempt_at)
  select v_order_id, v_uid, n, p_message, v_enc, v_segments, v_msg_cost, 'queued', v_scheduled
  from unnest(v_effective) n;

  insert into public.wallet_transactions (user_id, type, credit, unit_price, total_price, balance_after, ref_type, ref_id, description)
  values (v_uid, 'reserve', -v_cost, v_unit, v_cost, v_bal - v_cost, 'order', v_order_id::text,
          'Gönderim rezerve (' || array_length(v_effective, 1) || ' alıcı, ' || v_segments || ' segment)');

  insert into public.sent_message_history (user_id, body) values (v_uid, p_message);

  v_result := jsonb_build_object(
    'status', 'ok', 'order_id', v_order_id, 'total_count', array_length(v_effective, 1),
    'blacklisted_count', v_blacklisted, 'invalid_count', v_input_count - array_length(v_nums, 1),
    'segments', v_segments, 'encoding', v_enc, 'unit_price', v_unit, 'total_cost', v_cost,
    'balance_after', v_bal - v_cost, 'scheduled_at', v_scheduled
  );

  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into public.idempotency_keys (key, user_id, request_hash, response)
    values (p_idempotency_key, v_uid, v_hash, v_result)
    on conflict (user_id, key) do nothing;
  end if;

  return v_result;
end;
$$;

-- ===================== rpc_finalize_message =====================
-- rezerv kesinleşir (para harcandı). attempts claim sırasında zaten artırıldı.
create or replace function public.rpc_finalize_message(
  p_message_id uuid,
  p_provider_message_id text default null
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
  if m.status in ('sent','delivered') then
    return jsonb_build_object('status','already_finalized', 'message_id', m.id, 'message_status', m.status);
  end if;
  if m.status in ('failed','refunded') then
    raise exception 'ALREADY_SETTLED' using errcode = '409';
  end if;

  update public.wallets
  set reserved = greatest(reserved - m.cost, 0), updated_at = now()
  where user_id = m.user_id
  returning balance, reserved into v_bal, v_res;

  update public.sms_messages
  set status = 'sent',
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      sent_at = now(), error_code = null
  where id = m.id;

  insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
  values (m.user_id, 'debit', 0, m.cost, v_bal, 'message', m.id::text,
          'Gönderim kesinleşti (segment ' || m.segments || ')');

  perform public.rpc_refresh_order(m.order_id);
  return jsonb_build_object('status','finalized', 'message_id', m.id, 'order_id', m.order_id,
                            'balance', v_bal, 'reserved', v_res);
end;
$$;

-- ===================== rpc_refund_message =====================
-- Mesaj başına TEK iade. Rezerv yalnız mesaj henüz kesinleşmediyse (sent_at is null)
-- düşülür; kesinleşmiş mesajın iadesinde diğer siparişlerin rezervine dokunulmaz.
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
  v_was_reserved boolean;
begin
  select * into m from public.sms_messages where id = p_message_id for update;
  if not found then raise exception 'MESSAGE_NOT_FOUND' using errcode = '404'; end if;
  if m.status = 'refunded' then
    return jsonb_build_object('status','already_refunded', 'message_id', m.id);
  end if;
  if m.status = 'delivered' then
    raise exception 'ALREADY_DELIVERED' using errcode = '409';
  end if;

  v_was_reserved := (m.sent_at is null);

  update public.wallets
  set reserved = case when v_was_reserved then greatest(reserved - m.cost, 0) else reserved end,
      balance = balance + m.cost,
      updated_at = now()
  where user_id = m.user_id
  returning balance, reserved into v_bal, v_res;

  update public.sms_messages
  set status = 'refunded', refunded_at = now(), error_code = coalesce(p_reason, error_code)
  where id = m.id;

  insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
  values (m.user_id, 'refund', m.cost, m.cost, v_bal, 'message', m.id::text,
          coalesce('Gönderim iadesi: ' || p_reason, 'Gönderim iadesi'));

  perform public.rpc_refresh_order(m.order_id);
  return jsonb_build_object('status','refunded', 'message_id', m.id, 'balance', v_bal, 'amount', m.cost);
end;
$$;

-- ===================== rpc_apply_dlr (idempotent) =====================
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

  v_target := case upper(coalesce(p_state, ''))
    when 'DELIVRD' then 'delivered'
    when 'UNDELIV' then 'failed'
    when 'EXPIRED' then 'failed'
    when 'REJECTD' then 'failed'
    when 'DELETED' then 'failed'
    else 'sent' end;

  if m.status in ('delivered','failed','refunded') then
    return jsonb_build_object('status','already', 'message_id', m.id, 'message_status', m.status);
  end if;

  if v_target = 'delivered' then
    update public.sms_messages
    set status = 'delivered', delivered_at = coalesce(p_time, now())
    where id = m.id;
    perform public.rpc_refresh_order(m.order_id);
    return jsonb_build_object('status','delivered', 'message_id', m.id, 'order_id', m.order_id);
  elsif v_target = 'failed' then
    perform public.rpc_refund_message(m.id, coalesce(p_error, 'DLR_FAILED'));
    return jsonb_build_object('status','failed', 'message_id', m.id, 'order_id', m.order_id, 'refunded', true);
  end if;
  return jsonb_build_object('status','sent', 'message_id', m.id);
end;
$$;

-- ===================== worker: parti al (yalnız gönderim penceresinde) =====================
create or replace function public.rpc_claim_send_batch(p_limit int default 250)
returns setof public.sms_messages
language plpgsql security definer set search_path = public
as $$
declare v_max_attempts int;
begin
  if not public.in_sending_window(now()) then
    return;  -- pencere dışı: hiçbir şey gönderilmez
  end if;

  select value::int into v_max_attempts from public.system_settings where key = 'send_max_attempts';
  v_max_attempts := coalesce(v_max_attempts, 3);

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
    order by m.next_attempt_at, m.created_at
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
    perform public.rpc_refund_message(p_message_id, coalesce(p_error, 'PROVIDER_ERROR'));
    return jsonb_build_object('status','failed', 'message_id', m.id, 'refunded', true);
  else
    update public.sms_messages
    set status = 'queued',
        next_attempt_at = now() + (interval '1 minute' * power(2, m.attempts)),
        error_code = p_error
    where id = m.id;
    return jsonb_build_object('status','retry_scheduled', 'message_id', m.id, 'attempts', m.attempts);
  end if;
end;
$$;

-- ===================== worker: takılı 'sending' mesajları kurtar =====================
-- Fonksiyon zaman aşımına uğrar/çökerse mesajlar 'sending'de kalırdı.
-- NOT: sağlayıcı isteği iletilip yanıt işlenemediyse nadiren mükerrer SMS çıkabilir;
-- kullanıcıdan yine tek kez ücret alınır.
create or replace function public.rpc_requeue_stuck(p_minutes int default 10)
returns integer
language plpgsql security definer set search_path = public
as $$
declare r record; v_max_attempts int; v_count int := 0;
begin
  select value::int into v_max_attempts from public.system_settings where key = 'send_max_attempts';
  v_max_attempts := coalesce(v_max_attempts, 3);

  for r in
    select id, attempts from public.sms_messages
    where status = 'sending' and updated_at < now() - make_interval(mins => p_minutes)
    for update skip locked
  loop
    if r.attempts < v_max_attempts then
      update public.sms_messages
      set status = 'queued', next_attempt_at = now(), error_code = 'STUCK_REQUEUED'
      where id = r.id;
    else
      perform public.rpc_refund_message(r.id, 'STUCK_TIMEOUT');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ===================== worker: pencere kapandıktan sonra kalan mesajlar =====================
-- Pencere dışındayken zamanı gelmiş (due) ama gönderilememiş mesajlar iptal + rezerv iadesi.
-- Kullanıcı/sipariş başına toplu iade (önceki sürümde kullanıcı başına yalnız 1 mesaj iade ediliyordu).
create or replace function public.rpc_cancel_out_of_window()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  r record; v_count int := 0; v_refund numeric; v_n int; v_bal numeric;
begin
  if public.in_sending_window(now()) then
    return 0;
  end if;

  for r in
    select distinct o.id as order_id, o.user_id
    from public.orders o
    join public.sms_messages m on m.order_id = o.id
    where m.status = 'queued' and m.next_attempt_at <= now()
      and o.status in ('pending','scheduled','processing')
  loop
    insert into public.wallets (user_id, balance, reserved) values (r.user_id, 0, 0) on conflict do nothing;
    perform 1 from public.wallets where user_id = r.user_id for update;

    with c as (
      update public.sms_messages
      set status = 'refunded', error_code = 'OUTSIDE_SENDING_WINDOW', refunded_at = now()
      where order_id = r.order_id and status = 'queued' and next_attempt_at <= now()
      returning cost
    )
    select coalesce(sum(cost), 0), count(*) into v_refund, v_n from c;

    if v_n > 0 then
      update public.wallets
      set balance = balance + v_refund, reserved = greatest(reserved - v_refund, 0), updated_at = now()
      where user_id = r.user_id
      returning balance into v_bal;

      insert into public.wallet_transactions (user_id, type, credit, total_price, balance_after, ref_type, ref_id, description)
      values (r.user_id, 'refund', v_refund, v_refund, v_bal, 'order', r.order_id::text,
              'Gönderim saati dışında iptal (' || v_n || ' mesaj)');

      update public.orders
      set note = trim(coalesce(note, '') || ' [Pencere dışı iptal]')
      where id = r.order_id;

      perform public.rpc_refresh_order(r.order_id);
      update public.orders set status = 'cancelled'
      where id = r.order_id and processed_count = 0 and status = 'failed';

      v_count := v_count + v_n;
    end if;
  end loop;

  return v_count;
end;
$$;

-- ===================== kredi onayı / ret / manuel kredi =====================
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
begin
  if not public.has_permission('credit.approve') then
    raise exception 'NO_PERMISSION' using errcode = '403';
  end if;

  select * into t from public.topup_requests where id = p_topup_id for update;
  if not found then raise exception 'TOPUP_NOT_FOUND' using errcode = '404'; end if;
  if t.status in ('approved','rejected','expired') then
    raise exception 'ALREADY_SETTLED' using errcode = '409';
  end if;
  -- kullanıcı kendi talebini onaylayamaz
  if t.user_id = auth.uid() then
    raise exception 'SELF_APPROVAL' using errcode = '403';
  end if;
  if p_credit_amount is null or p_credit_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '422';
  end if;
  -- kripto: TXID bildirimi olmadan onay verilemez
  if t.method = 'crypto' and not exists (
    select 1 from public.crypto_payment_reports where topup_request_id = t.id
  ) then
    raise exception 'REPORT_REQUIRED' using errcode = '422';
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

  insert into public.audit_logs (actor_id, action, payload)
  values (auth.uid(), 'topup.approve', jsonb_build_object(
    'topup_id', t.id, 'user_id', t.user_id, 'method', t.method, 'reference', t.reference_code,
    'requested_try', t.amount_try, 'credited_try', p_credit_amount, 'note', p_admin_note));

  return jsonb_build_object('status','approved', 'topup_id', t.id, 'credited', p_credit_amount,
    'balance_after', v_bal, 'user_id', t.user_id);
end;
$$;

create or replace function public.rpc_reject_topup(p_topup_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare t public.topup_requests%rowtype;
begin
  if not public.has_permission('credit.approve') then
    raise exception 'NO_PERMISSION' using errcode = '403';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED' using errcode = '422';
  end if;
  select * into t from public.topup_requests where id = p_topup_id for update;
  if not found then raise exception 'TOPUP_NOT_FOUND' using errcode = '404'; end if;
  if t.status in ('approved','rejected','expired') then
    raise exception 'ALREADY_SETTLED' using errcode = '409';
  end if;
  if t.user_id = auth.uid() then
    raise exception 'SELF_APPROVAL' using errcode = '403';
  end if;

  update public.topup_requests
  set status = 'rejected', reject_reason = p_reason, approved_by = auth.uid()
  where id = t.id;

  insert into public.notifications (user_id, type, title, body)
  values (t.user_id, 'topup_rejected', 'Kredi Yükleme Reddedildi', t.reference_code || ' - Gerekçe: ' || p_reason);

  insert into public.audit_logs (actor_id, action, payload)
  values (auth.uid(), 'topup.reject', jsonb_build_object(
    'topup_id', t.id, 'user_id', t.user_id, 'reference', t.reference_code, 'reason', p_reason));

  return jsonb_build_object('status','rejected', 'topup_id', t.id);
end;
$$;

create or replace function public.rpc_admin_adjust(
  p_user_id uuid,
  p_amount numeric,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_bal numeric;
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

  insert into public.audit_logs (actor_id, action, payload)
  values (auth.uid(), 'wallet.adjust', jsonb_build_object(
    'user_id', p_user_id, 'amount', p_amount, 'balance_after', v_bal, 'description', p_description));

  return jsonb_build_object('status','adjusted', 'user_id', p_user_id, 'amount', p_amount, 'balance_after', v_bal);
end;
$$;

-- ===================== 1) EXECUTE YETKİLERİ (kritik güvenlik düzeltmesi) =====================
-- Postgres varsayılanı: yeni fonksiyonlar PUBLIC'e açıktır. SECURITY DEFINER olan ve içinde
-- yetki kontrolü bulunmayan rpc_refund_message / rpc_finalize_message / rpc_apply_dlr /
-- rpc_claim_send_batch gibi fonksiyonlar anon/authenticated tarafından /rest/v1/rpc ile
-- çağrılabiliyordu (ör. gönderilmiş mesajın bedelini kendine iade etme, başkasının
-- alıcı/mesaj verisini okuma). Hepsi kapatılıp beyaz liste ile yeniden açılır.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;

-- sunucu (service_role) her şeyi çağırabilir
grant execute on all functions in schema public to service_role;

-- panel RPC'leri: içlerinde auth.uid() + has_permission() kontrolü var
grant execute on function public.rpc_create_order(jsonb, text, timestamptz, text, text, uuid, uuid) to authenticated;
grant execute on function public.rpc_cancel_order(uuid) to authenticated;
grant execute on function public.rpc_approve_topup(uuid, numeric, text) to authenticated;
grant execute on function public.rpc_reject_topup(uuid, text) to authenticated;
grant execute on function public.rpc_admin_adjust(uuid, numeric, text) to authenticated;
grant execute on function public.rpc_get_balance(uuid) to authenticated;
grant execute on function public.rpc_upsert_blacklist(text[], boolean) to authenticated;
grant execute on function public.rpc_create_contact_list(text, text[]) to authenticated;
grant execute on function public.rpc_create_topup(text, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.rpc_report_topup(uuid, text, numeric, timestamptz, text, text, text) to authenticated;
grant execute on function public.rpc_report_bank_topup(uuid, text, text, text) to authenticated;
grant execute on function public.rpc_save_api_key(uuid, text, jsonb, text) to authenticated;
grant execute on function public.rpc_delete_api_key(uuid) to authenticated;
grant execute on function public.rpc_create_short_url(text, text, text) to authenticated;
grant execute on function public.rpc_delete_short_url(uuid) to authenticated;
grant execute on function public.rpc_create_ticket(text, text) to authenticated;
grant execute on function public.rpc_reply_ticket(uuid, text, boolean) to authenticated;
grant execute on function public.rpc_set_ticket_status(uuid, text) to authenticated;
grant execute on function public.rpc_create_user(text, text, text, text, text, uuid, text, numeric) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_update_role(uuid, text, boolean) to authenticated;
grant execute on function public.admin_create_role(text, boolean) to authenticated;
grant execute on function public.admin_set_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, uuid, text, text, numeric) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- RLS politikaları ve Storage politikaları bu yardımcıları çağırır (çağıran rolün yetkisi gerekir)
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_any_permission(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.sms_segments(text) to authenticated;
grant execute on function public.sms_detect_encoding(text) to authenticated;
grant execute on function public.normalize_phone(text) to authenticated;
grant execute on function public.normalize_recipients(text) to authenticated;
grant execute on function public.in_sending_window(timestamptz) to authenticated;
grant execute on function public.short_url_click(text) to anon, authenticated;

-- Yalnızca service_role (artık authenticated/anon için KAPALI):
--   rpc_finalize_message, rpc_refund_message, rpc_apply_dlr, rpc_complete_send,
--   rpc_claim_send_batch, rpc_cancel_out_of_window, rpc_expire_topups, rpc_requeue_stuck,
--   rpc_refresh_order, resolve_username_email (kullanıcı adı->e-posta sızıntısı),
--   user_has_permission, rate_limit_check, get_unit_price, next_window_start

-- ===================== 7) pg_cron =====================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('woltsms-requeue-stuck', '*/5 * * * *',
      $c$ select public.rpc_requeue_stuck(10); $c$);
    perform cron.schedule('woltsms-idempotency-cleanup', '20 0 * * *',
      $c$ delete from public.idempotency_keys where created_at < now() - interval '48 hours'; $c$);
  end if;
end $$;
