import { z } from "zod";
import { getSession } from "@/lib/auth";
import { manualDeliverOrder } from "@/lib/services";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";

const Schema = z.object({ orderId: z.string().uuid("Geçersiz sipariş.") });

// POST: bekleyen siparişi manuel olarak "iletildi" onayla (yalnız admin)
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!s.isAdmin) return forbidden();

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz istek.");

  const res = await manualDeliverOrder(parsed.data.orderId, s.id);
  if (!res.ok) {
    return Response.json({ success: false, code: res.code, message: res.error }, { status: res.code });
  }
  return ok({ messages: res.data.messages }, "Sipariş iletildi olarak onaylandı.");
}
