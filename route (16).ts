import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized } from "@/lib/api-response";

export const runtime = "nodejs";

// Gönderim geçmişi (dashboard "Geçmiş Mesajlar" listesi)
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();

  const admin = createAdminClient();
  const { data } = await admin
    .from("sent_message_history")
    .select("id, body, created_at")
    .eq("user_id", s.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return ok((data ?? []).map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at })));
}
