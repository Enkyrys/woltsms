import { db, pool } from "@/db";
import { orders, smsMessages, walletTransactions, users } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { calcSegments } from "./sms";
import { getActiveProvider } from "./providers";

// Tek servis fonksiyonundan kredi düşme: transaction + satır kilidi
export async function debitBalance(opts: {
  userId: number;
  amount: number;
  unitPrice: number;
  credit: number;
  description: string;
  refType: string;
  refId: string;
}): Promise<{ newBalance: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT quota FROM users WHERE id=$1 FOR UPDATE", [opts.userId]);
    if (r.rowCount === 0) throw new Error("USER_NOT_FOUND");
    const current = Number(r.rows[0].quota ?? 0);
    if (current < opts.amount - 1e-9) {
      await client.query("ROLLBACK");
      const err = new Error("INSUFFICIENT_BALANCE") as Error & { code: number };
      err.code = 402;
      throw err;
    }
    const nb = current - opts.amount;
    await client.query("UPDATE users SET quota=$1, updated_at=NOW() WHERE id=$2", [nb.toFixed(4), opts.userId]);
    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, credit, unit_price, total_price, currency, balance_after, ref_type, ref_id, description) VALUES ($1,'debit',$2,$3,$4,'TRY',$5,$6,$7,$8)`,
      [opts.userId, opts.credit.toFixed(4), opts.unitPrice.toFixed(4), opts.amount.toFixed(4), nb.toFixed(4), opts.refType, opts.refId, opts.description]
    );
    await client.query("COMMIT");
    return { newBalance: nb };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function creditBalance(opts: {
  userId: number;
  amount: number;
  type: "topup" | "refund" | "adjust";
  description: string;
  refType: string;
  refId: string;
  unitPrice?: number;
}): Promise<{ newBalance: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT quota FROM users WHERE id=$1 FOR UPDATE", [opts.userId]);
    if (r.rowCount === 0) throw new Error("USER_NOT_FOUND");
    const current = Number(r.rows[0].quota ?? 0);
    const nb = current + opts.amount;
    await client.query("UPDATE users SET quota=$1, updated_at=NOW() WHERE id=$2", [nb.toFixed(4), opts.userId]);
    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, credit, unit_price, total_price, currency, balance_after, ref_type, ref_id, description) VALUES ($1,$2,$3,$4,$5,'TRY',$6,$7,$8,$9)`,
      [opts.userId, opts.type, opts.amount.toFixed(4), (opts.unitPrice ?? 1).toFixed(4), opts.amount.toFixed(4), nb.toFixed(4), opts.refType, opts.refId, opts.description]
    );
    await client.query("COMMIT");
    return { newBalance: nb };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// Sipariş işleme: rezerv->gönderim->kesinleştirme/iade
// Basitleştirilmiş kuyruk: senkron + zamanlı siparişler cron endpoint ile işlenir
export async function processOrder(orderId: number): Promise<void> {
  const orderRows = await db.select().from(orders).where(eq(orders.id, orderId));
  const order = orderRows[0];
  if (!order) return;
  if (order.status === "completed" || order.status === "cancelled" || order.status === "failed") return;

  await db.update(orders).set({ status: "processing", updatedAt: new Date() }).where(eq(orders.id, orderId));

  const msgs = await db.select().from(smsMessages).where(and(eq(smsMessages.orderId, orderId), eq(smsMessages.status, "pending")));
  if (msgs.length === 0) {
    await db.update(orders).set({ status: "completed", updatedAt: new Date() }).where(eq(orders.id, orderId));
    return;
  }

  const provider = await getActiveProvider();
  let processed = order.processedCount ?? 0;
  let anyFail = false;

  for (const m of msgs) {
    try {
      const res = await provider.sendSms(m.recipient, m.body);
      if (res.ok) {
        await db
          .update(smsMessages)
          .set({ status: "sent", providerMessageId: res.providerMessageId, updatedAt: new Date() })
          .where(eq(smsMessages.id, m.id));
      } else {
        anyFail = true;
        await db
          .update(smsMessages)
          .set({ status: "failed", errorCode: res.errorCode, updatedAt: new Date() })
          .where(eq(smsMessages.id, m.id));
        // otomatik iade
        const cost = Number(m.cost ?? 0);
        if (cost > 0) {
          await creditBalance({
            userId: m.userId,
            amount: cost,
            type: "refund",
            description: `Otomatik iade (Sipariş #${orderId}, ${m.recipient}) - ${res.errorCode || ""}`,
            refType: "order",
            refId: String(orderId),
          });
        }
      }
    } catch {
      anyFail = true;
      await db.update(smsMessages).set({ status: "failed", errorCode: "EXCEPTION", updatedAt: new Date() }).where(eq(smsMessages.id, m.id));
      const cost = Number(m.cost ?? 0);
      if (cost > 0) {
        await creditBalance({
          userId: m.userId,
          amount: cost,
          type: "refund",
          description: `Otomatik iade (Sipariş #${orderId}, ${m.recipient})`,
          refType: "order",
          refId: String(orderId),
        });
      }
    }
    processed += 1;
    await db.update(orders).set({ processedCount: processed, updatedAt: new Date() }).where(eq(orders.id, orderId));
  }

  const remaining = await db.select({ c: sql<number>`count(*)` }).from(smsMessages).where(and(eq(smsMessages.orderId, orderId), eq(smsMessages.status, "pending")));
  const left = Number(remaining[0]?.c ?? 0);
  await db
    .update(orders)
    .set({ status: left > 0 ? "processing" : anyFail && processed === 0 ? "failed" : "completed", updatedAt: new Date() })
    .where(eq(orders.id, orderId));
}

export async function applyDlr(providerMessageId: string, status: "delivered" | "failed", errorCode?: string): Promise<void> {
  const rows = await db.select().from(smsMessages).where(eq(smsMessages.providerMessageId, providerMessageId));
  const m = rows[0];
  if (!m) return;
  if (m.status === "delivered" || m.status === "failed") {
    // failure already refunded at send-time; DLR failure after sent needs refund too
  }
  const prev = m.status;
  const next = status === "delivered" ? "delivered" : "failed";
  await db.update(smsMessages).set({ status: next, errorCode: errorCode || m.errorCode, updatedAt: new Date() }).where(eq(smsMessages.id, m.id));
  if (next === "failed" && prev !== "failed") {
    const cost = Number(m.cost ?? 0);
    if (cost > 0) {
      await creditBalance({
        userId: m.userId,
        amount: cost,
        type: "refund",
        description: `DLR iadesi (Sipariş #${m.orderId}, ${m.recipient})`,
        refType: "order",
        refId: String(m.orderId),
      });
    }
  }
  // update order processed counter approximation
  const agg = await db
    .select({ c: sql<number>`count(*)` })
    .from(smsMessages)
    .where(and(eq(smsMessages.orderId, m.orderId), sql`status IN ('delivered','failed')`));
  const done = Number(agg[0]?.c ?? 0);
  await db.update(orders).set({ processedCount: done, updatedAt: new Date() }).where(eq(orders.id, m.orderId));
}

export async function expireTopups(): Promise<number> {
  // pending/reported older than TTL -> expired
  const settings = await db.select().from((await import("@/db/schema")).paymentSettings);
  const ttl = settings[0]?.requestTtlMinutes ?? 1440;
  const res = await pool.query(
    `UPDATE topup_requests SET status='expired', updated_at=NOW() WHERE status IN ('pending','reported') AND created_at < NOW() - ($1 || ' minutes')::interval`,
    [ttl]
  );
  return res.rowCount ?? 0;
}

export async function processScheduledOrders(): Promise<number> {
  const due = await db.select().from(orders).where(and(eq(orders.status, "scheduled"), sql`scheduled_at <= NOW()`));
  for (const o of due) {
    await db.update(orders).set({ status: "pending", updatedAt: new Date() }).where(eq(orders.id, o.id));
    await processOrder(o.id);
  }
  return due.length;
}

export function costFor(message: string, recipients: number, unitPrice: number): { segments: number; total: number; encoding: string } {
  const { segments, encoding } = calcSegments(message);
  return { segments, encoding, total: Number((segments * recipients * unitPrice).toFixed(4)) };
}
