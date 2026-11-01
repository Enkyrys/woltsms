import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized } from "@/lib/api-response";

export const runtime = "nodejs";

// İşlem geçmişi (cüzdan hareketleri) — ?action=balance dashboard'un beklediği bakiye özetini döner
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const url = new URL(req.url);

  if (url.searchParams.get("action") === "balance") {
    const { data } = await admin
      .from("wallets")
      .select("balance, reserved")
      .eq("user_id", s.id)
      .maybeSingle();
    const balance = String(data?.balance ?? "0");
    const reserved = String(data?.reserved ?? "0");
    return ok({
      balance,
      reserved,
      available: String(Number(balance) - Number(reserved)),
      unitPrice: s.unitPrice,
      currency: "TRY",
    });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 20));
  const type = url.searchParams.get("type");

  let q = admin.from("wallet_transactions").select("*", { count: "exact" }).eq("user_id", s.id);
  if (type) q = q.eq("type", type);
  const { count, data } = await q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  return ok(
    (data ?? []).map((t) => ({
      id: t.id,
      txType: t.type,
      credit: t.credit,
      totalPrice: t.total_price,
      currency: t.currency,
      unitPrice: t.unit_price,
      balanceAfter: t.balance_after,
      description: t.description,
      refType: t.ref_type,
      refId: t.ref_id,
      createdAt: t.created_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}
