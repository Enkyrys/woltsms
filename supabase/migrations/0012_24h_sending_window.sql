-- =====================================================================
-- WOLTSMS - 0012 : 24 saat gönderim penceresi
-- 0001-0011 SONRASINDA çalıştırılır (idempotent).
--
--  * Sipariş oluşturma / gönderim çalışma saatleri 24 saat esasına alındı:
--      başlangıç 24:00 (= 00:00), bitiş 23:59  → gün boyu açık.
--    system_settings: sending_start_hour = 0, sending_end_hour = 24
--  * Saat değerleri normalize edilir:
--      başlangıç 24 → 0 (24:00 = gece yarısı)
--      bitiş 0 veya ≥ 24 → 24 (23:59:59'a kadar)
--      başlangıç = bitiş  → 24 saat açık
--      bitiş < başlangıç  → gece yarısını aşan pencere (ör. 20 → 02)
--  * Pencere her zaman Türkiye saatine (Europe/Istanbul) göre hesaplanır.
--    Sağlayıcıya iletilen gönderim tarihi/saati uygulamada İngiltere saatine
--    (Europe/London) çevrilir (src/lib/providers/gatum.ts).
-- =====================================================================

-- ayarlar: 24 saat
insert into public.system_settings (key, value, description) values
  ('sending_start_hour', '0',  'Gönderim başlangıç saati (Europe/Istanbul, 0 veya 24 = 00:00)'),
  ('sending_end_hour',   '24', 'Gönderim bitiş saati (Europe/Istanbul, 24 = 23:59 dahil gün sonu)')
on conflict (key) do update set value = excluded.value, description = excluded.description;

-- normalize edilmiş pencere (başlangıç, bitiş) — 0..23 / 1..24
create or replace function public.sending_window_hours(out v_start int, out v_end int)
language plpgsql stable set search_path = public
as $$
declare v_s text; v_e text;
begin
  select value into v_s from public.system_settings where key = 'sending_start_hour';
  select value into v_e from public.system_settings where key = 'sending_end_hour';
  v_start := coalesce(nullif(btrim(coalesce(v_s, '')), '')::int, 0);
  v_end   := coalesce(nullif(btrim(coalesce(v_e, '')), '')::int, 24);
  v_start := ((v_start % 24) + 24) % 24;          -- 24 → 0
  if v_end <= 0 or v_end >= 24 then v_end := 24; end if;
end;
$$;

create or replace function public.in_sending_window(p_at timestamptz default now())
returns boolean
language plpgsql stable set search_path = public
as $$
declare v_start int; v_end int; v_hour int;
begin
  select w.v_start, w.v_end into v_start, v_end from public.sending_window_hours() w;
  -- 24 saat açık
  if (v_start = 0 and v_end = 24) or v_start = v_end then
    return true;
  end if;
  v_hour := extract(hour from (p_at at time zone 'Europe/Istanbul'))::int;
  if v_start < v_end then
    return v_hour >= v_start and v_hour < v_end;
  end if;
  -- gece yarısını aşan pencere
  return v_hour >= v_start or v_hour < v_end;
end;
$$;

-- p_at pencere içindeyse kendisini, değilse penceredeki ilk uygun anı döner.
create or replace function public.next_window_start(p_at timestamptz default now())
returns timestamptz
language plpgsql stable set search_path = public
as $$
declare v_start int; v_end int; v_local timestamp; v_day date; v_hour int;
begin
  if public.in_sending_window(p_at) then
    return p_at;
  end if;
  select w.v_start, w.v_end into v_start, v_end from public.sending_window_hours() w;
  v_local := p_at at time zone 'Europe/Istanbul';
  v_day   := v_local::date;
  v_hour  := extract(hour from v_local)::int;
  if v_hour < v_start then
    return (v_day + make_time(v_start, 0, 0)) at time zone 'Europe/Istanbul';
  end if;
  return ((v_day + 1) + make_time(v_start, 0, 0)) at time zone 'Europe/Istanbul';
end;
$$;

grant execute on function public.in_sending_window(timestamptz) to authenticated;

-- duyuru metni: eski 10:00–22:00 duyurusunu güncelle
update public.announcements
set text = 'Gönderimler 24 saat (00:00–23:59, Türkiye saati) aktiftir. Bilginize sunar, iyi çalışmalar dileriz.'
where text like 'Gönderimler 10:00–22:00%';
