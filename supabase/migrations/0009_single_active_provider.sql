-- Aynı anda yalnız tek sağlayıcı aktif olabilir.
-- Önce çoklu aktif satırları temizle: gerçek sağlayıcı (mock değil) ve en son güncellenen kalsın.
with ranked as (
  select id,
         row_number() over (order by (provider = 'mock'), updated_at desc) as rn
  from public.provider_settings
  where is_active
)
update public.provider_settings p
   set is_active = false
  from ranked r
 where p.id = r.id and r.rn > 1;

-- Bundan sonra ikinci bir aktif satır eklenemez
create unique index if not exists provider_settings_single_active
  on public.provider_settings ((true)) where is_active;
