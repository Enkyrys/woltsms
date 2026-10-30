import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { orders, smsMessages, users, systemSettings, idempotencyKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateApiRequest } from "@/lib/auth";
import { calcSegments, validateAndNormalizeList, isWithinSendingWindow } from "@/lib/sms";
import { debitBalance, processOrder } from "@/lib/services";
import { brand } from "@/config/brand";

export async function POST(req: Request) {
  const bodyText = await req.text();
  (req as unknown as { __bodyText?: string }).__bodyText = bodyText;
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code });

  let b: Record<string, unknown> = {};
  try { b = JSON.parse(bodyText || "{}"); } catch { return NextResponse.json({ success: false, code: 400, message: "Geçersiz JSON." }, { status: 400 }); }

  const idemKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
  if (idemKey) {
    const ex = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, auth.userId), eq(idempotencyKeys.key, idemKey)));
    if (ex[0]?.response) return NextResponse.json(JSON.parse(ex[0].response));
  }

  const message = String((b.message as string) || "").trim();
  const recipientsRaw = (b.recipients as string[]) || [];
  if (!message) return NextResponse.json({ success: false, code: 400, message: "message gerekli." }, { status: 400 });
  if (!Array.isArray(recipientsRaw) || recipientsRaw.length === 0) return NextResponse.json({ success: false, code: 400, message: "recipients gerekli." }, { status: 400 });
  if (recipientsRaw.length > 5000) return NextResponse.json({ success: false, code: 422, message: "Tek istekte en fazla 5000 alıcı." }, { status: 422 });

  const { valid, invalid } = validateAndNormalizeList(recipientsRaw.map(String));
  if (valid.length === 0) return NextResponse.json({ success: false, code: 422, message: "Geçerli numara yok.", data: { invalid } }, { status: 422 });

  // time window
  const sys = await db.select().from(systemSettings);
  const get = (k: string, d: string) => sys.find((x) => x.key === k)?.value ?? d;
  const enabled = get("sending_rule_enabled", "1") === "1";
  const sH = Number(get("sending_start_hour", String(brand.sendingStartHour)));
  const eH = Number(get("sending_end_hour", String(brand.sendingEndHour)));
  const scheduledAt = b.schedule_at ? new Date(String(b.schedule_at)) : b.scheduledAt ? new Date(String(b.scheduledAt)) : null;
  const isScheduled = scheduledAt && !isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now();
  if (enabled && !isScheduled && !isWithinSendingWindow(new Date(), sH, eH)) {
    return NextResponse.json({ success: false, code: 422, message: `Gönderimler ${sH}:00–${eH}:00 arasında aktif.` }, { status: 422 });
  }

  // blacklist
  const bl = await pool.query(`SELECT phone FROM blacklist WHERE phone = ANY($1) AND (user_id=$2 OR user_id IS NULL)`, [valid, auth.userId]);
  const blSet = new Set(bl.rows.map((r) => r.phone));
  const filtered = valid.filter((p) => !blSet.has(p));
  if (filtered.length === 0) return NextResponse.json({ success: false, code: 422, message: "Tüm numaralar karalistedede." }, { status: 422 });

  const { segments, encoding } = calcSegments(message);
  const me = (await db.select().from(users).where(eq(users.id, auth.userId)))[0];
  if (!me || !me.isActive) return NextResponse.json({ success: false, code: 403, message: "Hesap pasif." }, { status: 403 });
  const unitPrice = Number(me.unitPrice ?? 1);
  const perCost = Number((segments * unitPrice).toFixed(4));
  const total = Number((perCost * filtered.length).toFixed(4));

  try {
    await debitBalance({ userId: auth.userId, amount: total, unitPrice, credit: filtered.length * segments, description: `API SMS Gönderimi (${filtered.length} adet)`, refType: "order", refId: "pending-api" });
  } catch {
    return NextResponse.json({ success: false, code: 402, message: "Yetersiz bakiye." }, { status: 402 });
  }

  const ins = await db.insert(orders).values({ userId: auth.userId, status: isScheduled ? "scheduled" : "pending", totalCount: filtered.length, message, scheduledAt: isScheduled ? scheduledAt : null, createdBy: auth.userId }).returning();
  await pool.query(`UPDATE wallet_transactions SET ref_id=$1 WHERE id=(SELECT id FROM wallet_transactions WHERE user_id=$2 AND ref_id='pending-api' ORDER BY id DESC LIMIT 1)`, [String(ins[0].id), auth.userId]);
  await db.insert(smsMessages).values(filtered.map((recipient) => ({ orderId: ins[0].id, userId: auth.userId, recipient, body: message, encoding, segments, cost: String(perCost), status: "pending" })));

  const payload = { success: true, code: 200, message: "Gönderim kuyruğa alındı.", data: { orderId: ins[0].id, total: filtered.length, segments, encoding, totalCost: total, blacklisted: valid.length - filtered.length } };
  if (idemKey) { try { await db.insert(idempotencyKeys).values({ userId: auth.userId, key: idemKey, response: JSON.stringify(payload) }); } catch {} }
  if (!isScheduled) processOrder(ins[0].id).catch(console.error);
  return NextResponse.json(payload);
}
