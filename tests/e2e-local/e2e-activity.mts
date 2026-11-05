// Uçtan uca: GERÇEK giriş/çıkış/sinyal uç noktaları + GERÇEK admin aktivite API'si + gerçek migration'lı Postgres
import { sql } from "./fake-supabase.ts";
import { setTestSession, setTestLoginUser } from "./auth-shim.ts";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as presencePOST } from "@/app/api/panel/presence/route";
import { GET as activityGET } from "@/app/api/panel/admin/activity/route";

let failures = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${info ? " — " + info : ""}`); if (!ok) failures++; };

const ADMIN = "55555555-5555-5555-5555-555555555555";
const BAYI = "66666666-6666-6666-6666-666666666666";
sql(`insert into auth.users(id,email) values ('${ADMIN}','admin@t'),('${BAYI}','bayi@t') on conflict do nothing`);
sql(`insert into profiles(id,username,name,role_id) select '${ADMIN}','yonetici','Yönetici',id from roles where name='admin' on conflict do nothing`);
sql(`insert into profiles(id,username,name,role_id) select '${BAYI}','kadikoy','Kadıköy Bayi',id from roles where name='Consumer' on conflict do nothing`);
const adminSession = { id: ADMIN, isAdmin: true, permissions: ["*"], username: "yonetici" };
const bayiSession = { id: BAYI, isAdmin: false, permissions: ["sms.send"], username: "kadikoy" };
const ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0";
const req = (url: string, cookie = "", body?: unknown) => new Request(`http://localhost${url}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "content-type": "application/json", cookie, "user-agent": ua, "x-forwarded-for": "85.105.1.2" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const json = async (r: Response) => (await r.json()) as { success: boolean; data: any };

console.log("\n1) Admin panelinin zil yoklaması başlangıç noktası alır");
setTestSession(adminSession);
const base = await json(await activityGET(req("/api/panel/admin/activity?since=")));
const since = base.data.latest || base.data.serverTime;
check("başlangıçta zil olayı yok", base.data.events.length === 0);
await new Promise((r) => setTimeout(r, 20));

console.log("\n2) Bayi giriş yapar");
setTestSession(null); setTestLoginUser(BAYI);
const lr = await loginPOST(req("/api/auth/login", "", { username: "kadikoy", password: "x" }));
const setCookie = lr.headers.get("set-cookie") || "";
const sid = setCookie.match(/wsid=([0-9a-f-]{36})/)?.[1] ?? "";
check("giriş başarılı ve oturum çerezi (httpOnly) verildi", lr.status === 200 && !!sid && /HttpOnly/i.test(setCookie));
check("oturum 'login' olarak kaydedildi (IP + cihaz)", sql(`select start_reason||'|'||ip||'|'||(user_agent like '%Chrome%') from user_sessions where id='${sid}'`) === "login|85.105.1.2|true");

console.log("\n3) Admin zili: yeni giriş olayı gelir");
setTestSession(adminSession);
const z = await json(await activityGET(req(`/api/panel/admin/activity?since=${encodeURIComponent(since)}`)));
check("zil olayı: 'kadikoy giriş yaptı'", z.data.events.length === 1 && z.data.events[0].username === "kadikoy" && z.data.events[0].reason === "login",
  JSON.stringify(z.data.events.map((e: any) => `${e.username}:${e.reason}`)));
const z2 = await json(await activityGET(req(`/api/panel/admin/activity?since=${encodeURIComponent(z.data.latest)}`)));
check("aynı giriş için zil ikinci kez çalmaz", z2.data.events.length === 0);

console.log("\n4) Panel açıkken sinyal: aynı oturum sürer");
setTestSession(bayiSession);
const p1 = await json(await presencePOST(req("/api/panel/presence", `wsid=${sid}`, {})));
check("sinyal yeni oturum açmadı", p1.data.started === false && sql(`select count(*) from user_sessions where user_id='${BAYI}'`) === "1");
setTestSession(adminSession);
let full = await json(await activityGET(req("/api/panel/admin/activity")));
let u = full.data.users.find((x: any) => x.username === "kadikoy");
check("admin listesinde 'Çevrimiçi', aktif olduğu an = giriş anı", u.online === true && !!u.activeSince && u.lastInactiveAt === null);
check("özet: bayi çevrimiçi sayısında ve bugünkü girişlerde", full.data.summary.online >= 1 && full.data.summary.todayLogins >= 1 && u.todaySessions === 1, JSON.stringify(full.data.summary));

console.log("\n5) Sinyal kesilir (sekme kapandı) → pasif");
// gerçekçi: oturum 15 dk önce açılmış, son sinyal 5 dk önce
sql(`update user_sessions set started_at = now() - interval '15 minutes', last_seen_at = now() - interval '5 minutes' where id='${sid}'`);
const lastSeen = sql(`select last_seen_at from user_sessions where id='${sid}'`);
full = await json(await activityGET(req("/api/panel/admin/activity")));
u = full.data.users.find((x: any) => x.username === "kadikoy");
check("admin listesinde 'Pasif', pasif olduğu an = son sinyal", u.online === false && u.lastEndReason === "timeout" && Date.parse(u.lastInactiveAt) === Date.parse(lastSeen.replace(" ", "T").replace(/\+(\d\d)$/, "+$1:00")),
  `${u.lastInactiveAt} / ${lastSeen}`);
check("olay akışında 'Pasif oldu' var", full.data.events.some((e: any) => e.username === "kadikoy" && e.type === "timeout"));

console.log("\n6) Bayi geri döner → yeni oturum ('yeniden aktif') + zil");
setTestSession(bayiSession);
const pr = await presencePOST(req("/api/panel/presence", `wsid=${sid}`, {}));
const p2 = await json(pr);
const sid2 = (pr.headers.get("set-cookie") || "").match(/wsid=([0-9a-f-]{36})/)?.[1] ?? "";
check("yeni oturum açıldı ve çerez yenilendi", p2.data.started === true && !!sid2 && sid2 !== sid);
setTestSession(adminSession);
const z3 = await json(await activityGET(req(`/api/panel/admin/activity?since=${encodeURIComponent(z.data.latest)}`)));
check("zil olayı: 'kadikoy yeniden aktif'", z3.data.events.length === 1 && z3.data.events[0].reason === "resume");

console.log("\n7) Bayi çıkış yapar");
setTestSession(bayiSession);
const lo = await logoutPOST(req("/api/auth/logout", `wsid=${sid2}`, {}));
check("çıkış başarılı, çerez silindi", lo.status === 200 && /wsid=;.*Max-Age=0/.test(lo.headers.get("set-cookie") || ""));
setTestSession(adminSession);
full = await json(await activityGET(req("/api/panel/admin/activity")));
u = full.data.users.find((x: any) => x.username === "kadikoy");
check("admin listesinde 'Pasif — çıkış yaptı'", u.online === false && u.lastEndReason === "logout");
check("olay sırası: giriş → pasif → yeniden aktif → çıkış",
  full.data.events.filter((e: any) => e.username === "kadikoy").map((e: any) => e.type).reverse().join(",") === "login,timeout,resume,logout",
  full.data.events.filter((e: any) => e.username === "kadikoy").map((e: any) => e.type).reverse().join(","));
check("bugünkü aktif süre hesaplandı", u.todayActiveSeconds > 0 && u.todaySessions === 2, `${u.todayActiveSeconds} sn, ${u.todaySessions} oturum`);

console.log("\n8) Adminin kendi girişi zil çaldırmaz; bayi aktivite API'sini göremez");
setTestSession(null); setTestLoginUser(ADMIN);
await loginPOST(req("/api/auth/login", "", { username: "yonetici", password: "x" }));
setTestSession(adminSession);
const z4 = await json(await activityGET(req(`/api/panel/admin/activity?since=${encodeURIComponent(z3.data.latest)}`)));
check("adminin kendi girişi zil listesinde yok", z4.data.events.length === 0);
setTestSession(bayiSession);
check("bayi /admin/activity → 403", (await activityGET(req("/api/panel/admin/activity"))).status === 403);

console.log(`\n${failures === 0 ? "TÜM AKTİVİTE TESTLERİ GEÇTİ" : failures + " TEST BAŞARISIZ"}`);
process.exitCode = failures ? 1 : 0;
