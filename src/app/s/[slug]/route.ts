import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { shortUrls } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const rows = await db.select().from(shortUrls).where(eq(shortUrls.slug, slug));
  const r = rows[0];
  if (!r) return NextResponse.json({ success: false, code: 404, message: "Kısa URL bulunamadı." }, { status: 404 });
  await pool.query(`UPDATE short_urls SET clicks=clicks+1 WHERE id=${r.id}`);
  return NextResponse.redirect(r.originalUrl, 302);
}
