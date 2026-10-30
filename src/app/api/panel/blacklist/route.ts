import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { blacklist } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { parseRecipients, validateAndNormalizeList } from "@/lib/sms";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 20));
  const scope = s.isAdmin ? "1=1" : `(user_id=${s.id} OR user_id IS NULL)`;
  let where = scope;
  if (q) where += ` AND phone ILIKE '%${q.replace(/'/g, "''")}%'`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM blacklist WHERE ${where}`)).rows[0].c);
  const rows = (await pool.query(`SELECT id, phone, user_id as "userId", created_at as "createdAt" FROM blacklist WHERE ${where} ORDER BY id DESC LIMIT $1 OFFSET $2`, [perPage, (page - 1) * perPage])).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json();
  const raw: string[] = [];
  if (b.numbers) raw.push(...parseRecipients(String(b.numbers)));
  if (Array.isArray(b.phones)) raw.push(...b.phones.map(String));
  const { valid } = validateAndNormalizeList(raw);
  let added = 0;
  for (const phone of valid) {
    const ex = await pool.query(`SELECT id FROM blacklist WHERE phone=$1 AND (user_id=$2 OR user_id IS NULL) LIMIT 1`, [phone, s.id]);
    if (ex.rowCount === 0) {
      await db.insert(blacklist).values({ userId: s.isAdmin && b.global ? null : s.id, phone });
      added++;
    }
  }
  return NextResponse.json({ success: true, code: 200, message: `${added} numara karalisteye eklendi.` });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  if (b.phones && Array.isArray(b.phones)) {
    const { valid } = validateAndNormalizeList(b.phones.map(String));
    for (const phone of valid) {
      if (s.isAdmin) await pool.query(`DELETE FROM blacklist WHERE phone=$1`, [phone]);
      else await pool.query(`DELETE FROM blacklist WHERE phone=$1 AND user_id=$2`, [phone, s.id]);
    }
    return NextResponse.json({ success: true, code: 200, message: "Seçili numaralar silindi." });
  }
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ success: false, code: 400, message: "ID gerekli." }, { status: 400 });
  if (s.isAdmin) await db.delete(blacklist).where(eq(blacklist.id, id));
  else await db.delete(blacklist).where(and(eq(blacklist.id, id), eq(blacklist.userId, s.id)));
  return NextResponse.json({ success: true, code: 200, message: "Silindi." });
}
