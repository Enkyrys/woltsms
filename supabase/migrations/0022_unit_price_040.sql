-- =====================================================================
-- WOLTSMS - 0022 : SMS birim fiyatı 0,40 TL (40 kuruş)
-- 0021 SONRASINDA çalıştırılır (idempotent).
--
-- Panel; birim fiyat, tahmini tutar ve "≈ N SMS" hesabını pricing
-- tablosundan okur. Ana sayfadaki fiyat src/lib/site.ts içindedir (40 kuruş).
--
--  - varsayılan fiyat (pricing.user_id IS NULL)  → 0.40
--  - bayiye özel fiyatlar (pricing.user_id dolu)  → 0.40   (aşağıdaki NOT'a bakın)
--  - Sistem > Gönderim Kuralları "Varsayılan Birim Fiyat" → 0.40
--  - yeni satır / yedek değer 1 → 0.40
--
-- Mevcut kampanyaların ve geçmiş işlemlerin tutarları DEĞİŞMEZ;
-- yeni fiyat bundan sonra oluşturulan kampanyalara uygulanır.
-- =====================================================================

-- varsayılan fiyat
insert into public.pricing (user_id, unit_price)
select null, 0.40
where not exists (select 1 from public.pricing where user_id is null);
update public.pricing set unit_price = 0.40 where user_id is null;

-- NOT: bayiye özel fiyat tanımlanmış üyeler de 0,40 olur.
-- Özel fiyatları korumak isterseniz aşağıdaki satırı silip öyle çalıştırın.
update public.pricing set unit_price = 0.40 where user_id is not null;

-- Sistem ayarı (Gönderim Kuralları ekranındaki alan)
insert into public.system_settings (key, value, description)
values ('default_unit_price', '0.4', 'Varsayılan birim fiyat (TL)')
on conflict (key) do update set value = excluded.value;

-- yeni fiyat satırlarının ve yedek değerin varsayılanı
alter table public.pricing alter column unit_price set default 0.40;

create or replace function public.get_unit_price(p_user_id uuid)
returns numeric(18,6)
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select unit_price from public.pricing where user_id = p_user_id),
    (select unit_price from public.pricing where user_id is null),
    0.40
  );
$$;

notify pgrst, 'reload schema';
