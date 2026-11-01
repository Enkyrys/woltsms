-- Sağlayıcı API'si pasifken siparişler "Bekliyor" kalır; admin manuel olarak
-- "iletildi" onayı verir. Bu fonksiyon siparişteki bekleyen mesajları kesinleştirir
-- (rezerv bakiye harcanmış sayılır) ve mesajları 'delivered' (İletildi) yapar.
create or replace function public.rpc_manual_deliver_order(p_order_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.orders%rowtype;
  r record;
  v_count int := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = '404'; end if;
  if o.status in ('completed','failed','cancelled') then
    raise exception 'ORDER_NOT_PENDING' using errcode = '409';
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
    raise exception 'NO_PENDING_MESSAGES' using errcode = '409';
  end if;

  perform public.rpc_refresh_order(p_order_id);

  update public.orders
     set note = case when note is null or note = '' then 'Manuel olarak iletildi (admin onayı)'
                     else note || ' · Manuel olarak iletildi (admin onayı)' end
   where id = p_order_id;

  insert into public.audit_logs (actor_id, action, payload)
  values (p_actor, 'order.manual_deliver',
          jsonb_build_object('order_id', p_order_id, 'user_id', o.user_id, 'messages', v_count));

  return jsonb_build_object('status', 'delivered', 'order_id', p_order_id, 'messages', v_count);
end;
$$;

revoke all on function public.rpc_manual_deliver_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_manual_deliver_order(uuid, uuid) to service_role;
