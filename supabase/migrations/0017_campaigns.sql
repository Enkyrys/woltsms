-- =====================================================================
-- WOLTSMS - 0017 : SMS kampanyaları (zamanlanmış gönderim, durumlar, API kaydı)
-- 0016 SONRASINDA çalıştırılır (idempotent). Mevcut kayıtlar SİLİNMEZ.
--
--  1) Durumlar   : draft (Taslak), scheduled (Zamanlandı), pending (Gönderim Bekliyor),
--                  processing (Gönderiliyor), completed (Gönderildi),
--                  partial (Kısmen Gönderildi), failed (Başarısız), cancelled (İptal Edildi)
--  2) Kampanya   : orders.name (kampanya adı), orders.draft_payload (taslak alıcıları/zamanı),
--                  orders.last_provider_response (son API yanıtı), orders.dispatch_finished_at
--  3) API kaydı  : sms_send_attempts — her sağlayıcı API denemesi (başarılı/başarısız ayrı satır,
--                  HTTP durumu, hata kodu, ham yanıt). sms_messages.provider_response = son yanıt.
--  4) Yeniden deneme: kalıcı hatalar (geçersiz numara, gönderen engelli, yetki...) tekrar
--                  denenmez; geçici hatalar üstel beklemeyle send_max_attempts kadar denenir.
--  5) Tekrar koruması: aynı mesaj yalnız 'sending' durumundayken sonuçlandırılabilir;
--                  ikinci sonuç 'ignored' döner ve kaydı tutulur.
--  6) Düzenleme  : rpc_update_scheduled_order — gönderim başlamadan önce ad / mesaj / zaman
--                  değiştirilebilir (mesaj değişirse ücret farkı rezerve edilir / iade edilir).
--  7) Taslak     : rpc_save_order_draft — bakiye rezervi yapmadan kaydedilir.
-- =====================================================================

-- ---------- 1) durumlar ----------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('draft','pending','scheduled','processing','completed','partial','failed','cancelled'));

-- ---------- 2) kampanya alanları ----------
alter table public.orders add column if not exists name text;
alter table public.orders add column if not exists draft_payload jsonb;
alter table public.orders add column if not exists last_provider_response jsonb;
alter table public.orders add column if not exists dispatch_finished_at timestamptz;

comment on column public.orders.name is 'Kampanya adı';
comment on column public.orders.draft_payload is 'Taslak: {numbers, contactListId, scheduleAt}';
comment on column public.orders.last_provider_response is 'Sağlayıcı API''sinin bu kampanya için son yanıtı';
comment on column public.orders.dispatch_finished_at is 'Kampanyanın tüm mesajlarının sonuçlandığı an';

alter table public.sms_messages add column if not exists provider_response jsonb;
alter table public.sms_messages add column if not exists last_attempt_at timestamptz;

-- ---------- 3) API deneme kaydı ----------
create table if not exists public.sms_send_attempts (
  id bigserial primary key,
  message_id uuid not null references public.sms_messages(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null,
  attempt int not null,
  ok boolean not null,
  outcome text not null check (outcome in ('sent','retry','failed','ignored')),
  provider text,
  http_status int,
  error_code text,
  provider_message_id text,
  response jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sms_send_attempts_order_idx on public.sms_send_attempts(order_id, created_at desc);
create index if not exists sms_send_attempts_message_idx on public.sms_send_attempts(message_id, created_at desc);
alter table public.sms_send_attempts enable row level security;
drop policy if exists sms_send_attempts_select on public.sms_send_attempts;
create policy sms_send_attempts_select on public.sms_send_attempts for select
  using (user_id = auth.uid() or public.is_admin());

-- ---------- durum hesabı (kısmen gönderildi dahil) ----------
create or replace function public.rpc_refresh_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_ok int; v_fail int; v_total int; v_status text;
begin
  select total_count, status into v_total, v_status from public.orders where id = p_order_id;
  if not found then return; end if;
  select count(*) filter (where status in ('sent','delivered')),
         count(*) filter (where status in ('failed','refunded'))
    into v_ok, v_fail
  from public.sms_messages where order_id = p_order_id;

  update public.orders
  set processed_count = v_ok,
      failed_count = v_fail,
      status = case
        when status in ('cancelled','draft') then status
        when v_ok + v_fail >= v_total and v_total > 0 then
          case when v_fail = 0 then 'completed'
               when v_ok > 0 then 'partial'
               else 'failed' end
        else status
      end,
      dispatch_finished_at = case
        when v_ok + v_fail >= v_total and v_total > 0 then coalesce(dispatch_finished_at, now())
        else dispatch_finished_at end
  where id = p_order_id;
end;
$$;

-- mevcut "tamamlandı" ama başarısız mesajı olan siparişler → kısmen gönderildi
update public.orders o
set status = 'partial'
where o.status = 'completed' and o.failed_count > 0 and o.processed_count > 0;

-- ---------- 4/5) gönderim sonucu ----------
drop function if exists public.rpc_complete_send(uuid, boolean, text, text);
create or replace function public.rpc_complete_send(
  p_message_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retryable boolean default true,
  p_response jsonb default null,
  p_http_status int default null,
  p_provider text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.sms_messages%rowtype;
  v_max_attempts int;
  v_outcome text;
  v_result jsonb;
begin
  select * into m from public.sms_messages where id = p_message_id for update;
  if not found then
    return jsonb_build_object('status','ignored');
  end if;

  if m.status <> 'sending' then
    -- tekrarlı sonuç (aynı mesaj ikinci kez): hiçbir şey değişmez, yalnız kayıt tutulur
    insert into public.sms_send_attempts (message_id, order_id, user_id, attempt, ok, outcome, provider, http_status, error_code, provider_message_id, response)
    values (m.id, m.order_id, m.user_id, m.attempts, p_ok, 'ignored', p_provider, p_http_status, p_error, p_provider_message_id, p_response);
    return jsonb_build_object('status','ignored', 'message_id', m.id, 'message_status', m.status);
  end if;

  select value::int into v_max_attempts from public.system_settings where key = 'send_max_attempts';
  v_max_attempts := coalesce(v_max_attempts, 3);

  update public.sms_messages
  set provider_response = p_response, last_attempt_at = now()
  where id = m.id;
  update public.orders
  set last_provider_response = coalesce(p_response, last_provider_response)
  where id = m.order_id;

  if p_ok then
    v_outcome := 'sent';
    v_result := public.rpc_finalize_message(p_message_id, p_provider_message_id);
  elsif not coalesce(p_retryable, true) or m.attempts >= v_max_attempts then
    v_outcome := 'failed';
    perform public.rpc_refund_message(p_message_id, coalesce(p_error, 'PROVIDER_ERROR'));
    update public.sms_messages set status = 'failed' where id = m.id and status = 'refunded';
    perform public.rpc_refresh_order(m.order_id);
    v_result := jsonb_build_object('status','failed', 'message_id', m.id, 'refunded', true,
                                   'retryable', coalesce(p_retryable, true));
  else
    v_outcome := 'retry';
    update public.sms_messages
    set status = 'queued',
        next_attempt_at = now() + (interval '1 minute' * power(2, greatest(m.attempts - 1, 0))),
        error_code = p_error
    where id = m.id;
    v_result := jsonb_build_object('status','retry_scheduled', 'message_id', m.id, 'attempts', m.attempts);
  end if;

  insert into public.sms_send_attempts (message_id, order_id, user_id, attempt, ok, outcome, provider, http_status, error_code, provider_message_id, response)
  values (m.id, m.order_id, m.user_id, m.attempts, p_ok, v_outcome, p_provider, p_http_status, p_error, p_provider_message_id, p_response);

  return v_result;
end;
$$;
revoke all on function public.rpc_complete_send(uuid, boolean, text, text, boolean, jsonb, int, text) from public, anon, authenticated;
grant execute on function public.rpc_complete_send(uuid, boolean, text, text, boolean, jsonb, int, text) to service_role;

-- refund sonrası 'failed' durumunun rpc_refresh_order'da sayılması için:
-- (failed ve refunded ikisi de başarısız sayılır; iade her iki durumda da yapılmıştır)

-- ---------- iptal (kısmen gönderildi / taslak) ----------
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
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0401'; end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0404'; end if;
  if o.user_id <> v_uid and not public.has_permission('users.manage') then
    raise exception 'NO_PERMISSION' using errcode = 'P0403';
  end if;

  if o.status in ('completed','partial','failed','cancelled') then
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
            'Kampanya iptali (' || v_count || ' mesaj iade edildi)');
  else
    select balance, reserved into v_bal, v_res from public.wallets where user_id = o.user_id;
  end if;

  update public.orders
  set status = 'cancelled',
      failed_count = failed_count + v_count,
      note = trim(coalesce(note,'') || ' [Kullanıcı iptali]')
  where id = o.id;

  insert into public.audit_logs (actor_id, action, payload)
  values (v_uid, 'order.cancel', jsonb_build_object('order_id', o.id,'refunded', v_refunded,'messages', v_count));

  return jsonb_build_object(
    'status','cancelled','order_id', o.id,
    'refunded', v_refunded,'cancelled_messages', v_count,
    'balance', coalesce(v_bal,0), 'reserved', coalesce(v_res,0));
end;
$$;
grant execute on function public.rpc_cancel_order(uuid) to authenticated;

-- ---------- 6) zamanlanmış kampanyayı düzenle ----------
create or replace function public.rpc_update_scheduled_order(
  p_order_id uuid,
  p_name text default null,
  p_message text default null,
  p_schedule_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders%rowtype;
  v_uid uuid := auth.uid();
  v_jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('role', true));
  v_not_queued int;
  v_count int;
  v_enc text; v_segments int; v_unit numeric(18,6); v_msg_cost numeric(18,4); v_new_total numeric(18,4); v_diff numeric(18,4);
  v_bal numeric(18,4);
begin
  if v_uid is null and v_jwt_role <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0401';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0404'; end if;
  if v_uid is not null and o.user_id <> v_uid and not public.has_permission('users.manage') then
    raise exception 'NO_PERMISSION' using errcode = 'P0403';
  end if;

  -- yalnız gönderimi başlamamış zamanlanmış kampanya düzenlenir
  select count(*) into v_not_queued from public.sms_messages where order_id = o.id and status <> 'queued';
  if o.status <> 'scheduled' or o.provider_triggered_at is not null or v_not_queued > 0 then
    raise exception 'ORDER_NOT_EDITABLE' using errcode = 'P0409';
  end if;

  if p_schedule_at is not null and p_schedule_at <= now() + interval '30 seconds' then
    raise exception 'SCHEDULE_IN_PAST' using errcode = 'P0422';
  end if;

  -- mesaj değişti: segment / ücret yeniden hesaplanır (sipariş anındaki birim fiyat korunur)
  if p_message is not null and btrim(p_message) <> '' and p_message is distinct from o.message then
    select count(*), max(cost / nullif(segments, 0)) into v_count, v_unit
    from public.sms_messages where order_id = o.id;
    v_unit := coalesce(v_unit, public.get_unit_price(o.user_id));
    v_enc := public.sms_detect_encoding(p_message);
    v_segments := public.sms_segments(p_message);
    v_msg_cost := round(v_segments * v_unit, 4);
    v_new_total := v_msg_cost * v_count;
    v_diff := v_new_total - o.total_cost;

    if v_diff <> 0 then
      insert into public.wallets (user_id, balance, reserved) values (o.user_id, 0, 0) on conflict do nothing;
      select balance into v_bal from public.wallets where user_id = o.user_id for update;
      if v_diff > 0 and v_bal < v_diff then
        raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0402';
      end if;
      update public.wallets
      set balance = balance - v_diff, reserved = greatest(reserved + v_diff, 0), updated_at = now()
      where user_id = o.user_id
      returning balance into v_bal;
      insert into public.wallet_transactions (user_id, type, credit, unit_price, total_price, balance_after, ref_type, ref_id, description)
      values (o.user_id, case when v_diff > 0 then 'reserve' else 'release' end, -v_diff, v_unit, abs(v_diff), v_bal,
              'order', o.id::text, 'Zamanlanmış kampanya düzenlendi (mesaj değişikliği, ' || v_segments || ' segment)');
    end if;

    update public.sms_messages
    set body = p_message, encoding = v_enc, segments = v_segments, cost = v_msg_cost
    where order_id = o.id and status = 'queued';
    update public.orders set message = p_message, total_cost = v_new_total where id = o.id;
  elsif p_message is not null and btrim(p_message) = '' then
    raise exception 'EMPTY_MESSAGE' using errcode = 'P0400';
  end if;

  if p_schedule_at is not null then
    update public.orders set scheduled_at = p_schedule_at where id = o.id;      -- tetikleyici sağlayıcı saatini yeniler
    update public.sms_messages set next_attempt_at = p_schedule_at where order_id = o.id and status = 'queued';
  end if;

  if p_name is not null then
    update public.orders set name = nullif(btrim(p_name), '') where id = o.id;
  end if;

  insert into public.audit_logs (actor_id, action, payload)
  values (v_uid, 'order.update_scheduled', jsonb_build_object('order_id', o.id, 'name', p_name,
          'message_changed', p_message is not null and p_message is distinct from o.message, 'schedule_at', p_schedule_at));

  select * into o from public.orders where id = p_order_id;
  return jsonb_build_object('status','updated', 'order_id', o.id, 'name', o.name, 'message', o.message,
                            'scheduled_at', o.scheduled_at, 'provider_scheduled_at', o.provider_scheduled_at,
                            'total_cost', o.total_cost);
end;
$$;
revoke all on function public.rpc_update_scheduled_order(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.rpc_update_scheduled_order(uuid, text, text, timestamptz) to authenticated, service_role;

-- ---------- 7) taslak ----------
create or replace function public.rpc_save_order_draft(
  p_name text,
  p_message text,
  p_payload jsonb default '{}'::jsonb,
  p_draft_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_count int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0401'; end if;
  if not public.has_permission('sms.send') then raise exception 'NO_PERMISSION' using errcode = 'P0403'; end if;

  -- tahmini alıcı sayısı (gösterim için; gerçek sayı gönderimde hesaplanır)
  select count(*) into v_count
  from regexp_split_to_table(coalesce(p_payload ->> 'numbers', ''), '[\s,;]+') x
  where btrim(x) <> '';

  if p_draft_id is not null then
    update public.orders
    set name = nullif(btrim(coalesce(p_name, '')), ''), message = p_message,
        draft_payload = coalesce(p_payload, '{}'::jsonb), total_count = v_count
    where id = p_draft_id and user_id = v_uid and status = 'draft'
    returning id into v_id;
    if v_id is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0404'; end if;
  else
    insert into public.orders (user_id, status, total_count, total_cost, message, name, draft_payload, source, created_by)
    values (v_uid, 'draft', v_count, 0, p_message, nullif(btrim(coalesce(p_name, '')), ''), coalesce(p_payload, '{}'::jsonb), 'panel', v_uid)
    returning id into v_id;
  end if;
  return jsonb_build_object('status','draft', 'order_id', v_id, 'total_count', v_count);
end;
$$;
revoke all on function public.rpc_save_order_draft(text, text, jsonb, uuid) from public, anon;
grant execute on function public.rpc_save_order_draft(text, text, jsonb, uuid) to authenticated;

-- taslak siparişler worker'a hiç düşmez (mesajı yoktur); sağlayıcı saati tetikleyicisi
-- taslağı pending/scheduled'a çevirmesin diye koruma:
create or replace function public.set_order_provider_schedule()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.provider_timezone := coalesce(nullif(btrim(new.provider_timezone), ''), 'UTC');

  if tg_op = 'INSERT' and new.status <> 'draft' then
    new.created_at := coalesce(new.created_at, now());
    if new.scheduled_at is null or new.scheduled_at <= new.created_at then
      new.scheduled_at := new.created_at;
      if new.status = 'scheduled' then new.status := 'pending'; end if;
    elsif new.status = 'pending' and new.scheduled_at > new.created_at + interval '30 seconds' then
      new.status := 'scheduled';
    end if;
  end if;

  new.provider_scheduled_at := case
    when new.status = 'draft' then null
    else date_trunc('second', coalesce(new.scheduled_at, new.created_at, now()) at time zone new.provider_timezone)
  end;
  return new;
end;
$$;
notify pgrst, 'reload schema';
