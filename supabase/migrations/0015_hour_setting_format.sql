-- =====================================================================
-- WOLTSMS - 0015 : Çalışma saati ayarlarında "SS:DD" biçimi
-- 0014 SONRASINDA çalıştırılır (idempotent).
--
-- Hata: Sistem sayfasında başlangıç "24:00" / bitiş "23:59" kaydedilince
-- veritabanı ayarı tam sayı olarak okuduğu için sipariş oluşturma
--   invalid input syntax for type integer: "23:59"
-- hatası veriyordu.
--
-- Çözüm: sending_start_hour / sending_end_hour hangi biçimde yazılırsa yazılsın
-- ("24:00", "23:59", "10", "10:00", "22.00") kaydedilmeden önce tam saate çevrilir:
--   başlangıç "24:00" → 0   (gece yarısı)
--   bitiş     "23:59" → 24  (gün sonuna kadar)
--   bitiş     "22:30" → 23  (dakika varsa bir sonraki saate yuvarlanır)
-- =====================================================================

create or replace function public.normalize_hour_setting(p_key text, p_value text)
returns text
language plpgsql immutable
as $$
declare
  v text := btrim(coalesce(p_value, ''));
  m text[];
  h int;
  mi int;
begin
  m := regexp_match(v, '^(\d{1,2})(?:[:.](\d{1,2}))?(?::\d{1,2})?$');
  if m is null then
    -- anlaşılamayan değer: güvenli varsayılan (24 saat)
    return case when p_key = 'sending_start_hour' then '0' else '24' end;
  end if;
  h  := m[1]::int;
  mi := coalesce(m[2], '0')::int;

  if p_key = 'sending_start_hour' then
    if h >= 24 then h := 0; end if;            -- 24:00 = 00:00
    return greatest(0, least(h, 23))::text;
  end if;

  -- bitiş: dakika varsa saati tamamla (23:59 → 24)
  if mi > 0 then h := h + 1; end if;
  if h <= 0 or h >= 24 then h := 24; end if;
  return h::text;
end;
$$;

create or replace function public.trg_normalize_hour_setting()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.key in ('sending_start_hour', 'sending_end_hour') then
    new.value := public.normalize_hour_setting(new.key, new.value);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_system_settings_hours on public.system_settings;
create trigger trg_system_settings_hours
  before insert or update on public.system_settings
  for each row execute function public.trg_normalize_hour_setting();

-- mevcut değerleri düzelt ("24:00" → 0, "23:59" → 24)
update public.system_settings
set value = value
where key in ('sending_start_hour', 'sending_end_hour');

-- yoksa 24 saat varsayılanlarını ekle
insert into public.system_settings (key, value, description) values
  ('sending_start_hour', '0',  'Gönderim başlangıç saati (Europe/Istanbul, 24:00 = 00:00)'),
  ('sending_end_hour',   '24', 'Gönderim bitiş saati (Europe/Istanbul, 23:59 = gün sonu)')
on conflict (key) do nothing;

-- eski 10:00–22:00 duyurusu (tire/boşluk farkından bağımsız)
update public.announcements
set text = 'Gönderimler 24 saat (00:00–23:59) aktiftir. Siparişler kaydedildiği anda gönderilir. Bilginize sunar, iyi çalışmalar dileriz.'
where text ilike '%10:00%22:00%' or text ilike '%22:00 sonrası%';
