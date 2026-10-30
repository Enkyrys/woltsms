import { NextResponse } from "next/server";
import { db } from "@/db";
import { sentMessageHistory } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const rows = await db.select().from(sentMessageHistory).where(eq(sentMessageHistory.userId, s.id)).orderBy(desc(sentMessageHistory.id)).limit(20);
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows });
}
