import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveTopup, rejectTopup, adminAdjust } from "@/lib/services";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";

// GET: kredi talepleri (filtreli, admin)
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "credit.view") && !s.isAdmin) return forbidden();

  const admin = createAdminClient();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const method = url.searchParams.get("method");
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");

  let query = admin.from("topup_requests").select("*, profiles:user_id(username)", { count: "exact" });
  if (method) query = query.eq("method", method);
  if (status) query = query.eq("status", status);
  if (q) query = query.or(`reference_code.ilike.%${q}%,sender_name.ilike.%${q}%`);

  const { count, data } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  // kripto raporlarını getir
  const ids = (data ?? []).map((t) => t.id);
  const { data: reports } = await admin
    .from("crypto_payment_reports")
    .select("*")
    .in("topup_request_id", ids);
  const reportByTopup = new Map((reports ?? []).map((r) => [r.topup_request_id, r]));

  const rows = (data ?? []).map((t) => {
    const r = reportByTopup.get(t.id);
    const assetRow = r ? null : null;
    return {
      id: t.id,
      reference_code: t.reference_code,
      method: t.method,
      amount_try: t.amount_try,
      status: t.status,
      created_at: t.created_at,
      updated_at: t.updated_at,
      username: (t.profiles as unknown as { username?: string } | null)?.username ?? "",
      sender_name: t.sender_name,
      note: t.note,
      receipt_path: t.receipt_path,
      txid: r?.txid ?? "",
      sentAmount: r?.sent_amount ?? "",
      fromAddress: r?.from_address ?? "",
      userNote: r?.user_note ?? "",
      rateApplied: r?.rate_try_applied ?? "",
      credited_amount_try: t.approved_amount_try ?? r?.credited_amount_try ?? "",
      wallet_address_snapshot: t.wallet_address_snapshot,
      reject_reason: t.reject_reason,
      explorerTemplate: "",
      asset: r?.asset ?? "",
      network: r?.network ?? "",
      _assetRow: assetRow,
    };
  });

  // explorer şablonlarını ekle
  if (rows.some((r) => r.asset && r.network)) {
    const { data: assets } = await admin
      .from("crypto_assets")
      .select("asset, network, explorer_tx_url_template, wallet_address");
    const tmplMap = new Map((assets ?? []).map((a) => [`${a.asset}|${a.network}`, a.explorer_tx_url_template]));
    const walletMap = new Map((assets ?? []).map((a) => [`${a.asset}|${a.network}`, a.wallet_address]));
    for (const r of rows) {
      if (r.asset && r.network) {
        r.explorerTemplate = tmplMap.get(`${r.asset}|${r.network}`) ?? "";
        // mevcut cüzdan (snapshot karşılaştırması için)
        (r as Record<string, unknown>).currentWallet = walletMap.get(`${r.asset}|${r.network}`) ?? "";
      }
    }
  }

  // fiş görüntüleme için imzalı URL'ler (1 saat)
  const receiptPaths = rows.map((r) => r.receipt_path).filter((p): p is string => Boolean(p));
  if (receiptPaths.length) {
    const { data: signed } = await admin.storage.from("receipts").createSignedUrls(receiptPaths, 3600);
    const urlByPath = new Map<string, string>();
    (signed ?? []).forEach((su, i) => {
      if (su?.signedUrl) urlByPath.set(receiptPaths[i], su.signedUrl);
    });
    for (const r of rows) {
      (r as Record<string, unknown>).receiptUrl = r.receipt_path ? urlByPath.get(r.receipt_path) ?? "" : "";
    }
  }

  return ok(rows, "OK", { total: count ?? 0, page, perPage });
}

const ApproveSchema = z.object({
  action: z.literal("approve"),
  topupId: z.string().uuid(),
  creditAmount: z.number().positive(),
  adminNote: z.string().optional(),
});

const RejectSchema = z.object({
  action: z.literal("reject"),
  topupId: z.string().uuid(),
  reason: z.string().min(1, "Gerekçe zorunlu."),
});

const AdjustSchema = z.object({
  action: z.literal("adjust"),
  userId: z.string().uuid(),
  amount: z.number().refine((n) => n !== 0, "Tutar 0 olamaz."),
  description: z.string().optional(),
});

// POST: onay / red / manuel adjust
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Geçersiz JSON.");
  }

  const ap = ApproveSchema.safeParse(body);
  if (ap.success) {
    if (!hasPermissionSync(s, "credit.approve") && !s.isAdmin) return forbidden();
    const r = await approveTopup(ap.data.topupId, ap.data.creditAmount, ap.data.adminNote);
    if (!r.ok) return badRequest(r.error);
    return ok(r.data, "Kredi onaylandı.");
  }

  const rj = RejectSchema.safeParse(body);
  if (rj.success) {
    if (!hasPermissionSync(s, "credit.approve") && !s.isAdmin) return forbidden();
    const r = await rejectTopup(rj.data.topupId, rj.data.reason); // has_permission(auth.uid()) ister
    if (!r.ok) return badRequest(r.error);
    return ok(r.data, "Talep reddedildi.");
  }

  const aj = AdjustSchema.safeParse(body);
  if (aj.success) {
    if (!hasPermissionSync(s, "credit.adjust") && !s.isAdmin) return forbidden();
    const r = await adminAdjust(aj.data.userId, aj.data.amount, aj.data.description);
    if (!r.ok) return badRequest(r.error);
    return ok(r.data, "Bakiye ayarlandı.");
  }

  return badRequest("Geçersiz istek.");
}
