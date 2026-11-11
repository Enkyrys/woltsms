// Uçtan uca (0021): panel 5 dk gecikmesi, API kapalıyken otomatik onay, toplu "Gönder", API Aç/Kapat.
// GERÇEK route handler'lar + GERÇEK runWorker + gerçek migration'lı Postgres (sağlayıcı: mock).
import { sql } from "./fake-supabase.ts";
import { setTestSession } from "./auth-shim.ts";
import { POST as ordersPOST } from "@/app/api/panel/orders/route";
import { POST as deliverPOST } from "@/app/api/panel/admin/orders/deliver/route";
import { GET as switchGET, POST as switchPOST } from "@/app/api/panel/admin/provider-switch/route";
import { runWorker } from "@/lib/services";

let failures = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${info ? " — " + info : ""}`); if (!ok) failures++; };
const req = (method: string, url: string, body?: unknown) => new Request(`http://localhost${url}`, {
  method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (p: Promise<Response> | Response) => { const r = await p; const j = (await r.json()) as { success: boolean; message: string; data: any }; return { status: r.status, ...j }; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const A = "e5e5e5e5-0000-0000-0000-000000000001"; // admin
const B = "e5e5e5e5-0000-0000-0000-000000000002"; // bayi
sql(`insert into auth.users(id,email) values ('${A}','d_admin@test'),('${B}','d_bayi@test') on conflict do nothing`);
sql(`insert into profiles(id,username,name,role_id) select '${A}','d_admin','Gecikme Admin',id from roles where name='admin' on conflict do nothing`);
sql(`insert into profiles(id,username,name,role_id) select '${B}','d_bayi','Gecikme Bayi',id from roles where name='Consumer' on conflict do nothing`);
sql(`insert into wallets(user_id,balance,reserved) values ('${B}',100,0) on conflict (user_id) do update set balance=100, reserved=0`);
sql(`update system_settings set value='5' where key in ('panel_send_delay_minutes','auto_approve_minutes')`);
sql(`update provider_settings set is_active=false`);
sql(`insert into provider_settings(provider, base_url, sender_id, is_active) values ('mock','', 'WOLTSMS', true)
     on conflict (provider) do update set is_active=true`);
// diğer testlerden kalan bekleyen kampanyalar bu testi etkilemesin
sql(`update orders set status='cancelled' where status in ('pending','scheduled','processing')`);

const adminS = { id: A, isAdmin: true, permissions: ["*"], username: "d_admin" };
const bayiS = { id: B, isAdmin: false, permissions: ["sms.send"], username: "d_bayi" };
let seq = 0;
const newOrder = async (numbers: string, message: string) => {
  setTestSession(bayiS);
  const r = await ordersPOST(new Request("http://localhost/api/panel/orders", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": `d-${Date.now()}-${++seq}` },
    body: JSON.stringify({ mode: "send", numbers, message }),
  }));
  const j = (await r.json()) as { success: boolean; message: string; data: { orderId: string; sendDelayMinutes: number; status: string } };
  await wait(150); // after(sendOrderNow) bitsin
  return j;
};
const status = (id: string) => sql(`select status from orders where id='${id}'`);
const backdate = (id: string, min: number) => {
  sql(`update orders set created_at = created_at - interval '${min} minutes', scheduled_at = scheduled_at - interval '${min} minutes' where id='${id}'`);
  sql(`update sms_messages set next_attempt_at = next_attempt_at - interval '${min} minutes' where order_id='${id}'`);
};

console.log("\n1) API AÇIK: işletme panelinden yeni SMS → 5 dakika sonra gider");
const o1 = await newOrder("905341000001, 905341000002", "Gecikme e2e 1");
check("kampanya oluşturuldu, '5 dakika sonra gönderilecek' mesajı", o1.success && /5 dakika sonra/.test(o1.message), o1.message);
check("durum 'Gönderim Bekliyor' (pending)", status(o1.data.orderId) === "pending");
let w = await runWorker();
check("worker 5 dk dolmadan göndermedi", sql(`select count(*) from sms_messages where order_id='${o1.data.orderId}' and status='queued'`) === "2", JSON.stringify(w.batch));
check("API açıkken otomatik onay yok", w.autoApproved.orders === 0);
backdate(o1.data.orderId, 5);
w = await runWorker();
check("5 dk sonra worker sağlayıcıya gönderdi", sql(`select count(*) from sms_messages where order_id='${o1.data.orderId}' and status='sent'`) === "2", JSON.stringify(w.batch));
check("kampanya Gönderildi (completed)", status(o1.data.orderId) === "completed");

console.log("\n2) API KAPAT butonu");
setTestSession(bayiS);
let r = await call(switchPOST(req("POST", "/api/panel/admin/provider-switch", { on: false })));
check("bayi API'yi kapatamaz (403)", r.status === 403);
setTestSession(adminS);
r = await call(switchPOST(req("POST", "/api/panel/admin/provider-switch", { on: false })));
check("admin API'yi kapattı", r.success && r.data.active === false, r.message);
check("aktif sağlayıcı kalmadı", sql(`select count(*) from provider_settings where is_active`) === "0");
check("kapatılan sağlayıcı hatırlandı", sql(`select value from system_settings where key='last_active_provider'`) === "mock");

console.log("\n3) API KAPALI: bekleyenler 5 dk dolunca otomatik Gönderildi");
const o2 = await newOrder("905342000001", "Kapali e2e 2");
const o3 = await newOrder("905343000001, 905343000002", "Kapali e2e 3");
const o4 = await newOrder("905344000001", "Kapali e2e 4");
const o5 = await newOrder("905345000001", "Kapali e2e 5");
w = await runWorker();
check("5 dk dolmadan otomatik onay yok", w.autoApproved.orders === 0 && status(o2.data.orderId) === "pending", JSON.stringify(w.autoApproved));
backdate(o2.data.orderId, 5);
w = await runWorker();
check("5 dk dolan kampanya otomatik onaylandı", w.autoApproved.orders === 1 && status(o2.data.orderId) === "completed", JSON.stringify(w.autoApproved));
check("mesaj 'İletildi' (delivered), not düşüldü",
  sql(`select status from sms_messages where order_id='${o2.data.orderId}'`) === "delivered" &&
  /Otomatik onaylandı/.test(sql(`select note from orders where id='${o2.data.orderId}'`)));
check("diğerleri hâlâ bekliyor", [o3, o4, o5].every((o) => status(o.data.orderId) === "pending"));

console.log("\n4) Admin listesi: işaretle → Gönder (seçilenler)");
setTestSession(bayiS);
r = await call(deliverPOST(req("POST", "/api/panel/admin/orders/deliver", { orderIds: [o3.data.orderId] })));
check("bayi toplu onay yapamaz (403)", r.status === 403);
setTestSession(adminS);
r = await call(deliverPOST(req("POST", "/api/panel/admin/orders/deliver", { orderIds: [o3.data.orderId, o2.data.orderId] })));
check("seçilen bekleyen kampanya Gönderildi, bitmiş olan atlandı",
  r.success && r.data.orders === 1 && r.data.skipped === 1 && r.data.messages === 2 && status(o3.data.orderId) === "completed", r.message);
r = await call(deliverPOST(req("POST", "/api/panel/admin/orders/deliver", {})));
check("seçim yoksa anlaşılır hata", !r.success && r.status === 400, r.message);

console.log("\n5) Admin listesi: Hepsi → Gönder");
r = await call(deliverPOST(req("POST", "/api/panel/admin/orders/deliver", { all: true, status: "", q: "" })));
check("tüm bekleyenler Gönderildi", r.success && r.data.orders === 2 && status(o4.data.orderId) === "completed" && status(o5.data.orderId) === "completed", r.message);
r = await call(deliverPOST(req("POST", "/api/panel/admin/orders/deliver", { all: true, status: "completed" })));
check("bekleyen dışı filtrede hiçbir şey değişmez", r.success && r.data.orders === 0, r.message);

console.log("\n6) Tek kampanya 'Gönder' (eski buton) davranışı korunur");
const o6 = await newOrder("905346000001", "Tekli e2e 6");
setTestSession(adminS);
r = await call(deliverPOST(req("POST", "/api/panel/admin/orders/deliver", { orderId: o6.data.orderId })));
check("tek kampanya Gönderildi", r.success && status(o6.data.orderId) === "completed", r.message);
r = await call(deliverPOST(req("POST", "/api/panel/admin/orders/deliver", { orderId: o6.data.orderId })));
check("ikinci kez → 409", !r.success && r.status === 409, r.message);

console.log("\n7) API AÇ butonu");
r = await call(switchPOST(req("POST", "/api/panel/admin/provider-switch", { on: true })));
check("admin API'yi açtı, önceki sağlayıcı geri geldi", r.success && r.data.active === true && r.data.provider === "mock", r.message);
r = await call(switchGET());
check("durum: açık, gecikme 5 dk, otomatik onay 5 dk", r.success && r.data.active && r.data.sendDelayMinutes === 5 && r.data.autoApproveMinutes === 5, JSON.stringify(r.data));
r = await call(switchPOST(req("POST", "/api/panel/admin/provider-switch", { on: true })));
check("zaten açıkken tekrar açmak zararsız", r.success && sql(`select count(*) from provider_settings where is_active`) === "1", r.message);
check("denetim kaydı: api_off + api_on", sql(`select count(*) from audit_logs where action in ('provider.api_off','provider.api_on')`) === "2");

console.log(failures ? `\n✗ ${failures} kontrol başarısız` : "\n✓ tüm kontroller geçti");
process.exit(failures ? 1 : 0);
