import { authenticateApiRequest } from "@/lib/auth";
import { applyCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// GET /api/v1/orders — sipariş listesi (sayfalı)
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return applyCorsHeaders(
      Response.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code }),
      req
    );
  }
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page") || 10)));

  const admin = createAdminClient();
  const { count, data } = await admin
    .from("orders")
    .select("*", { count: "exact" })
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  return applyCorsHeaders(
    Response.json({
      success: true,
      code: 200,
      message: "OK",
      data: (data ?? []).map((o) => ({
        id: o.id,
        name: o.name ?? null,
        status: o.status, // draft|scheduled|pending|processing|completed|partial|failed|cancelled
        total_count: o.total_count,
        processed_count: o.processed_count,
        failed_count: o.failed_count,
        total_cost: o.total_cost,
        message: o.message,
        scheduled_at: o.scheduled_at,
        provider_scheduled_at: o.provider_scheduled_at ?? null, // ENKYRYS saati (UTC)
        provider_timezone: o.provider_timezone ?? "UTC",
        provider_triggered_at: o.provider_triggered_at ?? null,
        source: o.source,
        created_at: o.created_at,
      })),
      meta: { total: count ?? 0, page, per_page: perPage },
    }),
    req
  );
}
