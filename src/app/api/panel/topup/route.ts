import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { topupRequests, bankAccounts, cryptoAssets, cryptoPaymentReports, paymentSettings, notifications } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getSession, hasPermission } from "@/lib/auth";
import { generateReferenceCode } from "@/lib/security";

async function getPaymentSettings() {
  const rows = await db.select().from(paymentSettings);
  return rows[0] ?? { minTopupTry: "100", maxTopupTry: "500000", requestTtlMinutes: 1440, bankNote: "", maxOpenRequests: 3 };
}

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (action === "banks") {
    const rows = await db.select().from(bankAccounts).where(eq(bankAccounts.isActive, true));
    return NextResponse.json({ success: true, code: 200, message: "OK", data: rows });
  }
  if (action === "assets") {
    const rows = await db.select().from(cryptoAssets).where(eq(cryptoAssets.isActive, true));
    return NextResponse.json({ success: true, code: 200, message: "OK", data: rows });
  }
  if (action === "settings") {
    const ps = await getPaymentSettings();
    return NextResponse.json({ success: true, code: 200, message: "OK", data: ps });
  }
  const id = url.searchParams.get("id");
  if (id) {
    const r = (await db.select().from(topupRequests).where(eq(topupRequests.id, Number(id))))[0];
    if (!r || (!s.isAdmin && r.userId !== s.id)) return NextResponse.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
    const report = (await db.select().from(cryptoPaymentReports).where(eq(cryptoPaymentReports.topupRequestId, Number(id))))[0] ?? null;
    let asset = null;
    if (r.cryptoAssetId) asset = (await db.select().from(cryptoAssets).where(eq(cryptoAssets.id, r.cryptoAssetId)))[0] ?? null;
    return NextResponse.json({ success: true, code: 200, message: "OK", data: { request: r, report, asset } });
  }
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(50, Number(url.searchParams.get("perPage") || 10));
  const where = s.isAdmin && url.searchParams.get("all") === "1" ? "1=1" : `t.user_id=${s.id}`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM topup_requests t WHERE ${where}`)).rows[0].c);
  const rows = (
    await pool.query(
      `SELECT t.*, u.username, (SELECT txid FROM crypto_payment_reports c WHERE c.topup_request_id=t.id LIMIT 1) as txid FROM topup_requests t LEFT JOIN users u ON u.id=t.user_id WHERE ${where} ORDER BY t.created_at DESC LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    )
  ).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "credit.topup"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const action = b.action as string;
  const ps = await getPaymentSettings();
  const min = Number(ps.minTopupTry ?? 100);
  const max = Number(ps.maxTopupTry ?? 500000);
  const maxOpen = Number((ps as { maxOpenRequests?: number }).maxOpenRequests ?? 3);

  const openCount = Number((await pool.query(`SELECT COUNT(*) c FROM topup_requests WHERE user_id=${s.id} AND status IN ('pending','reported')`)).rows[0].c);

  if (action === "create-bank") {
    if (openCount >= maxOpen) return NextResponse.json({ success: false, code: 400, message: `En fazla ${maxOpen} açık talebiniz olabilir.` }, { status: 400 });
    const amount = Number(b.amountTry);
    if (!amount || amount < min || amount > max) return NextResponse.json({ success: false, code: 422, message: `Tutar ${min}–${max} TL aralığında olmalı.` }, { status: 422 });
    const ref = generateReferenceCode();
    const ins = await db.insert(topupRequests).values({ userId: s.id, method: "bank", amountTry: String(amount), referenceCode: ref, status: "pending" }).returning();
    const banks = await db.select().from(bankAccounts).where(eq(bankAccounts.isActive, true));
    return NextResponse.json({ success: true, code: 200, message: "Talep oluşturuldu. Ödemeyi yapıp bildirin.", data: { request: ins[0], banks, bankNote: (ps as { bankNote?: string }).bankNote } });
  }

  if (action === "report-bank") {
    const id = Number(b.id);
    const r = (await db.select().from(topupRequests).where(eq(topupRequests.id, id)))[0];
    if (!r || r.userId !== s.id) return NextResponse.json({ success: false, code: 404, message: "Talep bulunamadı." }, { status: 404 });
    if (r.status !== "pending") return NextResponse.json({ success: false, code: 400, message: "Bu talep bildirime uygun değil." }, { status: 400 });
    // receipt validation (base64 data url, max ~5MB)
    let receipt: string | null = null;
    if (b.receiptBase64) {
      const str = String(b.receiptBase64);
      if (str.length > 7_000_000) return NextResponse.json({ success: false, code: 422, message: "Dekont en fazla 5 MB olabilir." }, { status: 422 });
      if (!str.startsWith("data:image/") && !str.startsWith("data:application/pdf")) {
        return NextResponse.json({ success: false, code: 422, message: "Dekont jpg/png/pdf olmalı." }, { status: 422 });
      }
      receipt = str.slice(0, 7_000_000);
    }
    await db.update(topupRequests).set({ status: "reported", senderName: b.senderName ? String(b.senderName) : null, note: b.note ? String(b.note) : null, receiptPath: receipt, updatedAt: new Date() }).where(eq(topupRequests.id, id));
    await db.insert(notifications).values({ userId: null, title: "Yeni havale bildirimi", message: `${s.username} - ${r.referenceCode} - ${r.amountTry} TL` });
    return NextResponse.json({ success: true, code: 200, message: "Ödeme bildirimi alındı. Onay bekleniyor." });
  }

  if (action === "create-crypto") {
    if (openCount >= maxOpen) return NextResponse.json({ success: false, code: 400, message: `En fazla ${maxOpen} açık talebiniz olabilir.` }, { status: 400 });
    const amount = Number(b.amountTry);
    if (!amount || amount < min || amount > max) return NextResponse.json({ success: false, code: 422, message: `Tutar ${min}–${max} TL aralığında olmalı.` }, { status: 422 });
    const assetId = Number(b.cryptoAssetId);
    const asset = (await db.select().from(cryptoAssets).where(eq(cryptoAssets.id, assetId)))[0];
    if (!asset || !asset.isActive) return NextResponse.json({ success: false, code: 400, message: "Geçersiz coin/ağ." }, { status: 400 });
    if (amount < Number(asset.minAmountTry ?? 0)) return NextResponse.json({ success: false, code: 422, message: `Bu coin için min tutar ${asset.minAmountTry} TL.` }, { status: 422 });
    const ref = generateReferenceCode();
    const ins = await db.insert(topupRequests).values({
      userId: s.id, method: "crypto", asset: asset.asset, network: asset.network, cryptoAssetId: asset.id,
      amountTry: String(amount), referenceCode: ref, status: "pending", walletAddressSnapshot: asset.walletAddress,
    }).returning();
    const rate = Number(asset.rateTry || 0);
    const estimated = rate > 0 ? Number((amount / rate).toFixed(8)) : 0;
    return NextResponse.json({ success: true, code: 200, message: "Kripto talebi oluşturuldu.", data: { request: ins[0], asset, estimatedCrypto: estimated } });
  }

  if (action === "report-crypto") {
    const id = Number(b.id);
    const r = (await db.select().from(topupRequests).where(eq(topupRequests.id, id)))[0];
    if (!r || r.userId !== s.id) return NextResponse.json({ success: false, code: 404, message: "Talep bulunamadı." }, { status: 404 });
    if (r.method !== "crypto" || r.status !== "pending") return NextResponse.json({ success: false, code: 400, message: "Bu talep bildirime uygun değil." }, { status: 400 });
    const txid = String(b.txid || "").trim();
    const sentAmount = Number(b.sentAmount);
    if (!txid || txid.length < 10) return NextResponse.json({ success: false, code: 422, message: "Geçerli bir TXID girin." }, { status: 422 });
    if (!sentAmount || sentAmount <= 0) return NextResponse.json({ success: false, code: 422, message: "Gönderilen miktar gerekli." }, { status: 422 });
    // TXID unique
    const dup = await db.select().from(cryptoPaymentReports).where(eq(cryptoPaymentReports.txid, txid));
    if (dup[0]) {
      await db.insert(notifications).values({ userId: null, title: "Tekrarlanan TXID uyarısı", message: `${s.username} mevcut bir TXID bildirdi: ${txid.slice(0, 24)}...` });
      return NextResponse.json({ success: false, code: 409, message: "Bu TXID daha önce kullanılmış." }, { status: 409 });
    }
    let receipt: string | null = null;
    if (b.receiptBase64) {
      const str = String(b.receiptBase64);
      if (str.length > 7_000_000) return NextResponse.json({ success: false, code: 422, message: "Dosya en fazla 5 MB olabilir." }, { status: 422 });
      receipt = str.slice(0, 7_000_000);
    }
    const asset = r.cryptoAssetId ? (await db.select().from(cryptoAssets).where(eq(cryptoAssets.id, r.cryptoAssetId)))[0] : null;
    await db.insert(cryptoPaymentReports).values({
      topupRequestId: id, asset: r.asset || asset?.asset || "USDT", network: r.network || asset?.network || "",
      txid, sentAmount: String(sentAmount), sentAt: b.sentAt ? new Date(b.sentAt) : null,
      fromAddress: b.fromAddress ? String(b.fromAddress) : null, receiptPath: receipt,
      userNote: b.userNote ? String(b.userNote) : null, rateTryApplied: asset ? String(asset.rateTry) : null,
    });
    await db.update(topupRequests).set({ status: "reported", updatedAt: new Date() }).where(eq(topupRequests.id, id));
    await db.insert(notifications).values({ userId: null, title: "Yeni kripto bildirimi", message: `${s.username} - ${r.referenceCode} - ${txid.slice(0, 16)}...` });
    return NextResponse.json({ success: true, code: 200, message: "Ödeme bildirimi alındı. Onay bekleniyor." });
  }

  return NextResponse.json({ success: false, code: 400, message: "Geçersiz işlem." }, { status: 400 });
}
