import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { supportTickets, ticketMessages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const t = (await db.select().from(supportTickets).where(eq(supportTickets.id, Number(id))))[0];
    if (!t || (!s.isAdmin && t.userId !== s.id)) return NextResponse.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
    const msgs = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, Number(id)));
    return NextResponse.json({ success: true, code: 200, message: "OK", data: { ticket: t, messages: msgs } });
  }
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const where = s.isAdmin ? "1=1" : `t.user_id=${s.id}`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM support_tickets t WHERE ${where}`)).rows[0].c);
  const rows = (
    await pool.query(
      `SELECT t.id, t.status, t.subject, t.created_at as "createdAt", t.updated_at as "updatedAt", u.username, (SELECT message FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) as "lastMessage" FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id WHERE ${where} ORDER BY t.updated_at DESC LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    )
  ).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json();
  if (b.ticketId) {
    const t = (await db.select().from(supportTickets).where(eq(supportTickets.id, Number(b.ticketId))))[0];
    if (!t || (!s.isAdmin && t.userId !== s.id)) return NextResponse.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
    if (!b.message) return NextResponse.json({ success: false, code: 400, message: "Mesaj gerekli." }, { status: 400 });
    await db.insert(ticketMessages).values({ ticketId: Number(b.ticketId), userId: s.id, message: String(b.message), attachment: b.attachment ? String(b.attachment).slice(0, 2000000) : null });
    await db.update(supportTickets).set({ status: s.isAdmin ? "answered" : "open", updatedAt: new Date() }).where(eq(supportTickets.id, Number(b.ticketId)));
    return NextResponse.json({ success: true, code: 200, message: "Mesaj gönderildi." });
  }
  if (!b.subject || !b.message) return NextResponse.json({ success: false, code: 400, message: "Konu ve mesaj gerekli." }, { status: 400 });
  const ins = await db.insert(supportTickets).values({ userId: s.id, subject: String(b.subject), status: "open" }).returning();
  await db.insert(ticketMessages).values({ ticketId: ins[0].id, userId: s.id, message: String(b.message) });
  return NextResponse.json({ success: true, code: 200, message: "Destek talebi oluşturuldu.", data: ins[0] });
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s || !s.isAdmin) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const b = await req.json();
  if (!b.id || !b.status) return NextResponse.json({ success: false, code: 400, message: "Eksik parametre." }, { status: 400 });
  await db.update(supportTickets).set({ status: String(b.status), updatedAt: new Date() }).where(eq(supportTickets.id, Number(b.id)));
  return NextResponse.json({ success: true, code: 200, message: "Durum güncellendi." });
}
