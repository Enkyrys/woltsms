import { after } from "next/server";
import { authenticateApiRequest } from "@/lib/auth";
import { applyCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrder, sendOrderNow } from "@/lib/services";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;

const BulkSchema = z.object({
  messages: z.array(z.object({ to: z.string(), text: z.string().min(1) })).min(1).max(5000),
});

// POST /api/v1/sms/bulk — her alıcıya farklı metin
export async function POST(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return applyCorsHeaders(
      Response.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code }),
      req
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return applyCorsHeaders(
      Response.json({ success: false, code: 400, message: "Geçersiz JSON." }, { status: 400 }),
      req
    );
  }
  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return applyCorsHeaders(
      Response.json({ success: false, code: 422, message: "messages gerekli." }, { status: 422 }),
      req
    );
  }
  const { messages } = parsed.data;

  // tek mesaj uzunluğundaki varyantlar ayrı siparişe bölünür;
  // burada her benzersiz metin için ayrı order oluşturulur (basitlik + maliyet doğruluğu).
  const groups = new Map<string, string[]>();
  for (const m of messages) {
    const arr = groups.get(m.text) ?? [];
    arr.push(m.to);
    groups.set(m.text, arr);
  }

  const results: { order_id: string; total_count: number; total_cost: string; status: string }[] = [];
  let totalCost = 0;

  for (const [text, recipients] of groups) {
    const r = await createOrder({
      userId: auth.userId,
      recipients,
      message: text,
      source: "api",
      viaServiceRole: true, // çerez yok; RPC service_role + p_user_id ile çağrılır
    });
    if (!r.ok) {
      return applyCorsHeaders(
        Response.json({ success: false, code: r.code, message: r.error }, { status: r.code }),
        req
      );
    }
    totalCost += Number(r.totalCost);
    results.push({ order_id: r.orderId, total_count: r.totalCount, total_cost: r.totalCost, status: r.status });
  }

  // siparişler veritabanına kaydedildi → hemen Sempico API ile gönder
  after(() => sendOrderNow(300));

  return applyCorsHeaders(
    Response.json(
      {
        success: true,
        code: 202,
        message: "Toplu gönderim kuyruğa alındı.",
        data: { orders: results, order_count: results.length, total_cost: String(totalCost) },
      },
      { status: 202 }
    ),
    req
  );
}
