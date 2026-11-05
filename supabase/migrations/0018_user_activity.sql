-- =====================================================================
-- WOLTSMS - 0018 : Kullanıcı aktivitesi (oturum takibi)
-- 0017 SONRASINDA çalıştırılır (idempotent). Mevcut kayıtlar SİLİNMEZ.
--
--  * user_sessions : her giriş bir oturum açar (start_reason = 'login').
--                    Panel açıkken tarayıcı ~60 sn'de bir sinyal gönderir (last_seen_at).
--                    Oturum biter: çıkış → 'logout', sinyal gelmezse → 'timeout'
--                    (ended_at = son sinyal anı, yani "aktif olmaktan çıktığı an").
--                    Zaman aşımından sonra geri dönen kullanıcı için yeni oturum
--                    açılır (start_reason = 'resume').
--  * profiles.last_login_at / last_seen_at : hızlı liste için özet alanlar.
--  * system_settings.presence_timeout_seconds : sinyalsiz kaç saniye sonra pasif (vars. 180).
-- =====================================================================

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  start_reason text not null default 'login' check (start_reason in ('login', 'resume')),
  end_reason text check (end_reason in ('logout', 'timeout')),
  ip text,
  user_agent text
);
create index if not exists user_sessions_user_idx on public.user_sessions(user_id, started_at desc);
create index if not exists user_sessions_started_idx on public.user_sessions(started_at desc);
create index if not exists user_sessions_open_idx on public.user_sessions(last_seen_at) where ended_at is null;

alter table public.user_sessions enable row level security;
drop policy if exists user_sessions_select on public.user_sessions;
create policy user_sessions_select on public.user_sessions for select
  using (user_id = auth.uid() or public.is_admin());

alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists last_seen_at timestamptz;

insert into public.system_settings (key, value, description) values
  ('presence_timeout_seconds', '180', 'Sinyal gelmezse kullanıcı kaç saniye sonra pasif sayılır')
on conflict (key) do nothing;

create or replace function public.presence_timeout()
returns interval
language sql stable set search_path = public
as $$
  select make_interval(secs => greatest(60, coalesce(
    (select nullif(regexp_replace(value, '\D', '', 'g'), '')::int from public.system_settings where key = 'presence_timeout_seconds'),
    180)));
$$;

-- sinyali kesilen oturumları kapat: bitiş = son sinyal anı
create or replace function public.rpc_close_stale_sessions()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  with closed as (
    update public.user_sessions
    set ended_at = greatest(last_seen_at, started_at), end_reason = 'timeout'
    where ended_at is null and last_seen_at < now() - public.presence_timeout()
    returning 1
  )
  select count(*) into v_count from closed;
  return v_count;
end;
$$;

-- giriş / sinyal: açık oturumu yeniler ya da yenisini açar
--   p_reason = 'login'  → her zaman yeni oturum (giriş)
--   p_reason = 'resume' → çerezdeki oturum açıksa yenilenir; değilse kullanıcının
--                         açık bir oturumu varsa o yenilenir; yoksa yeni oturum (geri döndü)
create or replace function public.rpc_presence_touch(
  p_user_id uuid,
  p_session_id uuid default null,
  p_reason text default 'resume',
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_started boolean := false;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0401'; end if;
  perform public.rpc_close_stale_sessions();

  if p_reason <> 'login' then
    if p_session_id is not null then
      update public.user_sessions set last_seen_at = now()
      where id = p_session_id and user_id = p_user_id and ended_at is null
      returning id into v_id;
    end if;
    if v_id is null then
      update public.user_sessions set last_seen_at = now()
      where id = (select id from public.user_sessions
                  where user_id = p_user_id and ended_at is null
                  order by last_seen_at desc limit 1)
      returning id into v_id;
    end if;
  end if;

  if v_id is null then
    insert into public.user_sessions (user_id, start_reason, ip, user_agent)
    values (p_user_id, case when p_reason = 'login' then 'login' else 'resume' end,
            left(p_ip, 100), left(p_user_agent, 300))
    returning id into v_id;
    v_started := true;
  end if;

  update public.profiles
  set last_seen_at = now(),
      last_login_at = case when p_reason = 'login' then now() else last_login_at end
  where id = p_user_id;

  return jsonb_build_object('session_id', v_id, 'started', v_started);
end;
$$;

-- çıkış: oturumu kapat
create or replace function public.rpc_session_end(p_user_id uuid, p_session_id uuid default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  with closed as (
    update public.user_sessions
    set ended_at = now(), last_seen_at = now(), end_reason = 'logout'
    where user_id = p_user_id and ended_at is null
      and (p_session_id is null or id = p_session_id)
    returning 1
  )
  select count(*) into v_count from closed;
  update public.profiles set last_seen_at = now() where id = p_user_id;
  return v_count;
end;
$$;

revoke all on function public.rpc_close_stale_sessions() from public, anon, authenticated;
revoke all on function public.rpc_presence_touch(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.rpc_session_end(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_close_stale_sessions() to service_role;
grant execute on function public.rpc_presence_touch(uuid, uuid, text, text, text) to service_role;
grant execute on function public.rpc_session_end(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
