import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, pool } from "@/db";
import { announcements } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const userFilter = s.isAdmin ? "" : `WHERE user_id=${s.id}`;
  const userAnd = s.isAdmin ? "" : `AND user_id=${s.id}`;
  const [ordersCount, smsCount, balanceRow, pendingTopups, notifs] = await Promise.all([
    pool.query(`SELECT COUNT(*) c FROM orders ${userFilter}`),
    pool.query(`SELECT COUNT(*) c, COALESCE(SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END),0) delivered FROM sms_messages ${userFilter}`),
    pool.query(`SELECT quota FROM users WHERE id=$1`, [s.id]),
    pool.query(s.isAdmin ? `SELECT COUNT(*) c FROM topup_requests WHERE status IN ('pending','reported')` : `SELECT COUNT(*) c FROM topup_requests WHERE status IN ('pending','reported') AND user_id=${s.id}`),
    pool.query(`SELECT COUNT(*) c FROM notifications WHERE (user_id=${s.id} OR user_id IS NULL) AND is_read=false`),
  ]);
  const recentOrders = await pool.query(
    s.isAdmin
      ? `SELECT o.*, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 5`
      : `SELECT o.*, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.user_id=${s.id} ORDER BY o.created_at DESC LIMIT 5`
  );
  const txSum = await pool.query(`SELECT COALESCE(SUM(total_price::numeric),0) s FROM wallet_transactions WHERE type='debit' ${userAnd.replace("user_id", "user_id")}`);
  const anns = await db.select().from(announcements).where(eq(announcements.isActive, true));
  return NextResponse.json({
    success: true,
    code: 200,
    message: "OK",
    data: {
      balance: balanceRow.rows[0]?.quota ?? "0",
      orders: Number(ordersCount.rows[0]?.c ?? 0),
      smsTotal: Number(smsCount.rows[0]?.c ?? 0),
      smsDelivered: Number(smsCount.rows[0]?.delivered ?? 0),
      spent: Number(txSum.rows[0]?.s ?? 0),
      pendingTopups: Number(pendingTopups.rows[0]?.c ?? 0),
      unreadNotifications: Number(notifs.rows[0]?.c ?? 0),
      recentOrders: recentOrders.rows,
      announcement: anns[0]?.text ?? "",
    },
  });
}
