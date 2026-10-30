import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, roles, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/security";
import { signSession, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ success: false, code: 400, message: "Kullanıcı adı ve şifre gerekli." }, { status: 400 });
    }
    const rows = await db.select().from(users).where(eq(users.username, String(username)));
    const u = rows[0];
    if (!u || !u.isActive) {
      return NextResponse.json({ success: false, code: 401, message: "Geçersiz kullanıcı veya şifre." }, { status: 401 });
    }
    const ok = await verifyPassword(String(password), u.passwordHash);
    if (!ok) {
      return NextResponse.json({ success: false, code: 401, message: "Geçersiz kullanıcı veya şifre." }, { status: 401 });
    }
    let roleName: string | null = null;
    if (u.roleId) {
      const r = await db.select().from(roles).where(eq(roles.id, u.roleId));
      roleName = r[0]?.name ?? null;
    }
    const isAdmin = roleName === "admin" || roleName === "SuperAdmin" || u.username === "admin";
    const session = {
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      roleId: u.roleId,
      roleName,
      isAdmin,
      quota: String(u.quota ?? "0"),
      unitPrice: String(u.unitPrice ?? "1"),
      quotaType: u.quotaType ?? "variable",
    };
    const token = signSession(session);
    await db.insert(auditLogs).values({ actorId: u.id, action: "auth.login", ip: req.headers.get("x-forwarded-for") || "", payload: JSON.stringify({ username: u.username }) });
    const res = NextResponse.json({ success: true, code: 200, message: "Giriş başarılı.", data: session });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, path: "/", maxAge: 12 * 3600, sameSite: "lax" });
    return res;
  } catch (e) {
    return NextResponse.json({ success: false, code: 500, message: "Sunucu hatası." }, { status: 500 });
  }
}
