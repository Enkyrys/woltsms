-- WOLTSMS - Storage bucket'ları + pg_cron zamanlayıcıları (pg_net ile)
-- Supabase Dashboard > Database > Extensions'dan pg_cron ve pg_net'i etkinleştirin.

-- ===================== Storage bucket'ları =====================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('imports',  'imports',  false, 26214400, array['text/csv','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('exports',  'exports',  false, 52428800, array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Bucket politikaları: kullanıcı yalnızca kendi klasöründe (folder = user_id/...)
drop policy if exists receipts_owner_select on storage.objects;
create policy receipts_owner_select on storage.objects for select
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text or public.is_admin());

drop policy if exists receipts_owner_insert on storage.objects;
create policy receipts_owner_insert on storage.objects for insert
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists imports_owner_select on storage.objects;
create policy imports_owner_select on storage.objects for select
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text or public.is_admin());

drop policy if exists imports_owner_insert on storage.objects;
create policy imports_owner_insert on storage.objects for insert
  with check (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists exports_owner_select on storage.objects;
create policy exports_owner_select on storage.objects for select
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text or public.is_admin());

drop policy if exists exports_owner_insert on storage.objects;
create policy exports_owner_insert on storage.objects for insert
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===================== pg_cron zamanlayıcıları =====================
-- Not: extension'lar etkin değilse bu blok hata verir; extension'ları açtıktan sonra uygulayın.

-- 1) Dakikalık worker çağrısı (pg_net ile /api/internal/worker)
select cron.schedule(
  'woltsms-worker-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := coalesce(current_setting('app.internal_worker_url', true), 'https://YOUR-APP.vercel.app') || '/api/internal/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', current_setting('app.cron_secret', true)),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) as request_id;
  $cron$
);

-- 2) Süresi dolan kredi taleplerini kapat (her 15 dk)
select cron.schedule(
  'woltsms-expire-topups',
  '*/15 * * * *',
  $cron$ select public.rpc_expire_topups(); $cron$
);

-- 3) Pencere dışı gönderim temizliği (her 5 dk)
select cron.schedule(
  'woltsms-cancel-out-of-window',
  '*/5 * * * *',
  $cron$ select public.rpc_cancel_out_of_window(); $cron$
);

-- 4) KVKK mesaj temizliği (her gece 03:10, Europe/Istanbul; retention_days sistem ayarı)
select cron.schedule(
  'woltsms-retention-cleanup',
  '10 0 * * *',
  $cron$
  $$
  do $$
  declare v_days int;
  begin
    select value::int into v_days from public.system_settings where key = 'message_retention_days';
    if coalesce(v_days, 0) > 0 then
      delete from public.sms_messages where created_at < now() - make_interval(days => v_days);
      delete from public.sent_message_history where created_at < now() - make_interval(days => v_days);
      delete from public.webhook_logs where created_at < now() - make_interval(days => 30);
      delete from public.rate_limits where window_start < now() - interval '2 hours';
    end if;
  end $$;
  $cron$
);

-- Kurulum sonrası çalıştırmanız gereken ayarlar (SQL editor veya psql):
--   alter database postgres set app.cron_secret = 'CRON_SECRET_DEĞERİ';
--   alter database postgres set app.internal_worker_url = 'https://YOUR-APP.vercel.app';
--   notify pgrst, 'reload config';
-- pg_cron extension'ı ile current_setting(...) çağrıları postgres rolüyle çalışır;
-- app.cron_secret ve app.internal_worker_url değerlerini Supabase Dashboard > Settings > Database > Custom config
-- üzerinden de tanımlayabilirsiniz.
