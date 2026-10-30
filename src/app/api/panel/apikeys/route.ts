import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/security";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, s.id));
  return NextResponse.json({
    success: true, code: 200, message: "OK",
    data: rows.map((r) => ({ id: r.id, name: r.name, keyPrefix: r.keyPrefix, status: r.status, ipWhitelist: r.ipWhitelist, callbackUrl: r.callbackUrl, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt })),
  });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "Varsayılan");
  const rawKey = "wolt_" + randomToken(16);
  const rawSecret = randomToken(24);
  const ins = await db.insert(apiKeys).values({
    userId: s.id,
    name,
    keyPrefix: rawKey.slice(0, 8),
    keyHash: sha256(rawKey),
    secretHash: sha256(rawSecret),
    ipWhitelist: b.ipWhitelist ? JSON.stringify(String(b.ipWhitelist).split(/[,\n]+/).map((x: string) => x.trim()).filter(Boolean)) : null,
    callbackUrl: b.callbackUrl ? String(b.callbackUrl) : null,
    status: "active",
  }).returning();
  // secret yalnızca bir kez gösterilir
  return NextResponse.json({ success: true, code: 200, message: "API anahtarı oluşturuldu. Secret'ı güvenli saklayın, tekrar gösterilmeyecek.", data: { id: ins[0].id, apiKey: rawKey, apiSecret: rawSecret, secretHash: sha256(rawSecret) } });
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json();
  if (!b.id) return NextResponse.json({ success: false, code: 400, message: "ID gerekli." }, { status: 400 });
  await db.update(apiKeys).set({
    name: b.name ? String(b.name) : undefined,
    ipWhitelist: b.ipWhitelist !== undefined ? (b.ipWhitelist ? JSON.stringify(String(b.ipWhitelist).split(/[,\n]+/).map((x: string) => x.trim()).filter(Boolean)) : null) : undefined,
    callbackUrl: b.callbackUrl !== undefined ? (b.callbackUrl ? String(b.callbackUrl) : null) : undefined,
    status: b.status ? String(b.status) : undefined,
  }).where(and(eq(apiKeys.id, Number(b.id)), eq(apiKeys.userId, s.id)));
  return NextResponse.json({ success: true, code: 200, message: "Güncellendi." });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  await db.update(apiKeys).set({ status: "revoked" }).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, s.id)));
  return NextResponse.json({ success: true, code: 200, message: "Anahtar iptal edildi." });
}
