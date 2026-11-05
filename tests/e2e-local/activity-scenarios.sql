set timezone='Asia/Tbilisi';
insert into auth.users(id,email) values ('33333333-3333-3333-3333-333333333333','a@t'),('44444444-4444-4444-4444-444444444444','b@t');
insert into profiles(id,username,name,role_id) select '33333333-3333-3333-3333-333333333333','bayi_a','Bayi A',id from roles where name='Consumer';
insert into profiles(id,username,name,role_id) select '44444444-4444-4444-4444-444444444444','bayi_b','Bayi B',id from roles where name='Consumer';

\echo '--- giriş: yeni oturum (login)'
select rpc_presence_touch('33333333-3333-3333-3333-333333333333', null, 'login', '1.2.3.4', 'Chrome') ->> 'session_id' as sid \gset
select start_reason, ended_at is null as acik from user_sessions where id=:'sid';
\echo '--- sinyal: aynı oturum yenilenir (yeni oturum açılmaz)'
select (rpc_presence_touch('33333333-3333-3333-3333-333333333333', :'sid', 'resume') ->> 'started')::bool as yeni_oturum_acildi;
select count(*) as oturum_sayisi from user_sessions where user_id='33333333-3333-3333-3333-333333333333';
\echo '--- çerezsiz sinyal (eski oturum): açık oturuma bağlanır'
select (rpc_presence_touch('33333333-3333-3333-3333-333333333333', null, 'resume') ->> 'session_id') = :'sid' as ayni_oturum;
\echo '--- 4 dk sinyal yok → zaman aşımı: bitiş = son sinyal'
update user_sessions set started_at = now() - interval '20 minutes', last_seen_at = now() - interval '4 minutes' where id=:'sid';
select rpc_close_stale_sessions() as kapanan;
select end_reason, ended_at = last_seen_at as bitis_son_sinyal from user_sessions where id=:'sid';
\echo '--- geri dönünce: yeni oturum (resume)'
select rpc_presence_touch('33333333-3333-3333-3333-333333333333', :'sid', 'resume') as r \gset
select (:'r'::jsonb ->> 'started')::bool as yeni_oturum, (select start_reason from user_sessions where id = (:'r'::jsonb ->> 'session_id')::uuid);
\echo '--- çıkış'
select rpc_session_end('33333333-3333-3333-3333-333333333333', (:'r'::jsonb ->> 'session_id')::uuid) as kapanan;
select start_reason, end_reason from user_sessions where user_id='33333333-3333-3333-3333-333333333333' order by started_at;
\echo '--- özet alanlar'
select username, last_login_at is not null as giris, last_seen_at is not null as gorulme from profiles where username like 'bayi_%' order by 1;
\echo '--- yetki: authenticated rol çağıramaz'
set role authenticated;
do $$ begin perform rpc_presence_touch('44444444-4444-4444-4444-444444444444'); raise exception 'BEKLENMEDİK'; exception when insufficient_privilege then raise notice 'beklenen: yetki yok'; end $$;
reset role;
