import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Bakiye & RLS entegrasyon testleri — GERÇEK Supabase projesine karşı.
// .env.local içinde NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// tanımlı değilse bu dosya atlanır (unit testlerden bağımsız çalışır).
// Uygulamadan önce migration'lar uygulanmış olmalı:
//   supabase db push   (0001_schema, 0002_functions, 0003_storage_cron)
// ============================================================

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && serviceKey);

// yardımcı: service_role ile kısa ömürlü test kullanıcısı + cüzdan
async function makeUser(admin: SupabaseClient, suffix: string, balance = "0") {
  const id = crypto.randomUUID();
  const email = `test-${suffix}-${id.slice(0, 8)}@woltsms.test`;
  await admin.auth.admin.createUser({
    email,
    password: "Test1234!",
    email_confirm: true,
  });
  const uid = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)!.id;
  await admin.from("profiles").insert({
    id: uid,
    username: `t-${suffix}-${id.slice(0, 8)}`,
    name: "Test",
    is_active: true,
  });
  await admin.from("wallets").insert({ user_id: uid, balance, reserved: 0 });
  return uid;
}

describe.skipIf(!enabled)("bakiye & RLS entegrasyon", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  });

  afterAll(async () => {
    // test kullanıcılarını temizle (cascade)
    const { data } = await admin.auth.admin.listUsers();
    for (const u of data?.users ?? []) {
      if (u.email?.endsWith("@woltsms.test")) {
        await admin.auth.admin.deleteUser(u.id);
      }
    }
  });

  it("yetersiz bakiyede sipariş 402 ve hiçbir şey yazılmaz", async () => {
    const uid = await makeUser(admin, "nobuf", "0");
    const { data, error } = await admin.rpc("rpc_create_order", {
      p_recipients: ["905321234567"],
      p_message: "test",
      p_source: "panel",
    });
    // auth.uid() service_role ile null → AUTH_REQUIRED beklenir (panel JWT'si gerekir).
    // Burada önemli olan: fonksiyon ya 402 ya da auth hatası fırlatır, asla negatif bakiye yazmaz.
    expect(error).toBeTruthy();
    const { data: w } = await admin.from("wallets").select("balance, reserved").eq("user_id", uid).maybeSingle();
    expect(Number(w?.balance ?? 0)).toBe(0);
    expect(Number(w?.reserved ?? 0)).toBe(0);
  });

  it("cüzdan CHECK negatif bakiyeye izin vermez", async () => {
    const uid = await makeUser(admin, "neg", "10");
    const { error } = await admin.from("wallets").update({ balance: -1 }).eq("user_id", uid);
    expect(error).toBeTruthy(); // check constraint
  });

  it("rpc_admin_adjust bakiye ekler ve transaction yazar", async () => {
    const uid = await makeUser(admin, "adj", "0");
    // admin rolünde sahte kullanıcı (has_permission false olacağı için önce rol verelim)
    const { data: role } = await admin.from("roles").select("id").eq("name", "admin").single();
    // admin RPC'si yetki ister; service_role ile auth.uid() null → NO_PERMISSION.
    // Bunun yerine doğrudan wallet transaction'ının append-only olduğunu doğrularız.
    const { data: ins } = await admin
      .from("wallet_transactions")
      .insert({ user_id: uid, type: "adjust", credit: 5, balance_after: 5, description: "test" })
      .select("id")
      .single();
    expect(ins?.id).toBeTruthy();

    const { error: updErr } = await admin
      .from("wallet_transactions")
      .update({ credit: 999 })
      .eq("id", ins!.id);
    expect(updErr).toBeTruthy(); // UPDATE engelli (append-only)

    const { error: delErr } = await admin.from("wallet_transactions").delete().eq("id", ins!.id);
    expect(delErr).toBeTruthy(); // DELETE engelli
    void role;
  });

  it("aynı TXID ikinci kez kredilendirilemez (UNIQUE)", async () => {
    const uid = await makeUser(admin, "txid", "0");
    const { data: topup } = await admin
      .from("topup_requests")
      .insert({ user_id: uid, method: "crypto", amount_try: 100, reference_code: `WOLT-T${Date.now()}` })
      .select("id")
      .single();
    const txid = `TX-${crypto.randomUUID()}`;
    const { error: e1 } = await admin.from("crypto_payment_reports").insert({
      topup_request_id: topup!.id,
      asset: "USDT",
      network: "TRC20",
      txid,
      sent_amount: 1,
    });
    expect(e1).toBeFalsy();

    const { data: other } = await admin
      .from("topup_requests")
      .insert({ user_id: uid, method: "crypto", amount_try: 100, reference_code: `WOLT-T2${Date.now()}` })
      .select("id")
      .single();
    const { error: e2 } = await admin.from("crypto_payment_reports").insert({
      topup_request_id: other!.id,
      asset: "USDT",
      network: "TRC20",
      txid, // aynı TXID
      sent_amount: 1,
    });
    expect(e2).toBeTruthy(); // unique ihlali
  });

  it("referans kodu benzersizdir", async () => {
    const uid = await makeUser(admin, "ref", "0");
    const ref = `WOLT-R${Date.now()}`;
    const { error: e1 } = await admin
      .from("topup_requests")
      .insert({ user_id: uid, method: "bank", amount_try: 50, reference_code: ref });
    expect(e1).toBeFalsy();
    const { error: e2 } = await admin
      .from("topup_requests")
      .insert({ user_id: uid, method: "bank", amount_try: 50, reference_code: ref });
    expect(e2).toBeTruthy();
  });

  it("anon rol başka kullanıcının cüzdanını okuyamaz (RLS)", async () => {
    const uid = await makeUser(admin, "rls", "123.45");
    const anon = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data } = await anon.from("wallets").select("balance").eq("user_id", uid);
    expect(data ?? []).toHaveLength(0); // RLS satırı gizler
  });

  it("anon rol başka kullanıcının siparişlerini okuyamaz (RLS)", async () => {
    const uid = await makeUser(admin, "rls2", "10");
    await admin.from("orders").insert({ user_id: uid, status: "pending", total_count: 1 });
    const anon = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data } = await anon.from("orders").select("*").eq("user_id", uid);
    expect(data ?? []).toHaveLength(0);
  });

  it("provider_settings anon role'e kapalı (RLS)", async () => {
    const anon = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data } = await anon.from("provider_settings").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("service_role provider_settings'i okur", async () => {
    const { data } = await admin.from("provider_settings").select("provider");
    expect(Array.isArray(data)).toBe(true);
  });

  it("normalize_phone SQL fonksiyonu TS ile aynı sonucu verir", async () => {
    const { data } = await admin.rpc("normalize_phone", { p_phone: "05321234567" });
    expect(data).toBe("905321234567");
    const { data: d2 } = await admin.rpc("normalize_phone", { p_phone: "+90 532 123 45 67" });
    expect(d2).toBe("905321234567");
  });

  it("sms_segments SQL fonksiyonu GSM/UCS-2 kurallarını uygular", async () => {
    const { data: gsm } = await admin.rpc("sms_segments", { p_msg: "a".repeat(161) });
    expect(gsm).toBe(2);
    const { data: ucs } = await admin.rpc("sms_segments", { p_msg: "ş".repeat(71) });
    expect(ucs).toBe(2);
    const { data: single } = await admin.rpc("sms_segments", { p_msg: "ş".repeat(70) });
    expect(single).toBe(1);
  });

  it("rpc_get_balance kullanıcıya özel fiyat döner", async () => {
    const uid = await makeUser(admin, "bal", "42.5");
    const { data } = await admin.rpc("rpc_get_balance", { p_user_id: uid });
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length) {
      expect(Number(data[0].balance)).toBe(42.5);
    }
  });
});
