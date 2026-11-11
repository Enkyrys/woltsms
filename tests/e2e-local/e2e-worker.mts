// Uçtan uca: GERÇEK processSendBatch + GERÇEK migration'lı Postgres + sahte ENKYRYS API (fetch)
import { sql } from "./fake-supabase.ts";
import { encrypt } from "@/lib/security";
import { processSendBatch } from "@/lib/services";

let failures = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${info ? " — " + info : ""}`); if (!ok) failures++; };
const q1 = (s: string) => sql(s);

// ---- sahte ENKYRYS API ----
type Pkg = { number: string[]; text: string; beginDate?: string; beginTime?: string };
const calls: { n: string; pkg: Pkg; at: number }[] = [];
let n2Fails = 1; let idState = 1000;
globalThis.fetch = (async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "[]")) as Pkg[];
  const data: Record<string, unknown> = {};
  for (const p of body) {
    const n = p.number[0];
    calls.push({ n, pkg: p, at: Date.now() });
    await new Promise((r) => setTimeout(r, 30)); // gerçekçi gecikme (eşzamanlı worker yarışını açığa çıkarmak için)
    if (n === "905320000002" && n2Fails-- > 0) {
      return new Response(JSON.stringify({ status: false, error_code: 500, errors: "internal error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    data[n] = n === "905320000003" ? [{ error: "incorrect_phone" }] : [{ id_state: ++idState }];
  }
  return new Response(JSON.stringify({ status: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

// ---- kurulum: bayi, bakiye, aktif sağlayıcı ----
const U = "22222222-2222-2222-2222-222222222222";
q1(`insert into auth.users(id,email) values ('${U}','e2e@test') on conflict do nothing`);
q1(`insert into public.profiles(id, username, name, role_id) select '${U}','e2ebayi','E2E Bayi', id from roles where name='Consumer' on conflict do nothing`);
q1(`insert into public.wallets(user_id,balance,reserved) values ('${U}',100,0) on conflict (user_id) do update set balance=100, reserved=0`);
// bu test "hemen gönder" yolunu sınar; panel gecikmesi (0021) delay-approve-scenarios.sql'de test edilir
q1(`update system_settings set value='0' where key='panel_send_delay_minutes'`);
q1(`update provider_settings set is_active=false`);
q1(`insert into provider_settings(provider, base_url, sender_id, credentials_encrypted, is_active) values ('gatum','https://enkyrys.test/v1','WOLTSMS', '${encrypt(JSON.stringify({ accessToken: "test-token" }))}', true)
    on conflict (provider) do update set base_url=excluded.base_url, credentials_encrypted=excluded.credentials_encrypted, is_active=true`);
const asUser = `select set_config('request.jwt.claim.sub','${U}',false), set_config('request.jwt.claims','{"role":"authenticated","sub":"${U}"}',false);`;
const createOrder = (nums: string[], msg: string, at: string | null, key: string) =>
  JSON.parse(q1(`${asUser} select (rpc_create_order('${JSON.stringify(nums)}'::jsonb, '${msg}', ${at ? `'${at}'` : "null"}, 'panel', '${key}'))::text`).split("\n").pop()!);

console.log("\n1) HEMEN GÖNDER + API hatası + kalıcı hata");
const A = createOrder(["905320000001", "905320000002", "905320000003"], "E2E hemen", null, "e2e-A").order_id;
const SCHED_AT = new Date(Date.now() + 40_000);
const B = createOrder(["905320000004"], "E2E zamanli", SCHED_AT.toISOString(), "e2e-B").order_id;
check("ileri tarihli kampanya 'scheduled'", q1(`select status from orders where id='${B}'`) === "scheduled");

// 5) TEKRAR KORUMASI: iki worker aynı anda
const [r1, r2] = await Promise.all([processSendBatch(250), processSendBatch(250)]);
console.log(`   worker1=${JSON.stringify(r1)} worker2=${JSON.stringify(r2)}`);
const perNumber = (n: string) => calls.filter((c) => c.n === n).length;
check("eşzamanlı iki worker: her numara API'ye 1 kez gitti", perNumber("905320000001") === 1 && perNumber("905320000002") === 1 && perNumber("905320000003") === 1,
  `çağrılar: ${["1", "2", "3"].map((x) => perNumber("90532000000" + x)).join("/")}`);
check("zamanı gelmeyen kampanya API'ye GİTMEDİ", perNumber("905320000004") === 0);
check("başarılı mesaj 'sent'", q1(`select status from sms_messages where order_id='${A}' and recipient='905320000001'`) === "sent");
check("geçici hata (HTTP 500) → yeniden denemeye alındı", q1(`select status||':'||attempts from sms_messages where order_id='${A}' and recipient='905320000002'`) === "queued:1");
check("kalıcı hata (incorrect_phone) → tekrar denenmedi, başarısız + iade", q1(`select status||':'||attempts from sms_messages where order_id='${A}' and recipient='905320000003'`) === "failed:1");
check("API yanıtı kaydedildi (mesaj)", q1(`select provider_response::text from sms_messages where order_id='${A}' and recipient='905320000003'`).includes("incorrect_phone"));
check("deneme kaydı: 1 başarılı, 1 retry, 1 failed", q1(`select string_agg(outcome, ',' order by outcome) from sms_send_attempts where order_id='${A}'`) === "failed,retry,sent");

console.log("\n4) YENİDEN DENEME: bekleme süresi dolunca tekrar gönderilir");
const r3 = await processSendBatch(250);
check("bekleme dolmadan tekrar gönderilmedi", perNumber("905320000002") === 1, JSON.stringify(r3));
q1(`update sms_messages set next_attempt_at = now() where order_id='${A}' and recipient='905320000002'`);
await processSendBatch(250);
check("ikinci denemede başarılı", q1(`select status||':'||attempts from sms_messages where order_id='${A}' and recipient='905320000002'`) === "sent:2");
check("kampanya durumu 'partial' (Kısmen Gönderildi), 2 başarılı / 1 başarısız",
  q1(`select status||':'||processed_count||':'||failed_count from orders where id='${A}'`) === "partial:2:1");
check("gerçek gönderim başlangıcı ve bitişi yazıldı", q1(`select (provider_triggered_at is not null and dispatch_finished_at is not null)::text from orders where id='${A}'`) === "true");

console.log("\n3) PLANLANAN SAATTE OTOMATİK GÖNDERİM (40 sn bekleniyor)");
const waitMs = SCHED_AT.getTime() - Date.now() + 1500;
const tickEarly = await processSendBatch(250);
check("zamanından önce: gönderilmedi", perNumber("905320000004") === 0, JSON.stringify(tickEarly));
await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));
await processSendBatch(250); // dakikalık zamanlayıcının bir turu
const bCall = calls.find((c) => c.n === "905320000004");
check("zamanı gelince ENKYRYS API'ye gönderildi", !!bCall);
const utc = SCHED_AT.toISOString();
check("API'ye iletilen beginDate/beginTime = planlanan zamanın UTC karşılığı",
  !!bCall && bCall.pkg.beginDate === utc.slice(0, 10) && bCall.pkg.beginTime === utc.slice(11, 16),
  bCall ? `${bCall.pkg.beginDate} ${bCall.pkg.beginTime} (beklenen ${utc.slice(0, 10)} ${utc.slice(11, 16)})` : "");
check("gönderim planlanan saatten önce yapılmadı", !!bCall && bCall.at >= SCHED_AT.getTime());
check("kampanya 'completed' (Gönderildi)", q1(`select status from orders where id='${B}'`) === "completed");

console.log("\nBAKİYE");
const w = q1(`select balance||'/'||reserved from wallets where user_id='${U}'`);
check("bakiye: 100 - 3 başarılı SMS = 97, rezerv 0", w === "97.0000/0.0000", w);

console.log(`\n${failures === 0 ? "TÜM UÇTAN UCA TESTLER GEÇTİ" : failures + " TEST BAŞARISIZ"}`);
process.exitCode = failures ? 1 : 0;
