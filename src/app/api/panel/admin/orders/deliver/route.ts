import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { manualDeliverOrder, manualDeliverOrders } from "@/lib/services";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Gönderildi" yapılabilecek (bekleyen) kampanya durumları
const DELIVERABLE_STATUSES =["pending", "scheduled", "processing"] as const;
const MAX_ALL = 5000;

const Schema = z
  .object({
    // tek kampanya (eski "İletildi Onayla" butonu)
    orderId: z.string().uuid("Geçersiz sipariş.").optional(),
    // seçilen kampanyalar (tek tek / sayfa)
    orderIds: z.array(z.string().uuid("Geçersiz sipariş.")).max(1000, "Tek seferde en fazla 1000 kampanya seçilebilir.").optional(),
    // "Hepsi": listedeki filtreye uyan tüm bekleyen kampanyalar
    all: z.boolean().optional(),
    status: z.string().optional(),
    q: z.string().optional(),
  })
  .refine((b) => b.orderId || (b.orderIds && b.orderIds.length > 0) || b.all === true, {
    message: "Kampanya seçilmedi.",
  });

// POST: bekleyen kampanyaları manuel olarak "Gönderildi" onayla (yalnız admin)
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!s.isAdmin) return forbidden();

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz istek.");
  const b = parsed.data;

  // tek kampanya: eski davranış (hata mesajları aynı)
  if (b.orderId && !b.orderIds && !b.all) {
    const res = await manualDeliverOrder(b.orderId, s.id);
    if (!res.ok) {
      return Response.json({ success: false, code: res.code, message: res.error }, { status: res.code });
    }
    return ok({ orders: 1, messages: res.data.messages, skipped: 0 }, "Kampanya gönderildi olarak onaylandı.");
  }

  let ids: string[] = b.orderIds ?? [];
  if (b.all) {
    // listedeki filtrelerle aynı sorgu; yalnızca bekleyen durumlar
    const admin = createAdminClient();
    const wanted = (b.status || "").split(",").map((x) => x.trim()).filter(Boolean);
    const statuses = wanted.length
      ? DELIVERABLE_STATUSES.filter((st) => wanted.includes(st))
      : [...DELIVERABLE_STATUSES];
    if (statuses.length === 0) return ok({ orders: 0, messages: 0, skipped: 0 }, "Seçilen filtrede bekleyen kampanya yok.");
    let q = admin.from("orders").select("id").in("status", statuses);
    const search = (b.q || "").trim().replace(/[%,()]/g, "");
    if (search) q = q.or(`name.ilike.%${search}%,message.ilike.%${search}%`);
    const { data, error } = await q.order("created_at", { ascending: true }).limit(MAX_ALL);
    if (error) return Response.json({ success: false, code: 500, message: error.message }, { status: 500 });
    ids = (data ?? []).map((r) => r.id as string);
  }
  ids = [...new Set(ids)];
  if (ids.length === 0) return ok({ orders: 0, messages: 0, skipped: 0 }, "Onaylanacak bekleyen kampanya yok.");

  const res = await manualDeliverOrders(ids, s.id);
  if (!res.ok) {
    return Response.json({ success: false, code: res.code, message: res.error }, { status: res.code });
  }
  const { orders, messages, skipped } = res.data;
  return ok(
    res.data,
    `${orders} kampanya gönderildi olarak onaylandı (${messages} mesaj)${skipped ? `, ${skipped} kampanya atlandı (bekleyen mesajı yok)` : ""}.`
  );
}
