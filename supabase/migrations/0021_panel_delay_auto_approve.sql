-- =====================================================================
-- WOLTSMS - 0021 : Panel gönderim gecikmesi + API kapalıyken otomatik onay
--                  + toplu "Gönderildi" onayı
-- 0019 SONRASINDA çalıştırılır (idempotent, mevcut kayıt silinmez).
--
--  1) İşletme panelinden "Yeni SMS Gönder" ile oluşturulan (hemen gönder)
--     kampanyalar sağlayıcıya hemen değil, `panel_send_delay_minutes`
--     (varsayılan 5) dakika sonra gönderilir. Bu sürede kampanya
--     "Gönderim Bekliyor" durumundadır (bayi iptal edebilir).
--     İleri tarih seçilen kampanyalara ve API (v1) siparişlerine ek gecikme
--     uygulanmaz.
--
--  2) Sağlayıcı API'si KAPALI iken (provider_settings'te aktif satır yok)
--     bekleyen kampanyalar, gönderim zamanından `auto_approve_minutes`
--     (varsayılan 5) dakika sonra otomatik olarak "Gönderildi" yapılır
--     (mesajlar 'delivered', rezerv bakiye kesinleşir). Worker her dakika
--     çalıştığı için her kampanya kendi 5 dakikası dolunca onaylanır.
--     0 yazılırsa otomatik onay kapanır.
--
--  3) Admin, Kampanyalar listesinde seçtiği (tek / sayfa / hepsi)
--     bekleyen kampanyaları tek seferde "Gönderildi" yapabilir.
-- =====================================================================

insert into public.system_settings (key, value, description) values
  ('panel_send_delay_minutes', '5',
   'Panelden "hemen gönder" ile oluşturulan kampanyalar kaç dakika sonra sağlayıcıya gönderilir (0 = hemen)'),
  ('auto_approve_minutes', '5',
   'Sağlayıcı API kapalıyken bekleyen kampanyalar kaç dakika sonra otomatik Gönderildi olur (0 = kapalı)')
on conflict (key) do nothing;

-- dakika cinsinden ayar okuyucu (hatalı değer → varsayılan; 0..1440 arası)
create or replace function public.setting_minutes(p_key text, p_default int)
returns int
language plpgsql stable set search_path = public
as $$
declare v text; n int;
begin
  select btrim(value) into v from public.system_settings where key = p_key;
  if v is null or v !~ '^[0-9]{1,4}$' then return p_default; end if;
  n := v::int;
  return least(greatest(n, 0), 1440);
end;
$$;

-- ---------------------------------------------------------------------
-- 1) Sipariş zamanı tetikleyicisi (0017 sürümü + panel gecikmesi)
-- ---------------------------------------------------------------------
create or replace function public.set_order_provider_schedule()
returns trigger
language plpgsql set search_path = public
as $$
declare v_delay int;
begin
  new.provider_timezone := coalesce(nullif(btrim(new.provider_timezone), ''), 'UTC');

  if tg_op = 'INSERT' and new.status <> 'draft' then
    new.created_at := coalesce(new.created_at, now());
    if new.scheduled_at is null or new.scheduled_at <= new.created_at then
      -- ileri tarih yok → oluşturma anında gönder
      new.scheduled_at := new.created_at;
      if new.status = 'scheduled' then new.status := 'pending'; end if;
      -- işletme paneli: "hemen gönder" kampanyası N dakika bekler (durum "Gönderim Bekliyor" kalır)
      if new.source = 'panel' and new.status = 'pending' then
        v_delay := public.setting_minutes('panel_send_delay_minutes', 5);
        if v_delay > 0 then
          new.scheduled_at := new.created_at + make_interval(mins => v_delay);
        end if;
      end if;
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

drop trigger if exists trg_orders_provider_schedule on public.orders;
create trigger trg_orders_provider_schedule
  before insert or update of scheduled_at, provider_timezone on public.orders
  for each row execute function public.set_order_provider_schedule();

-- Mesaj, siparişin gönderim zamanından önce denenmez.
-- (rpc_create_order mesajlara kendi hesapladığı "şimdi"yi yazar; panel gecikmesi
--  sipariş tetikleyicisinde eklendiği için mesaj zamanı burada siparişe eşitlenir.)
create or replace function public.set_message_schedule_from_order()
returns trigger
language plpgsql set search_path = public
as $$
declare v_at timestamptz;
begin
  select scheduled_at into v_at from public.orders where id = new.order_id;
  if new.next_attempt_at is null then
    new.next_attempt_at := coalesce(v_at, now());
  elsif v_at is not null and v_at > new.next_attempt_at then
    new.next_attempt_at := v_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sms_messages_schedule on public.sms_messages;
create trigger trg_sms_messages_schedule
  before insert on public.sms_messages
  for each row execute function public.set_message_schedule_from_order();

-- ---------------------------------------------------------------------
-- 2) Ortak çekirdek: siparişteki bekleyen mesajları "iletildi" yap
-- ---------------------------------------------------------------------
create or replace function public.deliver_order_core(
  p_order_id uuid,
  p_actor uuid,
  p_note text,
  p_action text
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders%rowtype;
  r record;
  v_count int := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0404'; end if;
  if o.status in ('completed','partial','failed','cancelled','draft') then
    raise exception 'ORDER_NOT_PENDING' using errcode = 'P0409';
  end if;

  for r in
    select id from public.sms_messages
    where order_id = p_order_id and status = 'queued'
    order by created_at
    for update
  loop
    perform public.rpc_finalize_message(r.id, null);
    update public.sms_messages
       set status = 'delivered', delivered_at = now()
     where id = r.id;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'NO_PENDING_MESSAGES' using errcode = 'P0409';
  end if;

  perform public.rpc_refresh_order(p_order_id);

  update public.orders
     set note = case when note is null or note = '' then p_note else note || ' · ' || p_note end
   where id = p_order_id;

  insert into public.audit_logs (actor_id, action, payload)
  values (p_actor, p_action,
          jsonb_build_object('order_id', p_order_id, 'user_id', o.user_id, 'messages', v_count));

  return v_count;
end;
$$;
revoke all on function public.deliver_order_core(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.deliver_order_core(uuid, uuid, text, text) to service_role;

-- tek sipariş (mevcut "İletildi Onayla" butonu) — davranış aynı, çekirdeği kullanır
create or replace function public.rpc_manual_deliver_order(p_order_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  v_count := public.deliver_order_core(p_order_id, p_actor,
               'Manuel olarak iletildi (admin onayı)', 'order.manual_deliver');
  return jsonb_build_object('status', 'delivered', 'order_id', p_order_id, 'messages', v_count);
end;
$$;
revoke all on function public.rpc_manual_deliver_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_manual_deliver_order(uuid, uuid) to service_role;

-- toplu onay: seçilen siparişler; uygun olmayanlar atlanır, diğerleri işlenir
create or replace function public.rpc_manual_deliver_orders(p_order_ids uuid[], p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_n int;
  v_orders int := 0;
  v_messages int := 0;
  v_skipped int := 0;
begin
  foreach v_id in array coalesce(p_order_ids, '{}'::uuid[]) loop
    begin
      v_n := public.deliver_order_core(v_id, p_actor,
               'Manuel olarak iletildi (admin toplu onayı)', 'order.manual_deliver');
      v_orders := v_orders + 1;
      v_messages := v_messages + v_n;
    exception when others then
      v_skipped := v_skipped + 1;  -- bulunamadı / bekleyen mesaj yok / zaten sonuçlanmış
    end;
  end loop;
  return jsonb_build_object('orders', v_orders, 'messages', v_messages, 'skipped', v_skipped);
end;
$$;
revoke all on function public.rpc_manual_deliver_orders(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.rpc_manual_deliver_orders(uuid[], uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3) API kapalıyken otomatik onay (worker her dakika çağırır)
--    Gönderim zamanından (panel: oluşturma + gecikme, API: oluşturma,
--    ileri tarihli: seçilen an) auto_approve_minutes dakika geçen
--    bekleyen kampanyalar "Gönderildi" olur.
-- ---------------------------------------------------------------------
create or replace function public.rpc_auto_approve_pending(p_limit int default 200)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_minutes int;
  r record;
  v_n int;
  v_orders int := 0;
  v_messages int := 0;
begin
  -- sağlayıcı API'si açıksa hiçbir şey yapılmaz (gönderimi worker yapar)
  if exists (select 1 from public.provider_settings where is_active) then
    return jsonb_build_object('orders', 0, 'messages', 0, 'reason', 'provider_active');
  end if;

  v_minutes := public.setting_minutes('auto_approve_minutes', 5);
  if v_minutes <= 0 then
    return jsonb_build_object('orders', 0, 'messages', 0, 'reason', 'disabled');
  end if;

  for r in
    select o.id
    from public.orders o
    where o.status in ('pending','scheduled','processing')
      and greatest(coalesce(o.scheduled_at, o.created_at), o.created_at + make_interval(mins => v_minutes))
          <= now()
      and exists (select 1 from public.sms_messages m where m.order_id = o.id and m.status = 'queued')
    order by o.created_at
    limit greatest(coalesce(p_limit, 200), 1)
    for update of o skip locked
  loop
    begin
      v_n := public.deliver_order_core(r.id, null,
               'Otomatik onaylandı (API kapalı)', 'order.auto_approve');
      v_orders := v_orders + 1;
      v_messages := v_messages + v_n;
    exception when others then
      null;  -- tek siparişin hatası diğerlerini durdurmaz
    end;
  end loop;

  return jsonb_build_object('orders', v_orders, 'messages', v_messages, 'minutes', v_minutes);
end;
$$;
revoke all on function public.rpc_auto_approve_pending(int) from public, anon, authenticated;
grant execute on function public.rpc_auto_approve_pending(int) to service_role;

notify pgrst, 'reload schema';
