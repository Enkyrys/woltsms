import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { orders, smsMessages, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiRequest } from "@/lib/auth";
import { calcSegments, normalizePhone } from "@/lib/sms";
import { debitBalance, processOrder } from "@/lib/services";

export async function POST(req: Request) {
  const bodyText = await req.text();
  (req as unknown as { __bodyText?: string }).__bodyText = bodyText;
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code });
  let b: { messages?: { to: string; text: string }[] } = {};
  try { b = JSON.parse(bodyText); } catch { return NextResponse.json({ success: false, code: 400, message: "Geçersiz JSON." }, { status: 400 }); }
  const msgs = b.messages || [];
  if (!Array.isArray(msgs) || msgs.length === 0) return NextResponse.json({ success: false, code: 400, message: "messages gerekli." }, { status: 400 });
  if (msgs.length > 2000) return NextResponse.json({ success: false, code: 422, message: "En fazla 2000 mesaj." }, { status: 422 });

  const me = (await db.select().from(users).where(eq(users.id, auth.userId)))[0];
  const unitPrice = Number(me?.unitPrice ?? 1);
  const items: { to: string; text: string; segments: number; encoding: string; cost: number }[] = [];
  for (const m of msgs.slice(0, 2000)) {
    const n = normalizePhone(String(m.to || ""));
    const text = String(m.text || "").trim();
    if (!n || !text) continue;
    const { segments, encoding } = calcSegments(text);
    items.push({ to: n, text, segments, encoding, cost: Number((segments * unitPrice).toFixed(4)) });
  }
  if (items.length === 0) return NextResponse.json({ success: false, code: 422, message: "Geçerli mesaj yok." }, { status: 422 });
  const bl = await pool.query(`SELECT phone FROM blacklist WHERE phone = ANY($1) AND (user_id=$2 OR user_id IS NULL)`, [items.map((i) => i.to), auth.userId]);
  const blSet = new Set(bl.rows.map((r) => r.phone));
  const filtered = items.filter((i) => !blSet.has(i.to));
  if (filtered.length === 0) return NextResponse.json({ success: false, code: 422, message: "Tümü karalistedede." }, { status: 422 });
  const total = Number(filtered.reduce((a, x) => a + x.cost, 0).toFixed(4));
  try {
    await debitBalance({ userId: auth.userId, amount: total, unitPrice, credit: filtered.reduce((a, x) => a + x.segments, 0), description: `API Toplu Gönderim (${filtered.length} adet)`, refType: "order", refId: "pending-bulk" });
  } catch {
    return NextResponse.json({ success: false, code: 402, message: "Yetersiz bakiye." }, { status: 402 });
  }
  const ins = await db.insert(orders).values({ userId: auth.userId, status: "pending", totalCount: filtered.length, message: filtered[0].text.slice(0, 500), createdBy: auth.userId }).returning();
  await pool.query(`UPDATE wallet_transactions SET ref_id=$1 WHERE id=(SELECT id FROM wallet_transactions WHERE user_id=$2 AND ref_id='pending-bulk' ORDER BY id DESC LIMIT 1)`, [String(ins[0].id), auth.userId]);
  await db.insert(smsMessages).values(filtered.map((f) => ({ orderId: ins[0].id, userId: auth.userId, recipient: f.to, body: f.text, encoding: f.encoding, segments: f.segments, cost: String(f.cost), status: "pending" })));
  processOrder(ins[0].id).catch(console.error);
  return NextResponse.json({ success: true, code: 200, message: "Toplu gönderim alındı.", data: { orderId: ins[0].id, total: filtered.length, totalCost: total } });
}
