import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden } from "@/lib/api-response";
import { formatInZone, parseTurkeyDateTime, TURKEY_TZ } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/panel/admin/activity              → kullanıcılar (çevrimiçi/pasif, son giriş/çıkış) + son olaylar
// GET /api/panel/admin/activity?since=<ISO>   → yalnız `since` sonrası açılan oturumlar (giriş zili için, hafif)
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!s.isAdmin) return forbidden();

  const admin = createAdminClient();
  await Promise.resolve(admin.rpc("rpc_close_stale_sessions")).catch(() => undefined);
  const url = new URL(req.url);
  const since = url.searchParams.get("since");

  // ---- giriş zili: yeni oturumlar (adminin kendi girişleri hariç)
  if (url.searchParams.has("since")) {
    let q = admin
      .from("user_sessions")
      .select("id, user_id, started_at, start_reason, ip")
      .neq("user_id", s.id)
      .order("started_at", { ascending: false })
      .limit(20);
    if (since && Number.isFinite(Date.parse(since))) q = q.gt("started_at", since);
    const { data: rows } = await q;
    const list = rows ?? [];
    const names = new Map<string, { username: string; name: string }>();
    const uids = [...new Set(list.map((r) => r.user_id))];
    if (uids.length) {
      const { data: profiles } = await admin.from("profiles").select("id, username, name").in("id", uids);
      for (const p of profiles ?? []) names.set(p.id, { username: p.username, name: p.name });
    }
    // yeni üyelik başvuruları (zil + bildirim)
    const validSince = since && Number.isFinite(Date.parse(since)) ? since : null;
    let signups: { id: string; username: string; name: string; created_at: string }[] = [];
    {
      let sq = admin.from("profiles").select("id, username, name, created_at").eq("signup_pending", true).order("created_at", { ascending: false }).limit(10);
      if (validSince) sq = sq.gt("created_at", validSince);
      const { data: srows } = await sq;
      signups = (srows ?? []) as typeof signups;
    }
    const latestCandidates = [list[0]?.started_at, signups[0]?.created_at].filter(Boolean) as string[];
    const latest = latestCandidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? validSince;

    return ok({
      latest,
      signups: validSince
        ? signups.map((x) => ({ userId: x.id, username: x.username, name: x.name, at: x.created_at }))
        : [],
      serverTime: new Date().toISOString(),
      events: since && Number.isFinite(Date.parse(since))
        ? list.map((r) => ({
            sessionId: r.id,
            userId: r.user_id,
            username: names.get(r.user_id)?.username ?? "",
            name: names.get(r.user_id)?.name ?? "",
            reason: r.start_reason,
            at: r.started_at,
          }))
        : [],
    });
  }

  // ---- tam görünüm
  const { data: timeoutRow } = await admin.from("system_settings").select("value").eq("key", "presence_timeout_seconds").maybeSingle();
  const timeoutSec = Math.max(60, Number(timeoutRow?.value) || 180);

  const [{ data: profiles }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("id, username, name, role_id, is_active, last_login_at, last_seen_at, created_at").order("username"),
    admin.from("roles").select("id, name"),
  ]);
  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));

  // "bugün" Türkiye saatine göre (gece yarısı 00:00 Europe/Istanbul)
  const ist = formatInZone(new Date(), TURKEY_TZ).date; // YYYY-MM-DD
  const dayStart = new Date(parseTurkeyDateTime(`${ist}T00:00`) ?? Date.now());
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: sessions } = await admin
    .from("user_sessions")
    .select("id, user_id, started_at, last_seen_at, ended_at, start_reason, end_reason, ip, user_agent")
    .gte("last_seen_at", weekAgo)
    .order("started_at", { ascending: false })
    .limit(2000);
  const ss = sessions ?? [];
  const now = Date.now();

  const users = (profiles ?? []).map((p) => {
    const mine = ss.filter((x) => x.user_id === p.id);
    const open = mine.find((x) => !x.ended_at);
    const lastEnded = mine.find((x) => !!x.ended_at);
    const online = !!open && now - Date.parse(open.last_seen_at) < timeoutSec * 1000;
    const todaySessions = mine.filter((x) => Date.parse(x.last_seen_at) >= dayStart.getTime());
    const todaySeconds = todaySessions.reduce((sum, x) => {
      const st = Math.max(Date.parse(x.started_at), dayStart.getTime());
      const en = x.ended_at ? Date.parse(x.ended_at) : Date.parse(x.last_seen_at);
      return sum + Math.max(0, Math.round((en - st) / 1000));
    }, 0);
    return {
      id: p.id,
      username: p.username,
      name: p.name,
      role: p.role_id ? roleName.get(p.role_id) ?? null : null,
      accountActive: p.is_active,
      online,
      activeSince: online ? open!.started_at : null, // aktif olduğu an
      lastLoginAt: p.last_login_at ?? null,
      lastSeenAt: p.last_seen_at ?? null,
      lastInactiveAt: online ? null : lastEnded?.ended_at ?? p.last_seen_at ?? null, // aktif olmaktan çıktığı an
      lastEndReason: online ? null : lastEnded?.end_reason ?? null,
      todaySessions: todaySessions.filter((x) => Date.parse(x.started_at) >= dayStart.getTime()).length,
      todayActiveSeconds: todaySeconds,
      ip: open?.ip ?? mine[0]?.ip ?? null,
      userAgent: open?.user_agent ?? mine[0]?.user_agent ?? null,
    };
  });

  // olay akışı: oturum başlangıçları ve bitişleri
  const nameById = new Map<string, { username: string; name: string }>(
    (profiles ?? []).map((p) => [p.id as string, { username: p.username as string, name: p.name as string }])
  );
  const events = ss
    .flatMap((x) => {
      const u = nameById.get(x.user_id);
      const base = { userId: x.user_id, username: u?.username ?? "", name: u?.name ?? "", ip: x.ip, userAgent: x.user_agent, sessionId: x.id };
      const out = [{ ...base, type: x.start_reason === "login" ? "login" : "resume", at: x.started_at }];
      if (x.ended_at) {
        out.push({ ...base, type: x.end_reason === "logout" ? "logout" : "timeout", at: x.ended_at });
      }
      return out;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 100);

  return ok({
    serverTime: new Date().toISOString(),
    timeoutSeconds: timeoutSec,
    summary: {
      online: users.filter((u) => u.online).length,
      totalUsers: users.length,
      todayLogins: ss.filter((x) => x.start_reason === "login" && Date.parse(x.started_at) >= dayStart.getTime()).length,
      activeToday: users.filter((u) => u.todayActiveSeconds > 0 || u.online).length,
    },
    users: users.sort((a, b) => Number(b.online) - Number(a.online) || Date.parse(b.lastSeenAt ?? "0") - Date.parse(a.lastSeenAt ?? "0")),
    events,
  });
}
