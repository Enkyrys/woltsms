import { createAdminClient } from "@/lib/supabase/admin";

// Kullanıcı aktivitesi (oturum takibi) — yalnız sunucu tarafı.
// Oturum kimliği httpOnly çerezde tutulur; asıl kayıt user_sessions tablosundadır.
export const PRESENCE_COOKIE = "wsid";
export const PRESENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 gün

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "").trim() || "unknown";
}

export function readPresenceCookie(req: Request): string | null {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(/(?:^|;\s*)wsid=([0-9a-f-]{36})(?:;|$)/i);
  return m ? m[1] : null;
}

export async function touchPresence(opts: {
  userId: string;
  sessionId?: string | null;
  reason: "login" | "resume";
  req: Request;
}): Promise<{ sessionId: string | null; started: boolean }> {
  try {
    const { data, error } = await createAdminClient().rpc("rpc_presence_touch", {
      p_user_id: opts.userId,
      p_session_id: opts.sessionId ?? null,
      p_reason: opts.reason,
      p_ip: clientIp(opts.req),
      p_user_agent: opts.req.headers.get("user-agent") || null,
    });
    if (error) return { sessionId: null, started: false };
    const d = (data ?? {}) as { session_id?: string; started?: boolean };
    return { sessionId: d.session_id ?? null, started: !!d.started };
  } catch {
    return { sessionId: null, started: false }; // aktivite kaydı girişi asla engellemez
  }
}

export async function endPresence(userId: string, sessionId: string | null): Promise<void> {
  try {
    await createAdminClient().rpc("rpc_session_end", { p_user_id: userId, p_session_id: sessionId });
  } catch {
    /* yok say */
  }
}

export const presenceCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: PRESENCE_COOKIE_MAX_AGE,
};
