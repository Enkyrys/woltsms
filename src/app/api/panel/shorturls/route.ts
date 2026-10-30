import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { shortUrls } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { generateSlug } from "@/lib/security";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const where = s.isAdmin ? "1=1" : `s.user_id=${s.id}`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM short_urls s WHERE ${where}`)).rows[0].c);
  const rows = (
    await pool.query(
      `SELECT s.id, s.business_name as "businessName", s.original_url as "originalUrl", s.slug, s.clicks, s.created_at as "createdAt", u.username FROM short_urls s LEFT JOIN users u ON u.id=s.user_id WHERE ${where} ORDER BY s.id DESC LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    )
  ).rows;
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows.map((r) => ({ ...r, shortUrl: `${base}/s/${r.slug}` })), meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json();
  const original = String(b.url || b.originalUrl || "").trim();
  if (!original || !/^https?:\/\//i.test(original)) return NextResponse.json({ success: false, code: 400, message: "Geçerli bir URL girin (https://...)." }, { status: 400 });
  const slug = generateSlug(7);
  const ins = await db.insert(shortUrls).values({ userId: s.id, businessName: b.businessName ? String(b.businessName) : null, originalUrl: original, slug }).returning();
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  return NextResponse.json({ success: true, code: 200, message: "Kısa URL oluşturuldu.", data: { ...ins[0], shortUrl: `${base}/s/${slug}` } });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (s.isAdmin) await db.delete(shortUrls).where(eq(shortUrls.id, id));
  else await db.delete(shortUrls).where(and(eq(shortUrls.id, id), eq(shortUrls.userId, s.id)));
  return NextResponse.json({ success: true, code: 200, message: "Silindi." });
}
