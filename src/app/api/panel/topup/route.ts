import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { ok, unauthorized, forbidden, badRequest, notFound } from "@/lib/api-response";

export const runtime = "nodejs";

// GET: banka hesapları, kripto varlıklar, ödeme ayarları, kullanıcı talepleri
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "banks") {
    const { data } = await admin.from("bank_accounts").select("*").eq("is_active", true).order("sort_order");
    return ok(
      (data ?? []).map((b) => ({
        id: b.id,
        bankName: b.bank_name,
        accountHolder: b.account_holder,
        iban: b.iban,
        branch: b.branch,
      }))
    );
  }

  if (action === "assets") {
    const { data } = await admin.from("crypto_assets").select("*").eq("is_active", true).order("sort_order");
    return ok(
      (data ?? []).map((a) => ({
        id: a.id,
        asset: a.asset,
        network: a.network,
        walletAddress: a.wallet_address,
        memoTag: a.memo_tag,
        rateTry: a.rate_try,
        rateUpdatedAt: a.rate_updated_at,
        minAmountTry: a.min_amount_try,
        explorerTxUrlTemplate: a.explorer_tx_url_template,
      }))
    );
  }

  if (action === "settings") {
    const { data } = await admin.from("payment_settings").select("*").limit(1).maybeSingle();
    return ok({
      minTopupTry: data?.min_topup_try ?? "100",
      maxTopupTry: data?.max_topup_try ?? "500000",
      requestTtlMinutes: data?.request_ttl_minutes ?? 1440,
      bankNote: data?.bank_note ?? "",
      maxOpenRequests: data?.max_open_requests ?? 3,
    });
  }

  // varsayılan: kullanıcının talepleri
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  let q = admin.from("topup_requests").select("*", { count: "exact" }).eq("user_id", s.id);
  const method = url.searchParams.get("method");
  if (method) q = q.eq("method", method);
  const { count, data } = await q.order("created_at", { ascending: false }).range((page - 1) * perPage, page * perPage - 1);

  // kripto bildirimlerini ekle (asset / txid / kur)
  const ids = (data ?? []).map((t) => t.id);
  const reportByTopup = new Map<string, Record<string, unknown>>();
  if (ids.length) {
    const { data: reports } = await admin.from("crypto_payment_reports").select("*").in("topup_request_id", ids);
    for (const r of reports ?? []) reportByTopup.set(r.topup_request_id, r as Record<string, unknown>);
  }

  return ok(
    (data ?? []).map((t) => {
      const r = reportByTopup.get(t.id);
      return {
        id: t.id,
        reference_code: t.reference_code,
        referenceCode: t.reference_code,
        method: t.method,
        amount_try: t.amount_try,
        amountTry: t.amount_try,
        status: t.status,
        created_at: t.created_at,
        updated_at: t.updated_at,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        wallet_address_snapshot: t.wallet_address_snapshot,
        walletAddressSnapshot: t.wallet_address_snapshot,
        reject_reason: t.reject_reason,
        approved_amount_try: t.approved_amount_try,
        receiptPath: t.receipt_path,
        asset: (r?.asset as string) ?? "",
        network: (r?.network as string) ?? "",
        txid: (r?.txid as string) ?? "",
        rateApplied: (r?.rate_try_applied as string) ?? "",
      };
    }),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

// Fiş yolu yalnızca kullanıcının kendi receipts/ klasöründe olabilir (path traversal'e kapalı)
function sanitizeReceiptPath(userId: string, p?: string): string | null {
  if (!p) return null;
  if (!p.startsWith(`${userId}/`)) return null;
  if (p.includes("..") || p.includes("//")) return null;
  return p;
}

const CreateBankSchema = z.object({
  action: z.literal("create-bank"),
  amountTry: z.number().positive(),
  senderName: z.string().optional(),
  note: z.string().optional(),
});

const CreateCryptoSchema = z.object({
  action: z.literal("create-crypto"),
  amountTry: z.number().positive(),
  cryptoAssetId: z.string().uuid(),
});

const ReportCryptoSchema = z.object({
  action: z.literal("report-crypto"),
  topupId: z.string().uuid(),
  txid: z.string().min(4),
  sentAmount: z.number().positive(),
  sentAt: z.string().optional(),
  fromAddress: z.string().optional(),
  userNote: z.string().optional(),
  receiptPath: z.string().optional(), // Storage receipts/ altındaki imzalı yükleme yolu
});

const ReportBankSchema = z.object({
  action: z.literal("report-bank"),
  topupId: z.string().uuid(),
  senderName: z.string().optional(),
  note: z.string().optional(),
  receiptPath: z.string().optional(),
});

// POST: talep oluşturma / ödeme bildirimi
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "credit.topup")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Geçersiz JSON.");
  }
  const admin = createAdminClient();
  const user = await createUserClient(); // RPC'ler auth.uid() ile çalışır → kullanıcının JWT'si

  // rapor işlemleri
  const rc = ReportCryptoSchema.safeParse(body);
  if (rc.success) {
    const { data, error } = await user.rpc("rpc_report_topup", {
      p_topup_id: rc.data.topupId,
      p_txid: rc.data.txid,
      p_sent_amount: rc.data.sentAmount,
      p_sent_at: rc.data.sentAt ?? null,
      p_from_address: rc.data.fromAddress ?? null,
      p_user_note: rc.data.userNote ?? null,
      p_receipt_path: sanitizeReceiptPath(s.id, rc.data.receiptPath),
    });
    if (error) return badRequest(error.message);
    return ok(data as Record<string, unknown>, "Ödeme bildiriminiz alındı.");
  }
  const rb = ReportBankSchema.safeParse(body);
  if (rb.success) {
    const { data, error } = await user.rpc("rpc_report_bank_topup", {
      p_topup_id: rb.data.topupId,
      p_sender_name: rb.data.senderName ?? null,
      p_note: rb.data.note ?? null,
      p_receipt_path: sanitizeReceiptPath(s.id, rb.data.receiptPath),
    });
    if (error) return badRequest(error.message);
    return ok(data as Record<string, unknown>, "Ödeme bildiriminiz alındı.");
  }

  // talep oluşturma
  const cb = CreateBankSchema.safeParse(body);
  if (cb.success) {
    const { data, error } = await user.rpc("rpc_create_topup", {
      p_method: "bank",
      p_amount_try: cb.data.amountTry,
      p_sender_name: cb.data.senderName ?? null,
      p_note: cb.data.note ?? null,
    });
    if (error) return badRequest(error.message);
    const d = data as Record<string, unknown>;
    const { data: banks } = await admin.from("bank_accounts").select("*").eq("is_active", true).order("sort_order");
    const { data: settings } = await admin.from("payment_settings").select("bank_note").limit(1).maybeSingle();
    return ok(
      {
        request: {
          id: d.id,
          referenceCode: d.reference_code,
          amountTry: d.amount_try,
          status: d.status,
          method: d.method,
        },
        banks: (banks ?? []).map((b) => ({
          id: b.id,
          bankName: b.bank_name,
          accountHolder: b.account_holder,
          iban: b.iban,
        })),
        bankNote: settings?.bank_note ?? "",
      },
      "Talep oluşturuldu."
    );
  }

  const cc = CreateCryptoSchema.safeParse(body);
  if (cc.success) {
    const { data, error } = await user.rpc("rpc_create_topup", {
      p_method: "crypto",
      p_amount_try: cc.data.amountTry,
      p_asset_id: cc.data.cryptoAssetId,
    });
    if (error) return badRequest(error.message);
    const d = data as Record<string, unknown>;
    return ok(
      {
        request: {
          id: d.id,
          referenceCode: d.reference_code,
          amountTry: d.amount_try,
          status: d.status,
          method: d.method,
          walletAddressSnapshot: d.wallet_address,
        },
        asset: d.asset,
        network: d.network,
        memoTag: d.memo_tag,
        estimatedCrypto: d.estimated_crypto,
        explorerTemplate: d.explorer_template,
      },
      "Talep oluşturuldu."
    );
  }

  return badRequest("Geçersiz istek.");
}
