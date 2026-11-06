// Uçtan uca: GERÇEK kullanıcı düzenleme / şifre / üyelik silme / Hesabım uç noktaları + gerçek migration'lı Postgres
import { sql } from "./fake-supabase.ts";
import { setTestSession } from "./auth-shim.ts";
import { PATCH as usersPATCH, DELETE as usersDELETE } from "@/app/api/panel/users/route";
import { GET as accountGET, PATCH as accountPATCH } from "@/app/api/panel/account/route";
import { POST as passwordPOST } from "@/app/api/panel/account/password/route";

let failures = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${info ? " — " + info : ""}`); if (!ok) failures++; };
const req = (method: string, url: string, body?: unknown) => new Request(`http://localhost${url}`, {
  method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
const call = async (p: Promise<Response> | Response) => { const r = await p; const j = (await r.json()) as { success: boolean; message: string; data: any }; return { status: r.status, ...j }; };
const pwOk = (id: string, pw: string) => sql(`select (encrypted_password = extensions.crypt('${pw.replace(/'/g, "''")}', encrypted_password))::text from auth.users where id='${id}'`) === "true";

const A = "a1a1a1a1-0000-0000-0000-000000000001", B = "b2b2b2b2-0000-0000-0000-000000000002", C = "c3c3c3c3-0000-0000-0000-000000000003";
sql(`insert into auth.users(id,email,encrypted_password) values
  ('${A}','u_admin@woltsms.local', extensions.crypt('Admin!234', extensions.gen_salt('bf'))),
  ('${B}','u_bayi@firma.com', extensions.crypt('Eski!Sifre1', extensions.gen_salt('bf'))),
  ('${C}','u_diger@firma.com', extensions.crypt('Diger!123', extensions.gen_salt('bf'))) on conflict do nothing`);
sql(`insert into profiles(id,username,name,role_id) select '${A}','u_yonetici','Yönetici',id from roles where name='admin' on conflict do nothing`);
sql(`insert into profiles(id,username,name,role_id,phone) select '${B}','u_bayi_b','Bayi B',id,'5321234567' from roles where name='Consumer' on conflict do nothing`);
sql(`insert into profiles(id,username,name,role_id) select '${C}','u_bayi_c','Bayi C',id from roles where name='Consumer' on conflict do nothing`);
sql(`insert into wallets(user_id,balance,reserved) values ('${B}',25,0) on conflict (user_id) do update set balance=25`);
sql(`insert into wallet_transactions(user_id,type,credit,total_price,balance_after,description) values ('${B}','topup',25,25,25,'test yükleme')`);
const adminS = { id: A, isAdmin: true, permissions: ["*"], username: "u_yonetici" };
const bayiS = { id: B, isAdmin: false, permissions: ["sms.send"], username: "u_bayi_b" };

console.log("\n1) Admin: kullanıcı bilgileri düzenleme (onarılan bölüm)");
setTestSession(adminS);
let r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, name: "Bayi B Yeni", phone: "", email: "", unitPrice: "", quotaType: "variable", roleId: "", password: "" })));
check("boş alanlarla kaydet: hata yok, birim fiyat 0 YAZILMADI", r.success && sql(`select count(*) from pricing where user_id='${B}'`) === "0", r.message);
check("isim güncellendi, telefon temizlendi", sql(`select name||'|'||coalesce(phone,'NULL') from profiles where id='${B}'`) === "Bayi B Yeni|NULL");
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, unitPrice: "0,42" })));
check("virgüllü birim fiyat (0,42) kabul edildi", r.success && sql(`select unit_price::text from pricing where user_id='${B}'`) === "0.420000", r.message);
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, unitPrice: "0" })));
check("0 fiyat reddedildi, anlaşılır mesaj", !r.success && /0'dan büyük/.test(r.message), r.message);
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, email: "u_diger@firma.com" })));
check("başkasının e-postası reddedildi", !r.success && /başka bir kullanıcıda/.test(r.message), r.message);
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, email: "U_Yeni@Firma.com" })));
check("e-posta değişti (küçük harfe çevrildi)", r.success && sql(`select email from auth.users where id='${B}'`) === "u_yeni@firma.com", r.message);

console.log("\n2) Admin: şifre sıfırlama (önceden formda vardı ama kaydedilmiyordu)");
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, password: "zayif" })));
check("zayıf şifre reddedildi", !r.success && /8 karakter/.test(r.message), r.message);
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, password: "Admin!Yeni9" })));
check("şifre sıfırlandı ve yeni şifreyle giriş doğrulanıyor", r.success && pwOk(B, "Admin!Yeni9") && !pwOk(B, "Eski!Sifre1"), r.message);
check("denetim kaydı: user.password_reset", sql(`select count(*) from audit_logs where action='user.password_reset'`) === "1");

console.log("\n3) Admin: hesap askıya alma");
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, isActive: false })));
check("askıya alındı, girişe kapalı", r.success && sql(`select (resolve_username_email('u_bayi_b') is null)::text`) === "true", r.message);
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: A, isActive: false })));
check("admin kendini askıya alamaz", !r.success && /Kendi hesabınızı/.test(r.message), r.message);
r = await call(usersPATCH(req("PATCH", "/api/panel/users", { id: B, isActive: true })));
check("yeniden aktifleştirildi", r.success && sql(`select is_active::text from profiles where id='${B}'`) === "true");

console.log("\n4) Kullanıcı: Hesabım ve şifre değiştirme");
setTestSession(bayiS);
r = await call(accountGET());
check("Hesabım bilgileri geliyor", r.success && r.data.username === "u_bayi_b" && r.data.email === "u_yeni@firma.com", JSON.stringify(r.data));
r = await call(accountPATCH(req("PATCH", "/api/panel/account", { name: "Bayi B (Kadıköy)", phone: "05321112233" })));
check("kendi bilgilerini güncelledi", r.success && sql(`select name||'|'||phone from profiles where id='${B}'`) === "Bayi B (Kadıköy)|05321112233", r.message);
r = await call(passwordPOST(req("POST", "/api/panel/account/password", { currentPassword: "yanlis", newPassword: "Bayi!Yeni22", confirmPassword: "Bayi!Yeni22" })));
check("yanlış mevcut şifre reddedildi", !r.success && /Mevcut şifre hatalı/.test(r.message) && pwOk(B, "Admin!Yeni9"), r.message);
r = await call(passwordPOST(req("POST", "/api/panel/account/password", { currentPassword: "Admin!Yeni9", newPassword: "Bayi!Yeni22", confirmPassword: "Bayi!Yeni23" })));
check("eşleşmeyen yeni şifreler reddedildi", !r.success && /eşleşmiyor/.test(r.message), r.message);
r = await call(passwordPOST(req("POST", "/api/panel/account/password", { currentPassword: "Admin!Yeni9", newPassword: "kisa", confirmPassword: "kisa" })));
check("politikaya uymayan şifre reddedildi", !r.success && /8 karakter/.test(r.message), r.message);
r = await call(passwordPOST(req("POST", "/api/panel/account/password", { currentPassword: "Admin!Yeni9", newPassword: "Bayi!Yeni22", confirmPassword: "Bayi!Yeni22", signOutOthers: true })));
check("şifre değişti; yeni şifre geçerli, eskisi geçersiz", r.success && pwOk(B, "Bayi!Yeni22") && !pwOk(B, "Admin!Yeni9"), r.message);
check("şifre değişiklik zamanı kaydedildi", !!(await call(accountGET())).data.passwordChangedAt);
for (let i = 0; i < 5; i++) await passwordPOST(req("POST", "/api/panel/account/password", { currentPassword: "yanlis" + i, newPassword: "Bayi!Yeni33", confirmPassword: "Bayi!Yeni33" }));
r = await call(passwordPOST(req("POST", "/api/panel/account/password", { currentPassword: "Bayi!Yeni22", newPassword: "Bayi!Yeni33", confirmPassword: "Bayi!Yeni33" })));
check("çok sayıda denemeden sonra geçici kilit (kaba kuvvet koruması)", r.status === 429, r.message);

console.log("\n5) Admin: üyelik silme");
setTestSession(adminS);
r = await call(usersDELETE(req("DELETE", `/api/panel/users?id=${B}&preview=1`)));
check("silme önizlemesi: bakiye ve işlem sayısı", r.success && Number(r.data.balance) === 25 && r.data.transactions === 1, JSON.stringify(r.data));
r = await call(usersDELETE(req("DELETE", `/api/panel/users?id=${A}`)));
check("admin kendini silemez", !r.success && /Kendi üyeliğinizi/.test(r.message), r.message);
r = await call(usersDELETE(req("DELETE", `/api/panel/users?id=${B}`)));
check("işlem geçmişi olan üyelik silindi (önceden bu hata veriyordu)", r.success && sql(`select count(*) from profiles where id='${B}'`) === "0" && sql(`select count(*) from auth.users where id='${B}'`) === "0", r.message);
check("kullanıcının bakiye hareketleri de silindi, başka kayıtlar duruyor", sql(`select count(*) from wallet_transactions where user_id='${B}'`) === "0" && sql(`select count(*) from profiles where id='${C}'`) === "1");
check("silinen üyeliğin özeti denetim kaydında", sql(`select payload->>'username' from audit_logs where action='user.delete' order by created_at desc limit 1`) === "u_bayi_b");
setTestSession({ id: C, isAdmin: false, permissions: ["sms.send"], username: "u_bayi_c" });
r = await call(usersDELETE(req("DELETE", `/api/panel/users?id=${A}`)));
check("yetkisiz kullanıcı silemez", r.status === 403, String(r.status));

console.log(`\n${failures === 0 ? "TÜM KULLANICI YÖNETİMİ TESTLERİ GEÇTİ" : failures + " TEST BAŞARISIZ"}`);
process.exitCode = failures ? 1 : 0;
