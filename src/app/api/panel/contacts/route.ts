import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { contactLists, contacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { parseRecipients, validateAndNormalizeList } from "@/lib/sms";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (action === "numbers" && url.searchParams.get("id")) {
    const id = Number(url.searchParams.get("id"));
    const list = (await db.select().from(contactLists).where(eq(contactLists.id, id)))[0];
    if (!list || (!s.isAdmin && list.userId !== s.id)) return NextResponse.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
    const nums = await db.select().from(contacts).where(eq(contacts.listId, id));
    return NextResponse.json({ success: true, code: 200, message: "OK", data: nums.map((n) => n.phone) });
  }
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const where = s.isAdmin ? "1=1" : `user_id=${s.id}`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM contact_lists WHERE ${where}`)).rows[0].c);
  const rows = (await pool.query(`SELECT id, user_id as "userId", title, count, created_at as "createdAt", updated_at as "updatedAt" FROM contact_lists WHERE ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [perPage, (page - 1) * perPage])).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json();
  if (!b.title) return NextResponse.json({ success: false, code: 400, message: "Başlık gerekli." }, { status: 400 });
  const rawList: string[] = [];
  if (b.numbers) rawList.push(...parseRecipients(String(b.numbers)));
  if (Array.isArray(b.phones)) rawList.push(...b.phones.map(String));
  const { valid } = validateAndNormalizeList(rawList);
  const ins = await db.insert(contactLists).values({ userId: s.id, title: String(b.title), count: valid.length }).returning();
  const listId = ins[0].id;
  for (const chunk of chunkArr(valid, 1000)) {
    if (chunk.length) await db.insert(contacts).values(chunk.map((phone) => ({ listId, phone })));
  }
  return NextResponse.json({ success: true, code: 200, message: `Rehber oluşturuldu (${valid.length} numara).`, data: ins[0] });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const list = (await db.select().from(contactLists).where(eq(contactLists.id, id)))[0];
  if (!list || (!s.isAdmin && list.userId !== s.id)) return NextResponse.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
  await db.delete(contacts).where(eq(contacts.listId, id));
  await db.delete(contactLists).where(eq(contactLists.id, id));
  return NextResponse.json({ success: true, code: 200, message: "Rehber silindi." });
}

function chunkArr<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
