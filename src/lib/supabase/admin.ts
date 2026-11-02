import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// service_role istemcisi — SADECE sunucu kodunda kullanın (Route Handler, worker).
// Bu anahtar RLS'i bypass eder; istemci paketine asla dahil edilmez.

const ENV_HINT =
  "Vercel → Project → Settings → Environment Variables bölümünde " +
  "NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanımlı olmalı " +
  "(ENCRYPTION_KEY / SUPABASE_SERVICE_ROLE_KEY gibi değişkenler deploy'dan sonra yeniden deploy ister).";

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

  // Tarayıcıya sızdıysa paketleme hatasıdır: service_role istemciye gitmemeli.
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient() yalnızca sunucu tarafında kullanılabilir (Route Handler/worker). " +
        "service_role anahtarı asla istemci koduna dahil edilmemeli."
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    const missing = [!url ? "NEXT_PUBLIC_SUPABASE_URL" : null, !serviceKey ? "SUPABASE_SERVICE_ROLE_KEY" : null]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Eksik ortam değişkeni: ${missing}. ${ENV_HINT}`);
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL geçersiz görünüyor (http(s) ile başlamalı): "${url.slice(0, 60)}". ${ENV_HINT}`);
  }
  if (serviceKey.length < 20) {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY geçersiz görünüyor (projenizin service_role anahtarı olmalı). ${ENV_HINT}`);
  }

  cached = build(url, serviceKey);
  return cached;
}
