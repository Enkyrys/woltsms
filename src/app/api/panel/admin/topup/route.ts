import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { topupRequests, cryptoPaymentReports, auditLogs, notifications, cryptoAssets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, hasPermission } from "@/lib/auth";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "credit.approve"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(50, Number(url.searchParams.get("perPage") || 10));
  const method = url.searchParams.get("method") || "";
  const status = url.searchParams.get("status") || "";
  const q = url.searchParams.get("q") || "";
  let where = "1=1";
  if (method) where += ` AND t.method='${method.replace(/'/g, "")}'`;
  if (status) where += ` AND t.status='${status.replace(/'/g, "")}'`;
  if (q) where += ` AND (u.username ILIKE '%${q.replace(/'/g, "''")}%' OR t.reference_code ILIKE '%${q.replace(/'/g, "''")}%')`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM topup_requests t LEFT JOIN users u ON u.id=t.user_id WHERE ${where}`)).rows[0].c);
  const rows = (
    await pool.query(
      `SELECT t.*, u.username, u.email, c.txid, c.sent_amount as "sentAmount", c.from_address as "fromAddress", c.user_note as "userNote", c.rate_try_applied as "rateApplied", a.explorer_tx_url_template as "explorerTemplate", a.wallet_address as "currentWallet" FROM topup_requests t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN crypto_payment_reports c ON c.topup_request_id=t.id LEFT JOIN crypto_assets a ON a.id=t.crypto_asset_id WHERE ${where} ORDER BY t.created_at DESC LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    )
  ).rows;
  const pending = Number((await pool.query(`SELECT COUNT(*) c FROM topup_requests WHERE status IN ('pending','reported')`)).rows[0].c);
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)), pending } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "credit.approve"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const b = await req.json();
  const { id, action } = b;
  if (!id || !action) return NextResponse.json({ success: false, code: 400, message: "Eksik parametre." }, { status: 400 });

  const rows = await db.select().from(topupRequests).where(eq(topupRequests.id, Number(id)));
  const r = rows[0];
  if (!r) return NextResponse.json({ success: false, code: 404, message: "Talep bulunamadı." }, { status: 404 });
  if (r.userId === s.id) return NextResponse.json({ success: false, code: 403, message: "Kendi talebinizi onaylayamazsınız." }, { status: 403 });

  if (action === "reject") {
    if (!b.reason) return NextResponse.json({ success: false, code: 400, message: "Red gerekçesi zorunlu." }, { status: 400 });
    if (!["pending", "reported"].includes(r.status)) return NextResponse.json({ success: false, code: 400, message: "Bu talep zaten işlenmiş." }, { status: 400 });
    await db.update(topupRequests).set({ status: "rejected", rejectReason: String(b.reason), approvedBy: s.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(topupRequests.id, Number(id)));
    await db.insert(auditLogs).values({ actorId: s.id, action: "topup.reject", payload: JSON.stringify({ id, reason: b.reason }) });
    await db.insert(notifications).values({ userId: r.userId, title: "Yükleme talebi reddedildi", message: `${r.referenceCode} - ${b.reason}` });
    return NextResponse.json({ success: true, code: 200, message: "Talep reddedildi." });
  }

  if (action === "approve") {
    const credited = Number(b.creditedAmountTry ?? r.amountTry);
    if (!credited || credited <= 0) return NextResponse.json({ success: false, code: 422, message: "Geçerli bir tutar girin." }, { status: 422 });
    // Tek transaction: satır kilidi + çift onay engeli + bakiye artışı + wallet + audit
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(`SELECT * FROM topup_requests WHERE id=$1 FOR UPDATE`, [Number(id)]);
      const lr = locked.rows[0];
      if (!lr) throw new Error("NOT_FOUND");
      if (!["pending", "reported"].includes(lr.status)) throw new Error("ALREADY_PROCESSED");
      const uq = await client.query(`SELECT quota FROM users WHERE id=$1 FOR UPDATE`, [lr.user_id]);
      const cur = Number(uq.rows[0].quota ?? 0);
      const nb = cur + credited;
      await client.query(`UPDATE users SET quota=$1, updated_at=NOW() WHERE id=$2`, [nb.toFixed(4), lr.user_id]);
      const methodLabel = lr.method === "crypto" ? "Kripto" : "Havale";
      let desc = `Kredi Yükleme (${methodLabel}) - ${lr.reference_code} - ${credited} TL`;
      if (lr.method === "crypto") {
        const rep = await client.query(`SELECT txid, asset, network FROM crypto_payment_reports WHERE topup_request_id=$1`, [Number(id)]);
        if (rep.rows[0]) desc = `Kredi Yükleme (Kripto) - ${rep.rows[0].asset} ${rep.rows[0].network} - TXID ${rep.rows[0].txid} - ${credited} TL`;
        await client.query(`UPDATE crypto_payment_reports SET credited_amount_try=$1, admin_note=$2, updated_at=NOW() WHERE topup_request_id=$3`, [credited.toFixed(2), b.adminNote ? String(b.adminNote) : null, Number(id)]);
      }
      await client.query(
        `INSERT INTO wallet_transactions (user_id,type,credit,unit_price,total_price,currency,balance_after,ref_type,ref_id,description) VALUES ($1,'topup',$2,1,$3,'TRY',$4,'topup',$5,$6)`,
        [lr.user_id, credited.toFixed(4), credited.toFixed(4), nb.toFixed(4), lr.reference_code, desc]
      );
      await client.query(`UPDATE topup_requests SET status='approved', credited_amount_try=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW() WHERE id=$3`, [credited.toFixed(2), s.id, Number(id)]);
      await client.query(`INSERT INTO audit_logs (actor_id, action, payload) VALUES ($1,'topup.approve',$2)`, [s.id, JSON.stringify({ id, credited })]);
      await client.query(`INSERT INTO notifications (user_id, title, message) VALUES ($1,'Kredi yüklendi',$2)`, [lr.user_id, `${lr.reference_code} - ${credited} TL bakiyenize eklendi.`]);
      await client.query("COMMIT");
      return NextResponse.json({ success: true, code: 200, message: `${credited} TL bakiyeye eklendi.` });
    } catch (e) {
      await client.query("ROLLBACK");
      const msg = e instanceof Error ? e.message : "Hata";
      if (msg === "ALREADY_PROCESSED") return NextResponse.json({ success: false, code: 400, message: "Bu talep zaten işlenmiş (çift onay engellendi)." }, { status: 400 });
      return NextResponse.json({ success: false, code: 500, message: "Onay hatası: " + msg }, { status: 500 });
    } finally {
      client.release();
    }
  }

  return NextResponse.json({ success: false, code: 400, message: "Geçersiz işlem." }, { status: 400 });
}
