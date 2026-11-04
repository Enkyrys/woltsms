set timezone = 'Asia/Tbilisi';
-- test bayisi
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','bayi@test');
insert into public.profiles(id, username, name, role_id) select '11111111-1111-1111-1111-111111111111','bayi1','Test Bayi', id from roles where name='Consumer';
insert into public.wallets(user_id,balance,reserved) values ('11111111-1111-1111-1111-111111111111',100,0) on conflict (user_id) do update set balance=100;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}',false);

\echo '--- 1) HEMEN GÖNDER'
select rpc_create_order('["905321111111","905322222222"]'::jsonb, 'Hemen test', null, 'panel', 'k-hemen-1') ->> 'order_id' as hemen \gset
select status, provider_scheduled_at, total_cost from orders where id = :'hemen';

\echo '--- 5a) TEKRARLI OLUŞTURMA (aynı idempotency anahtarı) → aynı sipariş'
select (rpc_create_order('["905321111111","905322222222"]'::jsonb, 'Hemen test', null, 'panel', 'k-hemen-1') ->> 'order_id') = :'hemen' as ayni_siparis, (select count(*) from orders) as siparis_sayisi;

\echo '--- 2) İLERİ TARİHLİ (2 saat sonra)'
select rpc_create_order('["905323333333"]'::jsonb, 'Zamanli test', now() + interval '2 hours', 'panel', 'k-ileri-1') ->> 'order_id' as ileri \gset
select status, scheduled_at::timestamp(0) yerel, provider_scheduled_at utc from orders where id = :'ileri';

\echo '--- 6) DÜZENLE: ad + daha uzun mesaj (ücret farkı) + yeni zaman'
select balance from wallets where user_id='11111111-1111-1111-1111-111111111111';
select rpc_update_scheduled_order(:'ileri', 'Kasım Kampanyası', repeat('Uzun mesaj ',20), now() + interval '3 hours') - 'message';
select balance, reserved from wallets where user_id='11111111-1111-1111-1111-111111111111';
select segments, cost, next_attempt_at::timestamp(0) from sms_messages where order_id = :'ileri';

\echo '--- 6b) geçmiş zamana düzenleme reddedilir'
do $$ begin perform rpc_update_scheduled_order((select id from orders where name='Kasım Kampanyası'), null, null, now() - interval '1 minute'); raise exception 'BEKLENMEDİK'; exception when others then raise notice 'beklenen hata: %', sqlerrm; end $$;

\echo '--- 7) TASLAK'
select rpc_save_order_draft('Taslak Kampanya', 'taslak mesaj', '{"numbers":"905324444444, 905325555555"}') ->> 'order_id' as taslak \gset
select status, total_count, total_cost, provider_scheduled_at from orders where id = :'taslak';
set timezone = 'Asia/Tbilisi';
\echo '--- 6b) geçmiş zamana düzenleme reddedilir'
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin perform rpc_update_scheduled_order((select id from orders where name='Kasım Kampanyası'), null, null, now() - interval '1 minute'); raise exception 'BEKLENMEDİK'; exception when others then raise notice 'beklenen hata: % (%)', sqlerrm, sqlstate; end $$;

-- worker (service_role) olarak
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);

\echo '--- 3) PLANLANAN SAAT: zamanlı kampanya henüz alınmamalı, hemen olanlar alınmalı'
create temp table batch1 as select * from rpc_claim_send_batch(50);
select o.name, o.status, count(*) alinan from batch1 b join orders o on o.id=b.order_id group by 1,2;

\echo '--- 4) API HATA + YENİDEN DENEME: ilk numara geçici hata, ikinci başarılı'
select rpc_complete_send((select id from batch1 where recipient='905321111111'), false, null, 'PROVIDER_NETWORK: timeout', true, '{"error":"timeout"}', null, 'gatum') ->> 'status' as gecici_hata;
select rpc_complete_send((select id from batch1 where recipient='905322222222'), true, '9001', null, true, '{"status":true,"data":{"905322222222":[{"id_state":9001}]}}', 200, 'gatum') ->> 'status' as basarili;
\echo '--- 5b) TEKRARLI SONUÇ: aynı mesaj ikinci kez başarılı bildirilirse yok sayılır'
select rpc_complete_send((select id from batch1 where recipient='905322222222'), true, '9001', null, true, '{}', 200, 'gatum') ->> 'status' as tekrar;
select recipient, status, attempts, error_code, next_attempt_at > now() as bekliyor from sms_messages where id in (select id from batch1) order by recipient;

\echo '--- yeniden deneme zamanı gelince tekrar alınır; kalıcı hata → tekrar denenmez, iade'
update sms_messages set next_attempt_at = now() where recipient='905321111111';
create temp table batch2 as select * from rpc_claim_send_batch(50);
select recipient, attempts from batch2;
select rpc_complete_send((select id from batch2), false, null, 'PROVIDER_BAD_PHONE: incorrect_phone', false, '{"error":"incorrect_phone"}', 200, 'gatum') ->> 'status' as kalici_hata;
select recipient, status, attempts, error_code from sms_messages where id in (select id from batch1) order by recipient;
select o.status as kampanya_durumu, o.processed_count basarili, o.failed_count basarisiz, o.provider_triggered_at is not null basladi, o.dispatch_finished_at is not null bitti, o.last_provider_response from orders o where o.message='Hemen test';
select attempt, ok, outcome, error_code, http_status from sms_send_attempts order by id;
select balance, reserved from wallets where user_id='11111111-1111-1111-1111-111111111111';

\echo '--- 3b) zamanlı kampanyanın zamanı gelince alınır (saati şimdiye çekerek)'
update orders set scheduled_at = now() - interval '1 second' where name='Kasım Kampanyası';
update sms_messages set next_attempt_at = now() - interval '1 second' where order_id=(select id from orders where name='Kasım Kampanyası');
select count(*) as zamani_gelen_alinan from rpc_claim_send_batch(50);
select status, provider_triggered_at is not null as tetiklendi from orders where name='Kasım Kampanyası';
\echo '--- başlamış kampanya artık düzenlenemez'
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin perform rpc_update_scheduled_order((select id from orders where name='Kasım Kampanyası'), 'x', null, null); raise exception 'BEKLENMEDİK'; exception when others then raise notice 'beklenen hata: %', sqlerrm; end $$;
\echo '--- İPTAL: yeni zamanlı kampanya iptal → iade'
select rpc_create_order('["905326666666"]'::jsonb, 'iptal edilecek', now() + interval '1 day', 'panel', 'k-iptal') ->> 'order_id' as ip \gset
select balance from wallets where user_id='11111111-1111-1111-1111-111111111111';
select rpc_cancel_order(:'ip') ->> 'status';
select balance from wallets where user_id='11111111-1111-1111-1111-111111111111';
select status from orders where id=:'ip';
