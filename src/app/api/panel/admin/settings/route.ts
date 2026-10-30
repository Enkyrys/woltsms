import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { paymentSettings, bankAccounts, cryptoAssets, providerSettings, announcements, systemSettings, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, hasPermission } from "@/lib/auth";
import { encrypt } from "@/lib/security";

async function need(s: { isAdmin: boolean } | null, perm: string) {
  if (!s) return false;
  if (s.isAdmin) return true;
  const { getPermissions } = await import("@/lib/auth");
  const p = await getPermissions((s as { roleId?: number | null }).roleId ?? null);
  return p.includes(perm);
}

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "payment";
  if (scope === "payment") {
    if (!(await hasPermission(s, "credit.settings"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    const ps = (await db.select().from(paymentSettings))[0] ?? null;
    const banks = await db.select().from(bankAccounts);
    const crypto = await db.select().from(cryptoAssets);
    return NextResponse.json({ success: true, code: 200, message: "OK", data: { settings: ps, banks, crypto } });
  }
  if (scope === "provider") {
    if (!(await hasPermission(s, "provider.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    const rows = await db.select().from(providerSettings);
    return NextResponse.json({ success: true, code: 200, message: "OK", data: rows.map((r) => ({ ...r, credentialsEncrypted: r.credentialsEncrypted ? "***" : null })) });
  }
  if (scope === "announcements") {
    const rows = await db.select().from(announcements);
    return NextResponse.json({ success: true, code: 200, message: "OK", data: rows });
  }
  if (scope === "system") {
    const rows = await db.select().from(systemSettings);
    const obj: Record<string, string> = {};
    for (const r of rows) obj[r.key] = r.value;
    return NextResponse.json({ success: true, code: 200, message: "OK", data: obj });
  }
  if (scope === "audit") {
    if (!(await hasPermission(s, "audit.view"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(50, Number(url.searchParams.get("perPage") || 15));
    const total = Number((await pool.query(`SELECT COUNT(*) c FROM audit_logs`)).rows[0].c);
    const rows = (await pool.query(`SELECT a.*, u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT $1 OFFSET $2`, [perPage, (page - 1) * perPage])).rows;
    return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
  }
  if (scope === "health") {
    const q = await pool.query(`SELECT (SELECT COUNT(*) FROM orders WHERE status='processing') processing, (SELECT COUNT(*) FROM orders WHERE status='scheduled') scheduled, (SELECT COUNT(*) FROM sms_messages WHERE status='failed' AND created_at > NOW() - INTERVAL '24 hours') failed24, (SELECT COUNT(*) FROM sms_messages WHERE created_at > NOW() - INTERVAL '24 hours') total24`);
    return NextResponse.json({ success: true, code: 200, message: "OK", data: q.rows[0] });
  }
  return NextResponse.json({ success: false, code: 400, message: "Geçersiz scope." }, { status: 400 });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const b = await req.json();
  const scope = b.scope as string;

  if (scope === "payment-settings") {
    if (!(await hasPermission(s, "credit.settings"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    const ex = await db.select().from(paymentSettings);
    const vals = {
      minTopupTry: String(b.minTopupTry ?? "100"),
      maxTopupTry: String(b.maxTopupTry ?? "500000"),
      requestTtlMinutes: Number(b.requestTtlMinutes ?? 1440),
      bankNote: b.bankNote ? String(b.bankNote) : null,
      maxOpenRequests: Number(b.maxOpenRequests ?? 3),
      updatedAt: new Date(),
    };
    if (ex[0]) await db.update(paymentSettings).set(vals).where(eq(paymentSettings.id, ex[0].id));
    else await db.insert(paymentSettings).values(vals);
    await db.insert(auditLogs).values({ actorId: s.id, action: "payment.settings.update", payload: JSON.stringify(vals) });
    return NextResponse.json({ success: true, code: 200, message: "Ödeme ayarları kaydedildi." });
  }
  if (scope === "bank") {
    if (!(await hasPermission(s, "credit.settings"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    if (b.id) {
      await db.update(bankAccounts).set({ bankName: String(b.bankName), accountHolder: String(b.accountHolder), iban: String(b.iban), isActive: b.isActive !== false, sortOrder: Number(b.sortOrder || 0) }).where(eq(bankAccounts.id, Number(b.id)));
    } else {
      await db.insert(bankAccounts).values({ bankName: String(b.bankName), accountHolder: String(b.accountHolder), iban: String(b.iban), isActive: b.isActive !== false, sortOrder: Number(b.sortOrder || 0) });
    }
    await db.insert(auditLogs).values({ actorId: s.id, action: "payment.bank.save", payload: JSON.stringify({ bankName: b.bankName }) });
    return NextResponse.json({ success: true, code: 200, message: "Banka kaydedildi." });
  }
  if (scope === "bank-delete") {
    if (!(await hasPermission(s, "credit.settings"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    await db.delete(bankAccounts).where(eq(bankAccounts.id, Number(b.id)));
    return NextResponse.json({ success: true, code: 200, message: "Banka silindi." });
  }
  if (scope === "crypto") {
    if (!(await hasPermission(s, "credit.settings"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    const vals = {
      asset: String(b.asset).toUpperCase(), network: String(b.network), walletAddress: String(b.walletAddress),
      memoTag: b.memoTag ? String(b.memoTag) : null, explorerTxUrlTemplate: b.explorerTxUrlTemplate ? String(b.explorerTxUrlTemplate) : null,
      rateTry: String(b.rateTry || "0"), minAmountTry: String(b.minAmountTry || "0"),
      isActive: b.isActive !== false, sortOrder: Number(b.sortOrder || 0), updatedAt: new Date(),
    };
    if (b.id) await db.update(cryptoAssets).set(vals).where(eq(cryptoAssets.id, Number(b.id)));
    else await db.insert(cryptoAssets).values(vals);
    await db.insert(auditLogs).values({ actorId: s.id, action: "payment.crypto.save", payload: JSON.stringify({ asset: vals.asset, network: vals.network }) });
    return NextResponse.json({ success: true, code: 200, message: "Kripto varlık kaydedildi." });
  }
  if (scope === "crypto-delete") {
    if (!(await hasPermission(s, "credit.settings"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    await db.delete(cryptoAssets).where(eq(cryptoAssets.id, Number(b.id)));
    return NextResponse.json({ success: true, code: 200, message: "Silindi." });
  }
  if (scope === "provider") {
    if (!(await hasPermission(s, "provider.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    const creds = b.credentials ? encrypt(JSON.stringify(b.credentials)) : null;
    if (b.provider) {
      const ex = await db.select().from(providerSettings).where(eq(providerSettings.provider, String(b.provider)));
      if (ex[0]) {
        await db.update(providerSettings).set({ credentialsEncrypted: creds ?? ex[0].credentialsEncrypted, lowBalanceThreshold: b.lowBalanceThreshold ? String(b.lowBalanceThreshold) : ex[0].lowBalanceThreshold, updatedAt: new Date() }).where(eq(providerSettings.id, ex[0].id));
      } else {
        await db.insert(providerSettings).values({ provider: String(b.provider), credentialsEncrypted: creds, isActive: false });
      }
    }
    if (b.activeProvider) {
      await pool.query(`UPDATE provider_settings SET is_active=false`);
      await pool.query(`UPDATE provider_settings SET is_active=true WHERE provider=$1`, [String(b.activeProvider)]);
    }
    await db.insert(auditLogs).values({ actorId: s.id, action: "provider.update", payload: JSON.stringify({ provider: b.provider, active: b.activeProvider }) });
    return NextResponse.json({ success: true, code: 200, message: "Sağlayıcı ayarları kaydedildi." });
  }
  if (scope === "announcement") {
    if (!(await hasPermission(s, "announcement.manage")) && !s.isAdmin) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    if (b.id) {
      await db.update(announcements).set({ text: String(b.text), isActive: b.isActive !== false }).where(eq(announcements.id, Number(b.id)));
    } else {
      await db.insert(announcements).values({ text: String(b.text), isActive: true });
    }
    return NextResponse.json({ success: true, code: 200, message: "Duyuru kaydedildi." });
  }
  if (scope === "announcement-delete") {
    await db.delete(announcements).where(eq(announcements.id, Number(b.id)));
    return NextResponse.json({ success: true, code: 200, message: "Silindi." });
  }
  if (scope === "system") {
    if (!s.isAdmin) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
    for (const [k, v] of Object.entries(b.values as Record<string, string>)) {
      const ex = await db.select().from(systemSettings).where(eq(systemSettings.key, k));
      if (ex[0]) await db.update(systemSettings).set({ value: String(v) }).where(eq(systemSettings.key, k));
      else await db.insert(systemSettings).values({ key: k, value: String(v) });
    }
    return NextResponse.json({ success: true, code: 200, message: "Sistem ayarları kaydedildi." });
  }
  return NextResponse.json({ success: false, code: 400, message: "Geçersiz scope." }, { status: 400 });
}
