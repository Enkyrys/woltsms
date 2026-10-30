import { NextResponse } from "next/server";
import { db } from "@/db";
import { roles, rolePermissions, permissions, users, bankAccounts, cryptoAssets, paymentSettings, providerSettings, announcements, systemSettings } from "@/db/schema";
import { hashPassword } from "@/lib/security";
import { eq, sql } from "drizzle-orm";

const ALL_PERMS = [
  ["sms.send", "SMS Gönder", "sms"],
  ["sms.view", "Siparişleri Gör", "sms"],
  ["contacts.manage", "Rehber Yönet", "rehber"],
  ["users.manage", "Kullanıcı Yönet", "kullanici"],
  ["roles.manage", "Rol Yönet", "kullanici"],
  ["blacklist.manage", "Karaliste Yönet", "sms"],
  ["credit.topup", "Kredi Yükle", "odeme"],
  ["credit.approve", "Kredi Onay", "odeme"],
  ["credit.settings", "Ödeme Ayarları", "odeme"],
  ["transactions.view", "İşlem Geçmişi", "odeme"],
  ["shorturl.manage", "Kısa URL Yönet", "arac"],
  ["support.manage", "Destek Yönet", "destek"],
  ["apikey.manage", "API Anahtarı Yönet", "api"],
  ["provider.manage", "Sağlayıcı Yönet", "sistem"],
  ["announcement.manage", "Duyuru Yönet", "sistem"],
  ["audit.view", "Denetim Logu", "sistem"],
] as const;

export async function GET() {
  return POST();
}

export async function POST() {
  try {
    // permissions
    for (const [code, name, group] of ALL_PERMS) {
      await db.insert(permissions).values({ code, name, groupName: group }).onConflictDoNothing();
    }
    // roles
    const ensureRole = async (name: string, readOnly = false) => {
      const ex = await db.select().from(roles).where(eq(roles.name, name));
      if (ex[0]) return ex[0];
      const ins = await db.insert(roles).values({ name, readOnly }).returning();
      return ins[0];
    };
    const adminRole = await ensureRole("admin");
    const consumer = await ensureRole("Consumer", true);
    const consumerAdmin = await ensureRole("Consumer_admin", true);

    const grant = async (roleId: number, codes: string[]) => {
      for (const c of codes) {
        const ex = await db.select().from(rolePermissions).where(sql`role_id=${roleId} AND permission_code=${c}`);
        if (!ex[0]) await db.insert(rolePermissions).values({ roleId, permissionCode: c });
      }
    };
    await grant(adminRole.id, ALL_PERMS.map((p) => p[0]));
    await grant(consumer.id, ["sms.send", "sms.view", "contacts.manage", "blacklist.manage", "credit.topup", "transactions.view", "shorturl.manage", "support.manage", "apikey.manage"]);
    await grant(consumerAdmin.id, ["sms.send", "sms.view", "contacts.manage", "blacklist.manage", "credit.topup", "transactions.view", "shorturl.manage", "support.manage", "apikey.manage", "users.manage"]);

    // admin user
    const adminEx = await db.select().from(users).where(eq(users.username, "admin"));
    if (!adminEx[0]) {
      await db.insert(users).values({
        username: "admin",
        name: "Sistem Yöneticisi",
        email: "admin@woltsms.com",
        phone: "905000000000",
        passwordHash: await hashPassword("Admin123!"),
        roleId: adminRole.id,
        quotaType: "variable",
        quota: "100000",
        unitPrice: "1",
        isActive: true,
      });
    }
    // demo user
    const demoEx = await db.select().from(users).where(eq(users.username, "demo"));
    if (!demoEx[0]) {
      await db.insert(users).values({
        username: "demo",
        name: "Demo Bayi",
        email: "demo@woltsms.com",
        phone: "905000000001",
        passwordHash: await hashPassword("Demo123!"),
        roleId: consumer.id,
        quotaType: "variable",
        quota: "500",
        unitPrice: "1",
        isActive: true,
      });
    }

    // payment settings
    const ps = await db.select().from(paymentSettings);
    if (!ps[0]) {
      await db.insert(paymentSettings).values({
        minTopupTry: "100",
        maxTopupTry: "500000",
        requestTtlMinutes: 1440,
        bankNote: "Açıklama kısmına referans kodunuzu (örn. WOLT-483920) yazmanız zorunludur. Kodsuz ödemeler işleme alınmaz.",
        maxOpenRequests: 3,
      });
    }

    // banks
    const banks = await db.select().from(bankAccounts);
    if (banks.length === 0) {
      await db.insert(bankAccounts).values([
        { bankName: "Örnek Banka", accountHolder: "WOLTSMS Bilişim Ltd. Şti.", iban: "TR00 0000 0000 0000 0000 0000 01", isActive: true, sortOrder: 1 },
        { bankName: "Demo Katılım", accountHolder: "WOLTSMS Bilişim Ltd. Şti.", iban: "TR00 0000 0000 0000 0000 0000 02", isActive: true, sortOrder: 2 },
      ]);
    }

    // crypto
    const cryptos = await db.select().from(cryptoAssets);
    if (cryptos.length === 0) {
      await db.insert(cryptoAssets).values([
        { asset: "USDT", network: "TRC20", walletAddress: "TJDemoTronAddressWoltsms0000000001", rateTry: "34.50", minAmountTry: "100", isActive: true, sortOrder: 1, explorerTxUrlTemplate: "https://tronscan.org/#/transaction/{txid}" },
        { asset: "USDT", network: "BEP20", walletAddress: "0xDemoBnbAddressWoltsms000000000001", rateTry: "34.50", minAmountTry: "100", isActive: true, sortOrder: 2, explorerTxUrlTemplate: "https://bscscan.com/tx/{txid}" },
        { asset: "BTC", network: "Bitcoin", walletAddress: "bc1qdemobtcaddresswoltsms00000001", rateTry: "2900000", minAmountTry: "500", isActive: true, sortOrder: 3, explorerTxUrlTemplate: "https://mempool.space/tx/{txid}" },
        { asset: "TRX", network: "TRC20", walletAddress: "TJDemoTronAddressWoltsms0000000002", rateTry: "4.20", minAmountTry: "100", isActive: false, sortOrder: 4, explorerTxUrlTemplate: "https://tronscan.org/#/transaction/{txid}" },
      ]);
    }

    // provider
    const prov = await db.select().from(providerSettings);
    if (prov.length === 0) {
      await db.insert(providerSettings).values([
        { provider: "mock", isActive: true, balance: "987654.32", lowBalanceThreshold: "1000" },
        { provider: "generic", isActive: false, balance: "0", lowBalanceThreshold: "1000" },
      ]);
    }

    // announcement
    const ann = await db.select().from(announcements);
    if (ann.length === 0) {
      await db.insert(announcements).values({
        text: "Gönderimler 10:00–22:00 saatleri arasında aktiftir. 22:00 sonrası yapılan SMS gönderimleri iptal edilecektir. Bilginize sunar, iyi çalışmalar dileriz.",
        isActive: true,
      });
    }

    // system settings
    const sysDefaults: Record<string, string> = {
      sending_start_hour: "10",
      sending_end_hour: "22",
      sending_rule_enabled: "1",
      default_unit_price: "1",
      message_retention_days: "365",
    };
    for (const [k, v] of Object.entries(sysDefaults)) {
      const ex = await db.select().from(systemSettings).where(eq(systemSettings.key, k));
      if (!ex[0]) await db.insert(systemSettings).values({ key: k, value: v });
    }

    return NextResponse.json({ success: true, code: 200, message: "Seed tamamlandı. admin/Admin123! demo/Demo123!", data: null });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ success: false, code: 500, message: e instanceof Error ? e.message : "Seed hatası" }, { status: 500 });
  }
}
