import { NextResponse } from "next/server";
import { pool } from "@/db";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("action") === "balance") {
    const r = await pool.query(`SELECT quota FROM users WHERE id=$1`, [s.id]);
    return NextResponse.json({ success: true, code: 200, message: "OK", data: { balance: r.rows[0]?.quota ?? "0" } });
  }
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const type = url.searchParams.get("type") || "";
  const where = `${s.isAdmin && url.searchParams.get("all") === "1" ? "1=1" : `w.user_id=${s.id}`}${type ? ` AND w.type='${type.replace(/'/g, "")}'` : ""}`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM wallet_transactions w WHERE ${where}`)).rows[0].c);
  const rows = (
    await pool.query(
      `SELECT w.id, w.type as "txType", w.credit, w.total_price as "totalPrice", w.currency as "currency", w.unit_price as "unitPrice", w.balance_after as "balanceAfter", w.description, w.ref_type as "refType", w.ref_id as "refId", w.created_at as "createdAt", u.username FROM wallet_transactions w LEFT JOIN users u ON u.id=w.user_id WHERE ${where} ORDER BY w.created_at DESC LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    )
  ).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}
