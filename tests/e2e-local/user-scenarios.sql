
set timezone='Asia/Tbilisi';
insert into auth.users(id,email) values ('77777777-7777-7777-7777-777777777777','admin1@t'),('88888888-8888-8888-8888-888888888888','bayi@t');
insert into profiles(id,username,name,role_id,phone) select '77777777-7777-7777-7777-777777777777','admin1','Admin Bir',id,null from roles where name='admin';
insert into profiles(id,username,name,role_id,phone) select '88888888-8888-8888-8888-888888888888','bayi8','Bayi Sekiz',id,'5321112233' from roles where name='Consumer';
insert into wallets(user_id,balance,reserved) values ('88888888-8888-8888-8888-888888888888',50,0) on conflict (user_id) do update set balance=50;
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',false);
\echo '--- düzenleme: isim + telefon temizle + fiyat'
select admin_update_user_v2('88888888-8888-8888-8888-888888888888', 'Bayi 8 Yeni', '', null, null, 0.45, null) -> 'changes' as degisen;
select name, phone is null as tel_temiz, (select unit_price from pricing where user_id=p.id) as fiyat from profiles p where username='bayi8';
\echo '--- geçersiz fiyat / boş isim'
select admin_update_user_v2('88888888-8888-8888-8888-888888888888', null, null, null, null, 0, null);
select admin_update_user_v2('88888888-8888-8888-8888-888888888888', '   ', null, null, null, null, null);
\echo '--- kendini pasifleştirme / kendi admin rolünü kaldırma / son admin'
select admin_update_user_v2('77777777-7777-7777-7777-777777777777', null, null, null, null, null, false);
select admin_update_user_v2('77777777-7777-7777-7777-777777777777', null, null, (select id from roles where name='Consumer'), null, null, null);
\echo '--- askıya al: açık oturum kapanır, giriş çözümlenmez'
select rpc_presence_touch('88888888-8888-8888-8888-888888888888', null, 'login') is not null as oturum;
select admin_update_user_v2('88888888-8888-8888-8888-888888888888', null, null, null, null, null, false) -> 'changes' as degisen;
select count(*) filter (where ended_at is null) as acik_oturum from user_sessions where user_id='88888888-8888-8888-8888-888888888888';
select resolve_username_email('bayi8') is null as giris_kapali;
select admin_update_user_v2('88888888-8888-8888-8888-888888888888', null, null, null, null, null, true) -> 'changes' as yeniden_aktif;
\echo '--- silme önizleme'
select jsonb_build_object('orders',p->'orders','balance',p->'balance','active',p->'active_orders') from admin_user_delete_preview('88888888-8888-8888-8888-888888888888') p;
\echo '--- aktif kampanyası varken silinemez'
select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',false);
select rpc_create_order('["905320000099"]'::jsonb, 'zamanli', now() + interval '1 day', 'panel', 'del-k1') ->> 'order_id' as oid \gset
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',false);
select admin_delete_user_v2('88888888-8888-8888-8888-888888888888');
\echo '--- kampanya iptal edilince silinir; tüm veriler gider, denetim kaydı kalır'
select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',false);
select rpc_cancel_order(:'oid') ->> 'status';
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',false);
select admin_delete_user_v2('88888888-8888-8888-8888-888888888888') ->> 'status' as sonuc;
select (select count(*) from profiles where id='88888888-8888-8888-8888-888888888888') profil, (select count(*) from orders where user_id='88888888-8888-8888-8888-888888888888') kampanya, (select count(*) from wallet_transactions where user_id='88888888-8888-8888-8888-888888888888') hareket, (select count(*) from auth.users where id='88888888-8888-8888-8888-888888888888') auth;
select payload->>'username' as denetim_kaydi from audit_logs where action='user.delete';
\echo '--- kendini / son admini silemez'
select admin_delete_user_v2('77777777-7777-7777-7777-777777777777');
\echo '--- yetkisiz kullanıcı düzenleyemez'
insert into auth.users(id,email) values ('99999999-9999-9999-9999-999999999999','c@t');
insert into profiles(id,username,name,role_id) select '99999999-9999-9999-9999-999999999999','bayi9','B9',id from roles where name='Consumer';
select set_config('request.jwt.claim.sub','99999999-9999-9999-9999-999999999999',false);
select admin_update_user_v2('77777777-7777-7777-7777-777777777777', 'hack', null, null, null, null, null);
select admin_delete_user_v2('77777777-7777-7777-7777-777777777777');
