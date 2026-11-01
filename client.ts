"use client";

import { createBrowserClient } from "@supabase/ssr";

// Tarayıcı tarafı istemci (anon key). service_role anahtarı ASLA burada olmaz.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase ortam değişkenleri eksik.");
  return createBrowserClient(url, anonKey);
}
