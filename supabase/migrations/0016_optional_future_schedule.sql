-- =====================================================================
-- WOLTSMS - 0016 : İsteğe bağlı ileri tarihli sipariş
-- 0015 SONRASINDA çalıştırılır (idempotent). 0014'teki "her zaman hemen gönder"
-- kuralının yerini alır.
--
--  * Gönderim tarihi seçilmezse  → sipariş kaydedildiği anda Sempico'ya gönderilir.
--  * Oluşturma saatinden SONRAKİ bir tarih/saat seçilirse → sipariş 'scheduled'
--    (Zamanlı) bekler; worker (her dakika) Sempico saati (UTC) bu zamana
--    geldiğinde siparişi alır ve Sempico API ile gönderir.
--  * Oluşturma saatinden önceki (geçmiş) bir zaman → hemen gönderim.
--  * orders.provider_scheduled_at = gönderim zamanının Sempico saati (UTC) karşılığı.
-- =====================================================================

-- 0014'ün mesajları zorla "şimdi"ye çeken tetikleyicisi kaldırılır
drop trigger if exists trg_sms_messages_send_now on public.sms_messages;
drop function if exists public.set_message_send_now();

create or replace function public.set_order_provider_schedule()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.provider_timezone := coalesce(nullif(btrim(new.provider_timezone), ''), 'UTC');

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    if new.scheduled_at is null or new.scheduled_at <= new.created_at then
      -- ileri tarih yok / geçmiş zaman → oluşturma anında gönder
      new.scheduled_at := new.created_at;
      if new.status = 'scheduled' then new.status := 'pending'; end if;
    elsif new.status = 'pending' and new.scheduled_at > new.created_at + interval '30 seconds' then
      new.status := 'scheduled';
    end if;
  end if;

  -- Sempico saati (UTC duvar saati, saniye hassasiyeti)
  new.provider_scheduled_at := date_trunc(
    'second',
    coalesce(new.scheduled_at, new.created_at, now()) at time zone new.provider_timezone
  );
  return new;
end;
$$;

drop trigger if exists trg_orders_provider_schedule on public.orders;
create trigger trg_orders_provider_schedule
  before insert or update of scheduled_at, provider_timezone on public.orders
  for each row execute function public.set_order_provider_schedule();

-- ileri tarihli siparişin mesajları: gönderim zamanı = siparişin zamanı
-- (rpc_create_order zaten next_attempt_at = scheduled_at yazar; güvence olarak)
create or replace function public.set_message_schedule_from_order()
returns trigger
language plpgsql set search_path = public
as $$
declare v_at timestamptz;
begin
  if new.next_attempt_at is null then
    select scheduled_at into v_at from public.orders where id = new.order_id;
    new.next_attempt_at := coalesce(v_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sms_messages_schedule on public.sms_messages;
create trigger trg_sms_messages_schedule
  before insert on public.sms_messages
  for each row execute function public.set_message_schedule_from_order();
