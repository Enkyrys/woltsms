import { NextResponse } from "next/server";
import { pool } from "@/db";
import { authenticateApiRequest } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code });
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 20));
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM orders WHERE user_id=${auth.userId}`)).rows[0].c);
  const rows = (await pool.query(`SELECT id, status, total_count as "totalCount", processed_count as "processedCount", scheduled_at as "scheduledAt", created_at as "createdAt" FROM orders WHERE user_id=${auth.userId} ORDER BY id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`)).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage } });
}
