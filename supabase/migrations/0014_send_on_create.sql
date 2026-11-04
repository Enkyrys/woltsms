-- =====================================================================
-- WOLTSMS - 0014 : Oluşturma anında gönderim (ileri tarihli sipariş yok)
-- 0013 SONRASINDA çalıştırılır (idempotent).
--
--  * "Gönderileceği tarih" artık dikkate alınmaz. Sipariş veritabanına
--    kaydedildiği an (created_at) gönderim anıdır ve uygulama siparişi o anda
--    ENKYRYS API'ye iletir.
--  * orders.provider_scheduled_at = created_at'in ENKYRYS saatiyle (UTC) karşılığı.
--    Örn. bayi UTC+4'te 10:02'de oluşturdu → 06:02:xx UTC.
--  * rpc_create_order p_schedule_at verilse bile yok sayılır (eski istemciler için güvence).
-- =====================================================================

create or replace function public.set_order_provider_schedule()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.provider_timezone := coalesce(nullif(btrim(new.provider_timezone), ''), 'UTC');
  -- gönderim anı = veritabanına kayıt anı
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.scheduled_at := new.created_at;
    if new.status = 'scheduled' then
      new.status := 'pending';
    end if;
  end if;
  new.provider_scheduled_at := date_trunc(
    'second',
    coalesce(new.created_at, now()) at time zone new.provider_timezone
  );
  return new;
end;
$$;

drop trigger if exists trg_orders_provider_schedule on public.orders;
create trigger trg_orders_provider_schedule
  before insert or update of scheduled_at, provider_timezone on public.orders
  for each row execute function public.set_order_provider_schedule();

-- mesajlar da kayıt anında kuyruğa hazır olsun (ileri tarihli next_attempt_at yok)
create or replace function public.set_message_send_now()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.next_attempt_at is null or new.next_attempt_at > now() then
    new.next_attempt_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sms_messages_send_now on public.sms_messages;
create trigger trg_sms_messages_send_now
  before insert on public.sms_messages
  for each row execute function public.set_message_send_now();
