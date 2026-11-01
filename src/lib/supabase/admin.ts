import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

// service_role istemcisi — SADECE sunucu kodunda kullanın (Route Handler, worker).
// Bu anahtar RLS'i bypass eder; istemci paketine asla dahil edilmez.
let cached: ReturnType<typeof createSupabaseClient<Database>> | null = null;

export function createAdminClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ve NEXT_PUBLIC_SUPABASE_URL tanımlı olmalı (yalnız sunucu).");
  }

  cached = createSupabaseClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
