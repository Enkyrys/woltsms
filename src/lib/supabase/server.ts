import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Tarayıcı/istek bazlı oturum istemcisi (anon key, RLS aktif).
// Route Handler ve Server Component'lerde kullanın.
export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY tanımlı olmalı.");
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component'ten çağrıldığında yazma sessizce atlanır;
          // middleware route handler üzerinden yeniler.
        }
      },
    },
  });
}
