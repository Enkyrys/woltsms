-- 0011: Geçersiz SQLSTATE düzeltmesi
-- Önceki migration'larda `raise exception '...' using errcode = '403'` gibi 3 haneli kodlar vardı.
-- PostgreSQL SQLSTATE'in 5 karakter olmasını ister; aksi halde gerçek hata mesajı
-- (NO_PERMISSION, SELF_APPROVAL ...) yerine `unrecognized exception condition "403"` döner.
-- Bu migration, public şemadaki tüm fonksiyonlarda errcode = '4xx' / '5xx' değerlerini
-- 'P0' + kod (örn. 'P0403') olarak yeniden tanımlar. Hata MESAJLARI aynı kalır.

do $$
declare
  r record;
  def text;
  n int := 0;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ~* 'errcode\s*=\s*''[0-9]{3}'''
  loop
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, 'errcode\s*=\s*''([0-9]{3})''', 'errcode = ''P0\1''', 'gi');
    execute def;
    n := n + 1;
  end loop;
  raise notice 'errcode düzeltilen fonksiyon sayısı: %', n;
end $$;

notify pgrst, 'reload schema';
