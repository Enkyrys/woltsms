-- 0021: panel gecikmesi + API kapalıyken otomatik onay + toplu onay senaryoları
set timezone = 'Asia/Tbilisi';
insert into auth.users(id,email) values ('d4d4d4d4-0000-0000-0000-000000000004','bayi3@test') on conflict do nothing;
insert into public.profiles(id, username, name, role_id)
  select 'd4d4d4d4-0000-0000-0000-000000000004','bayi3','Gecikme Bayi', id from roles where name='Consumer'
  on conflict (id) do nothing;
insert into public.wallets(user_id,balance,reserved) values ('d4d4d4d4-0000-0000-0000-000000000004',100,0)
  on conflict (user_id) do update set balance=100, reserved=0;
update system_settings set value='5' where key in ('panel_send_delay_minutes','auto_approve_minutes');
select set_config('request.jwt.claim.sub','d4d4d4d4-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4d4d4d4-0000-0000-0000-000000000004"}',false);

\echo '--- G1) PANEL "hemen gönder" → durum Gönderim Bekliyor, gönderim = oluşturma + 5 dk'
select rpc_create_order('["905331111111","905332222222"]'::jsonb, 'Gecikme panel', null, 'panel', 'g-panel-1') ->> 'order_id' as gp \gset
select status, round(extract(epoch from scheduled_at - created_at)/60) as dk_sonra,
       round(extract(epoch from (provider_scheduled_at - (created_at at time zone 'UTC')))/60) as saglayici_dk
  from orders where id = :'gp';
select bool_and(round(extract(epoch from m.next_attempt_at - o.created_at)/60) = 5) as mesajlar_5dk_sonra
  from sms_messages m join orders o on o.id=m.order_id where o.id = :'gp';

\echo '--- G2) API siparişi ve ileri tarihli panel siparişi ek gecikme almaz'
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select rpc_create_order('["905333333333"]'::jsonb, 'Gecikme api', null, 'api', 'g-api-1', null, 'd4d4d4d4-0000-0000-0000-000000000004') ->> 'order_id' as ga \gset
select set_config('request.jwt.claim.sub','d4d4d4d4-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4d4d4d4-0000-0000-0000-000000000004"}',false);
select rpc_create_order('["905334444444"]'::jsonb, 'Gecikme ileri', now() + interval '2 hours', 'panel', 'g-ileri-1') ->> 'order_id' as gi \gset
select message, status, round(extract(epoch from scheduled_at - created_at)/60) as dk_sonra from orders where id in (:'ga', :'gi') order by message;

\echo '--- G3) API AÇIK: panel kampanyası 5 dk dolmadan alınmaz, API siparişi hemen alınır'
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into provider_settings(provider, base_url, sender_id, is_active) values ('mock','', 'T', true)
  on conflict (provider) do update set is_active = true;
create temp table gb1 as select * from rpc_claim_send_batch(50);
select o.message, count(*) as alinan from gb1 b join orders o on o.id=b.order_id
  where o.id in (:'gp', :'ga', :'gi') group by 1 order by 1;
select rpc_auto_approve_pending() as api_acikken_otomatik_onay;
\echo '    5 dk geçmiş gibi (zamanı geri çekerek) → panel kampanyası alınır'
update orders set scheduled_at = scheduled_at - interval '5 minutes', created_at = created_at - interval '5 minutes' where id = :'gp';
update sms_messages set next_attempt_at = next_attempt_at - interval '5 minutes' where order_id = :'gp';
select count(*) as panel_alinan from rpc_claim_send_batch(50) b where b.order_id = :'gp';
select status, provider_triggered_at is not null as tetiklendi from orders where id = :'gp';

\echo '--- G4) API KAPALI: bekleyen kampanya 5 dk dolunca otomatik Gönderildi'
update provider_settings set is_active = false;
select set_config('request.jwt.claim.sub','d4d4d4d4-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4d4d4d4-0000-0000-0000-000000000004"}',false);
select rpc_create_order('["905335555555","905336666666"]'::jsonb, 'Kapali panel', null, 'panel', 'g-kapali-1') ->> 'order_id' as gk \gset
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select rpc_auto_approve_pending() as hemen_calisirsa;  -- 5 dk dolmadı → 0
select status from orders where id = :'gk';
update orders set scheduled_at = scheduled_at - interval '5 minutes 1 second', created_at = created_at - interval '5 minutes 1 second' where id = :'gk';
select rpc_auto_approve_pending() as bes_dk_sonra;
select status, processed_count, note from orders where id = :'gk';
select status, count(*) from sms_messages where order_id = :'gk' group by 1;
select action, payload->>'messages' as mesaj from audit_logs where action='order.auto_approve' order by created_at desc limit 1;
\echo '    ileri tarihli (2 saat sonra) kampanya zamanı gelmeden onaylanmaz'
select status from orders where id = :'gi';
select balance, reserved from wallets where user_id='d4d4d4d4-0000-0000-0000-000000000004';

\echo '--- G5) auto_approve_minutes = 0 → otomatik onay kapalı'
update system_settings set value='0' where key='auto_approve_minutes';
select rpc_auto_approve_pending() ->> 'reason' as neden;
update system_settings set value='5' where key='auto_approve_minutes';

\echo '--- G6) TOPLU ONAY: 3 kampanya + 1 uygun olmayan (bitmiş) + 1 olmayan id'
select set_config('request.jwt.claim.sub','d4d4d4d4-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4d4d4d4-0000-0000-0000-000000000004"}',false);
select rpc_create_order('["905337000001"]'::jsonb, 'Toplu 1', null, 'panel', 'g-t1') ->> 'order_id' as t1 \gset
select rpc_create_order('["905337000002","905337000003"]'::jsonb, 'Toplu 2', null, 'panel', 'g-t2') ->> 'order_id' as t2 \gset
select rpc_create_order('["905337000004"]'::jsonb, 'Toplu 3', null, 'panel', 'g-t3') ->> 'order_id' as t3 \gset
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select rpc_manual_deliver_orders(array[:'t1', :'t2', :'t3', :'gk', gen_random_uuid()::text]::uuid[], null) as toplu;
select message, status, processed_count from orders where id in (:'t1', :'t2', :'t3') order by message;
select note from orders where id = :'t2';

\echo '--- G7) tek sipariş onayı (eski buton) aynı çalışır; bitmiş siparişte hata verir'
select set_config('request.jwt.claim.sub','d4d4d4d4-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4d4d4d4-0000-0000-0000-000000000004"}',false);
select rpc_create_order('["905338000001"]'::jsonb, 'Tekli', null, 'panel', 'g-tek') ->> 'order_id' as tk \gset
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select rpc_manual_deliver_order(:'tk', null) - 'order_id' as tekli;
do $$ begin perform rpc_manual_deliver_order((select id from orders where message='Tekli'), null); raise exception 'BEKLENMEDİK'; exception when others then raise notice 'beklenen hata: % (%)', sqlerrm, sqlstate; end $$;

\echo '--- G8) gecikme 0 → panel kampanyası hemen gönderilir (eski davranış)'
update system_settings set value='0' where key='panel_send_delay_minutes';
select set_config('request.jwt.claim.sub','d4d4d4d4-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4d4d4d4-0000-0000-0000-000000000004"}',false);
select rpc_create_order('["905339000001"]'::jsonb, 'Sifir gecikme', null, 'panel', 'g-sifir') ->> 'order_id' as sz \gset
select status, round(extract(epoch from scheduled_at - created_at)) as sn_sonra from orders where id = :'sz';
update system_settings set value='5' where key='panel_send_delay_minutes';
