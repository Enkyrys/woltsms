import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { notifications } from "@/db/schema";
import { eq, or, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const rows = (await pool.query(`SELECT * FROM notifications WHERE user_id=${s.id} OR user_id IS NULL ORDER BY created_at DESC LIMIT 20`)).rows;
  const unread = Number((await pool.query(`SELECT COUNT(*) c FROM notifications WHERE (user_id=${s.id} OR user_id IS NULL) AND is_read=false`)).rows[0].c);
  return NextResponse.json({ success: true, code: 200, message: "OK", data: { list: rows, unread } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.action === "read-all") {
    await pool.query(`UPDATE notifications SET is_read=true WHERE user_id=${s.id} OR user_id IS NULL`);
    return NextResponse.json({ success: true, code: 200, message: "Tümü okundu." });
  }
  if (b.id) {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, Number(b.id)));
    return NextResponse.json({ success: true, code: 200, message: "Okundu." });
  }
  return NextResponse.json({ success: false, code: 400, message: "Geçersiz." }, { status: 400 });
}
