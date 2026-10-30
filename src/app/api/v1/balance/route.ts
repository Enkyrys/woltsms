import { NextResponse } from "next/server";
import { pool } from "@/db";
import { authenticateApiRequest } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code });
  const r = await pool.query(`SELECT quota, unit_price FROM users WHERE id=$1`, [auth.userId]);
  return NextResponse.json({ success: true, code: 200, message: "OK", data: { balance: r.rows[0]?.quota ?? "0", unitPrice: r.rows[0]?.unit_price ?? "1", currency: "TRY" } });
}
