import { NextResponse } from "next/server";
import { getSession, logout } from "@/lib/auth";
import { endPresence, readPresenceCookie, PRESENCE_COOKIE } from "@/lib/presence";

export async function POST(req: Request) {
  // kullanıcı aktivitesi: oturumu "çıkış" olarak kapat (çıkıştan önce kimlik okunur)
  const s = await getSession().catch(() => null);
  if (s) await endPresence(s.id, readPresenceCookie(req));
  await logout();
  const res = NextResponse.json({ success: true, code: 200, message: "Çıkış yapıldı." });
  res.cookies.set(PRESENCE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
