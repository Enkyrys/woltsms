import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { unauthorized } from "@/lib/api-response";
import { touchPresence, readPresenceCookie, PRESENCE_COOKIE, presenceCookieOptions } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/panel/presence — panel açıkken ~60 sn'de bir çağrılır ("buradayım" sinyali).
// Açık oturum yenilenir; oturum zaman aşımıyla kapanmışsa yeni oturum açılır ("yeniden aktif").
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const cookieId = readPresenceCookie(req);
  const { sessionId, started } = await touchPresence({ userId: s.id, sessionId: cookieId, reason: "resume", req });
  const res = NextResponse.json({ success: true, code: 200, message: "OK", data: { started } });
  if (sessionId && sessionId !== cookieId) res.cookies.set(PRESENCE_COOKIE, sessionId, presenceCookieOptions);
  return res;
}
