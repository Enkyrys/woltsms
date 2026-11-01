import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// service_role istemcisi — SADECE sunucu kodunda kullanın (Route Handler, worker).
// Bu anahtar RLS'i bypass eder; istemci paketine asla dahil edilmez.

// Jenerik createClient'ı doğrudan ReturnType ile sarmak tipleri bozar;
// bu yüzden jenerik olmayan bir yardımcı üzerinden tip çıkarıyoruz.
function build(url: string, serviceKey: string) {
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let cached: ReturnType<typeof build> | null = null;

export function createAdminClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ve NEXT_PUBLIC_SUPABASE_URL tanımlı olmalı (yalnız sunucu).");
  }

  cached = build(url, serviceKey);
  return cached;
}
