import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized } from "@/lib/api-response";

export const runtime = "nodejs";

// Panel bakiye özeti (dashboard rozeti için)
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const { data } = await admin
    .from("wallets")
    .select("balance, reserved")
    .eq("user_id", s.id)
    .maybeSingle();

  const balance = String(data?.balance ?? "0");
  const reserved = String(data?.reserved ?? "0");
  const available = String(Number(data?.balance ?? 0) - Number(data?.reserved ?? 0));

  return ok({
    balance,
    reserved,
    available,
    unitPrice: s.unitPrice,
    currency: "TRY",
    quotaType: s.quotaType,
    quotaLabel: s.quotaType === "variable" ? "Kota yok" : "Değişken Kota",
  });
}
