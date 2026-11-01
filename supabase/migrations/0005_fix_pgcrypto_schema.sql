-- Supabase'de pgcrypto "extensions" şemasındadır; search_path = public olan
-- fonksiyonlar crypt()/gen_salt() fonksiyonlarını bulamaz.
-- Mevcut veritabanı için hotfix (0002 dosyası da düzeltildi).
create extension if not exists pgcrypto with schema extensions;

alter function public.rpc_create_user(text, text, text, text, text, uuid, text, numeric)
  set search_path = public, extensions;
