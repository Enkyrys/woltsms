// Test için: @supabase/supabase-js createClient → yerel taklit
import { createSupabaseJsClient } from "./fake-supabase.ts";
export function createClient(..._args: unknown[]) { return createSupabaseJsClient(); }
