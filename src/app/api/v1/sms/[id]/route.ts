import { authenticateApiRequest } from "@/lib/auth";
import { applyCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// GET /api/v1/sms/{id} — mesaj durumu
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return applyCorsHeaders(
      Response.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code }),
      req
    );
  }
  const { id } = await ctx.params;
  const admin = createAdminClient();

  const { data } = await admin.from("sms_messages").select("*").eq("id", id).maybeSingle();
  if (!data || data.user_id !== auth.userId) {
    return applyCorsHeaders(
      Response.json({ success: false, code: 404, message: "Mesaj bulunamadı." }, { status: 404 }),
      req
    );
  }

  return applyCorsHeaders(
    Response.json({
      success: true,
      code: 200,
      message: "OK",
      data: {
        id: data.id,
        order_id: data.order_id,
        recipient: data.recipient,
        status: data.status,
        segments: data.segments,
        encoding: data.encoding,
        cost: data.cost,
        provider_message_id: data.provider_message_id,
        error_code: data.error_code,
        created_at: data.created_at,
        sent_at: data.sent_at,
        delivered_at: data.delivered_at,
      },
    }),
    req
  );
}
