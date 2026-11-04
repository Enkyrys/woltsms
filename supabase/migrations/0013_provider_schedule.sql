-- =====================================================================
-- WOLTSMS - 0013 : Sağlayıcı (Sempico) gönderim saati
-- 0001-0012 SONRASINDA çalıştırılır (idempotent).
--
--  * orders tablosuna sağlayıcı saati sütunları eklendi:
--      provider_scheduled_at  timestamp (saat dilimsiz) — Sempico'nun kendi
--                             saatiyle (UTC) gönderim tarihi/saati, dakika hassasiyeti.
--                             Örn. kullanıcı UTC+4'te 10:02 seçti → 06:02.
--      provider_timezone      text  — sağlayıcı saat dilimi (varsayılan 'UTC')
--      provider_triggered_at  timestamptz — siparişin Sempico API'ye gönderilmeye
--                             başlandığı an (worker tetiklediğinde yazılır).
--  * provider_scheduled_at, scheduled_at her yazıldığında tetikleyiciyle hesaplanır.
--  * Worker (rpc_claim_send_batch) bir siparişi yalnızca gönderici saati (scheduled_at)
--    ile sağlayıcı saati (provider_scheduled_at) eşleştiğinde, yani sağlayıcının
--    şu anki saati gönderim saatine geldiğinde alır ve Sempico API ile gönderir.
-- =====================================================================

alter table public.orders add column if not exists provider_scheduled_at timestamp;
alter table public.orders add column if not exists provider_timezone text not null default 'UTC';
alter table public.orders add column if not exists provider_triggered_at timestamptz;

comment on column public.orders.provider_scheduled_at is 'Sağlayıcı (Sempico) saatiyle gönderim tarihi/saati — provider_timezone (UTC) duvar saati';
comment on column public.orders.provider_timezone is 'Sağlayıcı saat dilimi (Sempico: UTC)';
comment on column public.orders.provider_triggered_at is 'Siparişin sağlayıcı API''sine gönderilmeye başlandığı an';

create index if not exists orders_provider_scheduled_idx
  on public.orders (provider_scheduled_at) where status in ('pending', 'scheduled');

-- gönderici saati (scheduled_at, timestamptz) → sağlayıcı saati (UTC duvar saati, dakika)
create or replace function public.set_order_provider_schedule()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.provider_timezone := coalesce(nullif(btrim(new.provider_timezone), ''), 'UTC');
  new.provider_scheduled_at := date_trunc(
    'minute',
    coalesce(new.scheduled_at, new.created_at, now()) at time zone new.provider_timezone
  );
  return new;
end;
$$;

drop trigger if exists trg_orders_provider_schedule on public.orders;
create trigger trg_orders_provider_schedule
  before insert or update of scheduled_at, provider_timezone on public.orders
  for each row execute function public.set_order_provider_schedule();

-- mevcut siparişleri doldur
update public.orders
set provider_scheduled_at = date_trunc('minute', coalesce(scheduled_at, created_at) at time zone coalesce(provider_timezone, 'UTC'))
where provider_scheduled_at is null;

-- ===================== worker: parti al (saat eşleşmesi) =====================
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

  -- sağlayıcı saati gönderim saatine gelen siparişler tetiklenir
  update public.orders o
  set status = 'processing',
      provider_triggered_at = coalesce(o.provider_triggered_at, now())
  where o.status in ('pending','scheduled')
    and (o.provider_scheduled_at is null
         or o.provider_scheduled_at <= (now() at time zone o.provider_timezone))
    and exists (
      select 1 from public.sms_messages m
      where m.order_id = o.id and m.status = 'queued' and m.next_attempt_at <= now()
    );

  return query
  with claimed as (
    select m.id
    from public.sms_messages m
    join public.orders o on o.id = m.order_id
    where m.status = 'queued' and m.next_attempt_at <= now() and m.attempts < v_max_attempts
      and o.status not in ('cancelled')
      and (o.provider_scheduled_at is null
           or o.provider_scheduled_at <= (now() at time zone o.provider_timezone))
    order by m.next_attempt_at, m.created_at
    limit p_limit
    for update of m skip locked
  )
  update public.sms_messages m
  set status = 'sending', attempts = m.attempts + 1
  from claimed c
  where m.id = c.id
  returning m.*;
end;
$$;

revoke all on function public.rpc_claim_send_batch(int) from public, anon, authenticated;
grant execute on function public.rpc_claim_send_batch(int) to service_role;
