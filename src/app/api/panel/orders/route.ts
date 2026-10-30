import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { orders, smsMessages, blacklist, contactLists, contacts, sentMessageHistory, systemSettings, users, idempotencyKeys } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getSession, hasPermission } from "@/lib/auth";
import { calcSegments, parseRecipients, validateAndNormalizeList, isWithinSendingWindow } from "@/lib/sms";
import { debitBalance, processOrder } from "@/lib/services";
import { brand } from "@/config/brand";

async function getSys(key: string, def: string): Promise<string> {
  const r = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  return r[0]?.value ?? def;
}

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const o = (await db.select().from(orders).where(eq(orders.id, Number(id))))[0];
    if (!o || (!s.isAdmin && o.userId !== s.id)) return NextResponse.json({ success: false, code: 404, message: "Sipariş bulunamadı." }, { status: 404 });
    if (url.searchParams.get("export") === "csv") {
      const msgs = await db.select().from(smsMessages).where(eq(smsMessages.orderId, Number(id)));
      const csv = "recipient,status,segments,cost,encoding,createdAt\n" + msgs.map((m) => `${m.recipient},${m.status},${m.segments},${m.cost},${m.encoding},${m.createdAt.toISOString()}`).join("\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=siparis-${id}.csv` } });
    }
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 20));
    const total = Number((await pool.query(`SELECT COUNT(*) c FROM sms_messages WHERE order_id=${Number(id)}`)).rows[0].c);
    const msgs = (await pool.query(`SELECT * FROM sms_messages WHERE order_id=${Number(id)} ORDER BY id ASC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`)).rows;
    const creator = (await db.select().from(users).where(eq(users.id, o.userId)))[0];
    return NextResponse.json({ success: true, code: 200, message: "OK", data: { order: { ...o, username: creator?.username }, messages: msgs, meta: { total, page, perPage } } });
  }
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const status = url.searchParams.get("status") || "";
  const where = `${s.isAdmin ? "1=1" : `o.user_id=${s.id}`}${status ? ` AND o.status='${status.replace(/'/g, "")}'` : ""}`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM orders o WHERE ${where}`)).rows[0].c);
  const rows = (
    await pool.query(
      `SELECT o.id, o.status, o.total_count as "totalCount", o.processed_count as "processedCount", LEFT(o.message,120) as message, o.scheduled_at as "scheduledAt", o.created_at as "createdAt", o.updated_at as "updatedAt", o.note, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE ${where} ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    )
  ).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "sms.send"))) return NextResponse.json({ success: false, code: 403, message: "Gönderim yetkiniz yok." }, { status: 403 });

  // Idempotency
  const idemKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
  if (idemKey) {
    const ex = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, s.id), eq(idempotencyKeys.key, idemKey)));
    if (ex[0]?.response) {
      return NextResponse.json(JSON.parse(ex[0].response));
    }
  }

  const b = await req.json().catch(() => ({}));
  const message = String(b.message || "").trim();
  if (!message) return NextResponse.json({ success: false, code: 400, message: "Mesaj boş olamaz." }, { status: 400 });
  if (message.length > 2000) return NextResponse.json({ success: false, code: 422, message: "Mesaj çok uzun (maks 2000 karakter)." }, { status: 422 });

  // recipients from textarea + lists
  let rawPhones: string[] = [];
  if (b.numbers) rawPhones.push(...parseRecipients(String(b.numbers)));
  if (Array.isArray(b.recipients)) rawPhones.push(...b.recipients.map(String));
  if (Array.isArray(b.phones)) rawPhones.push(...b.phones.map(String));
  if (b.listId) {
    const lid = Number(b.listId);
    const l = (await db.select().from(contactLists).where(eq(contactLists.id, lid)))[0];
    if (l && (s.isAdmin || l.userId === s.id)) {
      const cs = await db.select().from(contacts).where(eq(contacts.listId, lid));
      rawPhones.push(...cs.map((c) => c.phone));
    }
  }
  if (Array.isArray(b.listIds)) {
    for (const lidRaw of b.listIds) {
      const lid = Number(lidRaw);
      const l = (await db.select().from(contactLists).where(eq(contactLists.id, lid)))[0];
      if (l && (s.isAdmin || l.userId === s.id)) {
        const cs = await db.select().from(contacts).where(eq(contacts.listId, lid));
        rawPhones.push(...cs.map((c) => c.phone));
      }
    }
  }
  const { valid, invalid } = validateAndNormalizeList(rawPhones);
  if (valid.length === 0) {
    return NextResponse.json({ success: false, code: 422, message: "Geçerli numara bulunamadı.", data: { invalid: invalid.slice(0, 20) } }, { status: 422 });
  }

  // sending window rule
  const ruleEnabled = (await getSys("sending_rule_enabled", "1")) === "1";
  const startH = Number(await getSys("sending_start_hour", String(brand.sendingStartHour)));
  const endH = Number(await getSys("sending_end_hour", String(brand.sendingEndHour)));
  const scheduledAt: Date | null = b.scheduledAt ? new Date(b.scheduledAt) : null;
  const isScheduled = scheduledAt && scheduledAt.getTime() > Date.now();
  if (ruleEnabled && !isScheduled && !isWithinSendingWindow(new Date(), startH, endH)) {
    // create cancelled order for audit
    const ins = await db
      .insert(orders)
      .values({ userId: s.id, status: "cancelled", totalCount: valid.length, processedCount: 0, message, createdBy: s.id, note: `${startH}:00–${endH}:00 dışı gönderim engellendi.` })
      .returning();
    return NextResponse.json({ success: false, code: 422, message: `Gönderimler ${startH}:00–${endH}:00 saatleri arasında aktiftir. ${endH}:00 sonrası gönderimler iptal edilir.`, data: { orderId: ins[0].id } }, { status: 422 });
  }

  // blacklist filter
  const blRows = await pool.query(`SELECT phone FROM blacklist WHERE phone = ANY($1) AND (user_id=$2 OR user_id IS NULL)`, [valid, s.id]);
  const blSet = new Set(blRows.rows.map((r) => r.phone));
  const filtered = valid.filter((p) => !blSet.has(p));
  const blCount = valid.length - filtered.length;
  if (filtered.length === 0) {
    return NextResponse.json({ success: false, code: 422, message: "Tüm numaralar karalistedede." }, { status: 422 });
  }

  // segment + cost
  const { segments, encoding } = calcSegments(message);
  const me = (await db.select().from(users).where(eq(users.id, s.id)))[0];
  const unitPrice = Number(me?.unitPrice ?? 1);
  const perSmsCost = Number((segments * unitPrice).toFixed(4));
  const totalCost = Number((perSmsCost * filtered.length).toFixed(4));

  // balance check + atomic reserve (debit)
  try {
    await debitBalance({ userId: s.id, amount: totalCost, unitPrice, credit: filtered.length * segments, description: `SMS Gönderimi (${filtered.length} adet, ${segments} segment)`, refType: "order", refId: "pending" });
  } catch (e) {
    const err = e as Error & { code?: number };
    if (err.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json({ success: false, code: 402, message: "Yetersiz bakiye. Lütfen kredi yükleyin." }, { status: 402 });
    }
    throw e;
  }

  // create order + messages
  const noteParts: string[] = [];
  if (blCount > 0) noteParts.push(`${blCount} numara karaliste nedeniyle çıkarıldı.`);
  if (invalid.length > 0) noteParts.push(`${invalid.length} geçersiz numara atlandı.`);
  const orderIns = await db
    .insert(orders)
    .values({
      userId: s.id,
      status: isScheduled ? "scheduled" : "pending",
      totalCount: filtered.length,
      processedCount: 0,
      message,
      scheduledAt: isScheduled ? scheduledAt : null,
      createdBy: s.id,
      note: noteParts.join(" ") || null,
    })
    .returning();
  const orderId = orderIns[0].id;
  // fix refId of debit
  await pool.query(`UPDATE wallet_transactions SET ref_id=$1 WHERE id=(SELECT id FROM wallet_transactions WHERE user_id=$2 AND ref_type='order' AND ref_id='pending' ORDER BY id DESC LIMIT 1)`, [String(orderId), s.id]);

  for (const chunk of chunkArr(filtered, 500)) {
    await db.insert(smsMessages).values(
      chunk.map((recipient) => ({
        orderId,
        userId: s.id,
        recipient,
        body: message,
        encoding,
        segments,
        cost: String(perSmsCost),
        status: "pending",
      }))
    );
  }
  // history (dedupe: keep last 20)
  try {
    await db.insert(sentMessageHistory).values({ userId: s.id, body: message });
  } catch {}

  const payload = { success: true, code: 200, message: isScheduled ? "Zamanlı sipariş oluşturuldu." : "Sipariş oluşturuldu, gönderim başladı.", data: { orderId, total: filtered.length, segments, encoding, totalCost, blacklisted: blCount, invalid: invalid.length } };
  if (idemKey) {
    try {
      await db.insert(idempotencyKeys).values({ userId: s.id, key: idemKey, response: JSON.stringify(payload) });
    } catch {}
  }

  // process async (fire & forget for immediate)
  if (!isScheduled) {
    processOrder(orderId).catch((e) => console.error("processOrder", e));
  }
  return NextResponse.json(payload);
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
  if (!o || (!s.isAdmin && o.userId !== s.id)) return NextResponse.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
  if (o.status !== "scheduled" && o.status !== "pending") return NextResponse.json({ success: false, code: 400, message: "Bu sipariş iptal edilemez." }, { status: 400 });
  // refund pending messages
  const pend = await db.select().from(smsMessages).where(and(eq(smsMessages.orderId, id), eq(smsMessages.status, "pending")));
  let refund = 0;
  for (const m of pend) refund += Number(m.cost ?? 0);
  await db.update(smsMessages).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(smsMessages.orderId, id), eq(smsMessages.status, "pending")));
  await db.update(orders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(orders.id, id));
  if (refund > 0) {
    const { creditBalance } = await import("@/lib/services");
    await creditBalance({ userId: o.userId, amount: refund, type: "refund", description: `Sipariş iptal iadesi (#${id})`, refType: "order", refId: String(id) });
  }
  return NextResponse.json({ success: true, code: 200, message: "Sipariş iptal edildi, iade yapıldı." });
}

function chunkArr<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
