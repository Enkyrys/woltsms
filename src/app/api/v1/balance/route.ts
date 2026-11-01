import { authenticateApiRequest } from "@/lib/auth";
import { applyCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// GET /api/v1/balance
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return applyCorsHeaders(
      Response.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code }),
      req
    );
  }
  const admin = createAdminClient();
  const { data: wallet } = await admin
    .from("wallets")
    .select("balance, reserved")
    .eq("user_id", auth.userId)
    .maybeSingle();

  const { data: pricing } = await admin
    .from("pricing")
    .select("unit_price")
    .eq("user_id", auth.userId)
    .maybeSingle();
  const unit = pricing?.unit_price ?? (await admin.from("pricing").select("unit_price").is("user_id", null).maybeSingle())?.data?.unit_price ?? 1;

  return applyCorsHeaders(
    Response.json({
      success: true,
      code: 200,
      message: "OK",
      data: {
        balance: String(wallet?.balance ?? "0"),
        reserved: String(wallet?.reserved ?? "0"),
        available: String(Number(wallet?.balance ?? 0) - Number(wallet?.reserved ?? 0)),
        unit_price: String(unit),
        currency: "TRY",
      },
    }),
    req
  );
}
