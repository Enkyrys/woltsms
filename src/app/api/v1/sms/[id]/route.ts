import { NextResponse } from "next/server";
import { db } from "@/db";
import { smsMessages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateApiRequest } from "@/lib/auth";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ success: false, code: auth.code, message: auth.error }, { status: auth.code });
  const { id } = await ctx.params;
  const rows = await db.select().from(smsMessages).where(and(eq(smsMessages.id, Number(id)), eq(smsMessages.userId, auth.userId)));
  const m = rows[0];
  if (!m) return NextResponse.json({ success: false, code: 404, message: "Mesaj bulunamadı." }, { status: 404 });
  return NextResponse.json({ success: true, code: 200, message: "OK", data: m });
}
