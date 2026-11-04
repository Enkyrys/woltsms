import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getActiveProvider, hasActiveProvider } from "@/lib/providers";
import type { Json } from "@/db/types";
import { parseTurkeyDateTime } from "@/lib/timezone";

// WOLTSMS - servis katmanı: tüm bakiye işlemleri SQL RPC'lerinde.
// Bu dosyalık yalnızca çağırıcı + worker orkestrasyonu.

export type RpcResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string; code: number };

function mapError(e: unknown): { error: string; code: number } {
  const anyE = e as { message?: string; code?: string };
  const msg = String(anyE?.message || "Bilinmeyen hata");
  const tr: Record<string, { error: string; code: number }> = {
    INSUFFICIENT_BALANCE: { error: "Yetersiz bakiye.", code: 402 },
    AUTH_REQUIRED: { error: "Oturum gerekli.", code: 401 },
    NO_PERMISSION: { error: "Yetkiniz yok.", code: 403 },
    ACCOUNT_DISABLED: { error: "Hesabınız pasif.", code: 403 },
    EMPTY_MESSAGE: { error: "Mesaj boş olamaz.", code: 400 },
    EMPTY_RECIPIENTS: { error: "Alıcı listesi boş.", code: 400 },
    NO_VALID_RECIPIENTS: { error: "Geçerli alıcı bulunamadı.", code: 422 },
    TOO_MANY_RECIPIENTS: { error: "Sipariş başına azami alıcı sınırı aşıldı.", code: 422 },
    ALL_BLACKLISTED: { error: "Tüm alıcılar karaliste nedeniyle çıkarıldı.", code: 422 },
    OUTSIDE_SENDING_WINDOW: { error: "Gönderim saati dışında. Gönderimler 24 saat (00:00–23:59, Türkiye saati) aktiftir.", code: 422 },
    ALREADY_SETTLED: { error: "İşlem zaten sonuçlandırılmış.", code: 409 },
    TOPUP_NOT_FOUND: { error: "Kredi talebi bulunamadı.", code: 404 },
    MESSAGE_NOT_FOUND: { error: "Mesaj bulunamadı.", code: 404 },
    NOT_FOUND: { error: "Kayıt bulunamadı.", code: 404 },
    USERNAME_TAKEN: { error: "Kullanıcı adı zaten kullanımda.", code: 409 },
    AMOUNT_OUT_OF_RANGE: { error: "Tutar izin verilen aralıkta değil.", code: 422 },
    TOO_MANY_OPEN_REQUESTS: { error: "Çok fazla açık kredi talebiniz var.", code: 422 },
    ASSET_NOT_FOUND: { error: "Kripto varlık bulunamadı.", code: 404 },
    TXID_REQUIRED: { error: "TXID zorunludur.", code: 422 },
    INVALID_STATUS: { error: "Talep durumu bu işlem için uygun değil.", code: 409 },
    NOT_CRYPTO: { error: "Bu işlem yalnızca kripto talepleri içindir.", code: 422 },
    REASON_REQUIRED: { error: "Red gerekçesi zorunludur.", code: 422 },
    INVALID_AMOUNT: { error: "Geçersiz tutar.", code: 422 },
    SELF_APPROVAL: { error: "Kendi kredi talebinizi onaylayamazsınız.", code: 403 },
    REPORT_REQUIRED: { error: "Kripto taleplerinde TXID bildirimi olmadan onay verilemez.", code: 422 },
    IDEMPOTENCY_KEY_REUSED: { error: "Bu Idempotency-Key farklı bir istekle kullanılmış.", code: 422 },
    ALREADY_DELIVERED: { error: "Teslim edilmiş mesaj iade edilemez.", code: 409 },
  };
  // duplicate key (TXID vs.)
  if (msg.includes("duplicate key") || msg.includes("unique constraint")) {
    return { error: "Bu TXID veya referans zaten kayıtlı.", code: 409 };
  }
  for (const [k, v] of Object.entries(tr)) {
    if (msg.includes(k)) return v;
  }
  return { error: msg, code: 500 };
}

// ===================== sipariş oluşturma (panel/API) =====================

export async function createOrder(opts: {
  userId: string;
  recipients: string[];
  message: string;
  scheduleAt?: string | null;
  source: "panel" | "api";
  idempotencyKey?: string | null;
  contactListId?: string | null;
  // API anahtarıyla (çerezsiz) çağrıldığında true: service_role + p_user_id kullanılır.
  // Panel çağrılarında false bırakın; RPC auth.uid() ile oturum kimliğini okur.
  viaServiceRole?: boolean;
}): Promise<
  | {
      ok: true;
      orderId: string;
      status: string;
      totalCount: number;
      blacklistedCount: number;
      invalidCount: number;
      segments: number;
      encoding: string;
      unitPrice: string;
      totalCost: string;
      balanceAfter: string;
      scheduledAt: string | null;
    }
  | { ok: false; error: string; code: number }
> {
  // Gönderim zamanı:
  //  - scheduleAt boş  → sipariş kaydedildiği anda ENKYRYS'e gönderilir.
  //  - scheduleAt dolu → oluşturma saatinden SONRAKİ bir an olmalı; sipariş "Zamanlı"
  //    bekler, o an gelince worker ENKYRYS API ile gönderir.
  // Saat dilimli ISO (panel, tarayıcıdan) olduğu gibi; saat dilimsiz değer (API) Türkiye saati.
  let scheduleAtUtc: string | null = null;
  if (opts.scheduleAt) {
    scheduleAtUtc = parseTurkeyDateTime(opts.scheduleAt);
    if (!scheduleAtUtc) {
      return { ok: false, error: "Geçersiz gönderim tarihi. Örnek: 2026-11-05T14:30:00+03:00", code: 400 };
    }
    const at = Date.parse(scheduleAtUtc);
    if (at < Date.now() - 60_000) {
      return { ok: false, error: "İleri tarihli gönderim zamanı, oluşturma saatinden sonra olmalıdır.", code: 422 };
    }
    if (at <= Date.now() + 30_000) scheduleAtUtc = null; // ~şimdi: hemen gönder
  }
  try {
    // panel: oturum JWT'siyle (auth.uid() için); public API: service_role + p_user_id
    const supabase = opts.viaServiceRole ? createAdminClient() : await createClient();
    const { data, error } = await supabase.rpc("rpc_create_order", {
      p_recipients: opts.recipients as unknown as Json,
      p_message: opts.message,
      p_schedule_at: scheduleAtUtc,
      p_source: opts.source,
      p_idempotency_key: opts.idempotencyKey ?? null,
      p_contact_list_id: opts.contactListId ?? null,
      p_user_id: opts.viaServiceRole ? opts.userId : null,
    });
    if (error) {
      // RPC exception'ları PostgREST hatası olarak döner
      const mapped = mapError(new Error(error.message));
      // 402 gibi HTTP kodları error.details/ code alanlarında olabilir
      const codeMatch = error.message.match(/(INSUFFICIENT_BALANCE|OUTSIDE_SENDING_WINDOW|ALL_BLACKLISTED|NO_VALID_RECIPIENTS|TOO_MANY_RECIPIENTS|NO_PERMISSION|AUTH_REQUIRED|EMPTY_MESSAGE|EMPTY_RECIPIENTS|ACCOUNT_DISABLED|IDEMPOTENCY_KEY_REUSED)/);
      if (codeMatch) return { ok: false, ...mapError(new Error(codeMatch[1])) };
      return { ok: false, ...mapped };
    }
    const d = data as Record<string, unknown>;
    if (d.status === "cancelled") {
      return { ok: false, error: String(d.message ?? "Gönderim pencere dışı."), code: 422 };
    }
    return {
      ok: true,
      orderId: String(d.order_id),
      status: String(d.status),
      totalCount: Number(d.total_count),
      blacklistedCount: Number(d.blacklisted_count ?? 0),
      invalidCount: Number(d.invalid_count ?? 0),
      segments: Number(d.segments),
      encoding: String(d.encoding),
      unitPrice: String(d.unit_price),
      totalCost: String(d.total_cost),
      balanceAfter: String(d.balance_after),
      scheduledAt: (d.scheduled_at as string) ?? null,
    };
  } catch (e) {
    return { ok: false, ...mapError(e) };
  }
}

// ===================== manuel iletim (sağlayıcı pasifken) =====================

export async function manualDeliverOrder(orderId: string, actorId: string): Promise<RpcResult<{ messages: number }>> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rpc_manual_deliver_order", { p_order_id: orderId, p_actor: actorId });
    if (error) {
      const m = error.message.match(/(ORDER_NOT_FOUND|ORDER_NOT_PENDING|NO_PENDING_MESSAGES)/);
      if (m?.[1] === "ORDER_NOT_FOUND") return { ok: false, error: "Sipariş bulunamadı.", code: 404 };
      if (m) return { ok: false, error: "Bu siparişte iletilecek bekleyen mesaj yok.", code: 409 };
      return { ok: false, error: error.message, code: 500 };
    }
    return { ok: true, data: { messages: Number((data as { messages?: number } | null)?.messages ?? 0) } };
  } catch (e) {
    return { ok: false, ...mapError(e) };
  }
}

// ===================== kredi işlemleri =====================

export async function approveTopup(topupId: string, amount: number, note?: string): Promise<RpcResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_approve_topup", {
      p_topup_id: topupId,
      p_credit_amount: amount,
      p_admin_note: note ?? null,
    });
    if (error) return { ok: false, ...mapError(new Error(error.message)) };
    return { ok: true, data: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, ...mapError(e) };
  }
}

export async function rejectTopup(topupId: string, reason: string): Promise<RpcResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_reject_topup", {
      p_topup_id: topupId,
      p_reason: reason,
    });
    if (error) return { ok: false, ...mapError(new Error(error.message)) };
    return { ok: true, data: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, ...mapError(e) };
  }
}

export async function adminAdjust(userId: string, amount: number, description?: string): Promise<RpcResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_admin_adjust", {
      p_user_id: userId,
      p_amount: amount,
      p_description: description ?? null,
    });
    if (error) return { ok: false, ...mapError(new Error(error.message)) };
    return { ok: true, data: data as Record<string, unknown> };
  } catch (e) {
    return { ok: false, ...mapError(e) };
  }
}

// ===================== sipariş kaydedilince hemen gönder =====================
// Route Handler'larda next/server `after()` ile çağrılır: yanıt döndükten hemen sonra
// aynı istek içinde çalışır (Vercel fonksiyonu kapanmadan). Worker cron'u yedek olarak kalır.
export async function sendOrderNow(limit = 250): Promise<void> {
  try {
    await processSendBatch(limit);
  } catch {
    // kuyrukta kalan mesajları dakikalık worker gönderir
  }
}

// ===================== worker: gönderim partisi =====================

export async function processSendBatch(limit = 250): Promise<{ claimed: number; sent: number; failed: number; retried: number }> {
  const admin = createAdminClient();

  // Sağlayıcı API'si pasifse otomatik gönderim yapılmaz: mesajlar kuyrukta, siparişler
  // "Bekliyor" kalır. Admin siparişi manuel olarak "iletildi" onaylayabilir.
  if (!(await hasActiveProvider())) return { claimed: 0, sent: 0, failed: 0, retried: 0 };
  const provider = await getActiveProvider();

  // SKIP LOCKED ile parti al
  const { data: batch, error } = await admin.rpc("rpc_claim_send_batch", { p_limit: limit });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const messages = (batch ?? []) as {
    id: string;
    recipient: string;
    body: string;
    user_id: string;
    next_attempt_at: string | null;
    created_at: string; // sipariş/mesajın veritabanına kaydedildiği an (UTC)
  }[];
  if (messages.length === 0) return { claimed: 0, sent: 0, failed: 0, retried: 0 };

  // kullanıcının callback URL'i (API anahtarı)
  const userIds = [...new Set(messages.map((m) => m.user_id))];
  const { data: keys } = await admin
    .from("api_keys")
    .select("user_id, callback_url")
    .in("user_id", userIds)
    .eq("status", "active");
  const callbackByUser = new Map<string, string>();
  for (const k of keys ?? []) {
    if (k.callback_url && !callbackByUser.has(k.user_id)) callbackByUser.set(k.user_id, k.callback_url);
  }

  let sent = 0;
  let failed = 0;
  let retried = 0;

  // Vercel fonksiyon süresini aşmamak için: sınırlı eşzamanlılık + süre bütçesi.
  // Bütçe biterse kalan mesajlar 'sending'de kalır; rpc_requeue_stuck bunları kuyruğa geri alır.
  const concurrency = Number(process.env.WORKER_CONCURRENCY || 10);
  const deadline = Date.now() + Number(process.env.WORKER_TIME_BUDGET_MS || 45_000);
  const queue = [...messages];

  const handleOne = async (m: (typeof messages)[number]) => {
    const callbackUrl = callbackByUser.get(m.user_id);
    const cbFull = callbackUrl
      ? `${process.env.APP_URL || ""}/api/v1/webhooks/dlr/${provider.name}?u=${m.user_id}`
      : undefined;
    // Gönderim anı = siparişin gönderim zamanı (hemen: oluşturma anı, ileri tarihli: seçilen an).
    // Adapter bunu ENKYRYS saatine (UTC) çevirip beginDate/beginTime olarak iletir;
    // an geçmişte kaldıysa (yeniden deneme) "şimdi" kullanılır.
    const res = await provider.sendSms(m.recipient, m.body, { callbackUrl: cbFull, sendAt: m.next_attempt_at ?? m.created_at });

    // Sonuç + API yanıtı tek işlemde kaydedilir (sms_send_attempts: başarılı/başarısız ayrı satır).
    // Kalıcı hatalar (retryable=false) tekrar denenmez; geçiciler üstel beklemeyle yeniden denenir.
    const { data: completed, error: completeErr } = await admin.rpc("rpc_complete_send", {
      p_message_id: m.id,
      p_ok: res.ok,
      p_provider_message_id: res.providerMessageId ?? null,
      p_error: res.ok ? null : `${res.errorCode ?? "ERROR"}${res.error ? `: ${res.error}` : ""}`,
      p_retryable: res.ok ? true : res.retryable !== false,
      p_response: (res.raw ?? null) as Json,
      p_http_status: res.httpStatus ?? null,
      p_provider: provider.name,
    });
    if (completeErr) return; // idempotent: aynı mesaj iki kez işlenirse 'ignored' döner

    const outcome = String((completed as { status?: string } | null)?.status ?? "");
    if (res.ok) {
      sent++;
      if (callbackUrl) {
        await admin.from("callback_queue").insert({
          user_id: m.user_id,
          url: callbackUrl,
          payload: {
            event: "message.sent",
            message_id: m.id,
            provider_message_id: res.providerMessageId ?? null,
            recipient: m.recipient,
            status: "sent",
          },
        });
      }
    } else if (outcome === "retry_scheduled") {
      retried++;
    } else if (outcome === "failed") {
      failed++;
      if (callbackUrl) {
        await admin.from("callback_queue").insert({
          user_id: m.user_id,
          url: callbackUrl,
          payload: { event: "message.failed", message_id: m.id, recipient: m.recipient, status: "failed", error: res.errorCode ?? "ERROR" },
        });
      }
    }
  };

  const runner = async () => {
    while (queue.length > 0 && Date.now() < deadline) {
      const m = queue.shift();
      if (!m) break;
      try {
        await handleOne(m);
      } catch {
        // tek mesajın hatası partiyi durdurmaz; mesaj 'sending'de kalırsa requeue kurtarır
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, runner));

  return { claimed: messages.length, sent, failed, retried };
}

// ===================== worker: dosya içe aktarma =====================
async function parseColumnA(bytes: Buffer, filename: string): Promise<string[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(bytes, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, defval: "" });
    return rows.map((r) => String(Array.isArray(r) ? r[0] ?? "" : "")).filter(Boolean);
  }
  // csv / txt: A kolonu = virgül/noktalı virgül/tab ilk alan
  return bytes
    .toString("utf8")
    .split(/\r?\n/)
    .map((l) => l.split(/[;,\t]/)[0].trim())
    .filter(Boolean);
}

export async function processImportJob(payload: {
  importJobId: string;
  userId: string;
  kind: "contact_list" | "blacklist";
  storagePath: string;
  bucket: string;
  listId: string | null;
}): Promise<{ ok: boolean; imported?: number; error?: string }> {
  const admin = createAdminClient();
  const { importJobId, userId, kind, storagePath, bucket, listId } = payload;

  try {
    await admin.from("import_jobs").update({ status: "processing" }).eq("id", importJobId);

    const { data: file, error: dlErr } = await admin.storage.from(bucket).download(storagePath);
    if (dlErr || !file) throw new Error(`Dosya indirilemedi: ${dlErr?.message}`);
    const bytes = Buffer.from(await file.arrayBuffer());

    const raw = await parseColumnA(bytes, storagePath);
    const { normalizePhone } = await import("@/lib/sms-segments");
    const seen = new Set<string>();
    const valid: string[] = [];
    let invalid = 0;

    for (const line of raw) {
      const n = normalizePhone(line);
      if (!n) {
        invalid++;
        continue;
      }
      if (seen.has(n)) continue;
      seen.add(n);
      valid.push(n);
    }

    // kara liste filtresi
    let blacklisted = 0;
    let finalList = valid;
    if (kind === "contact_list") {
      const { data: bl } = await admin.from("blacklist").select("phone").or(`user_id.eq.${userId},user_id.is.null`);
      const blSet = new Set((bl ?? []).map((b) => b.phone));
      finalList = valid.filter((n) => {
        if (blSet.has(n)) {
          blacklisted++;
          return false;
        }
        return true;
      });
    }

    let imported = 0;
    let duplicates = 0;

    if (kind === "contact_list" && listId) {
      // tek tek insert (RLS uyumlu); chunk'lar halinde
      for (let i = 0; i < finalList.length; i += 500) {
        const chunk = finalList.slice(i, i + 500).map((phone) => ({ list_id: listId, phone }));
        const { error } = await admin.from("contacts").upsert(chunk, { onConflict: "list_id,phone", ignoreDuplicates: true });
        if (!error) imported += chunk.length;
      }
      const { count } = await admin.from("contacts").select("id", { count: "exact", head: true }).eq("list_id", listId);
      await admin.from("contact_lists").update({ count: count ?? imported }).eq("id", listId);
      duplicates = valid.length - imported;
    } else if (kind === "blacklist") {
      for (let i = 0; i < finalList.length; i += 500) {
        const chunk = finalList.slice(i, i + 500).map((phone) => ({ user_id: userId, phone }));
        const { error } = await admin
          .from("blacklist")
          .upsert(chunk, { onConflict: "user_id,phone", ignoreDuplicates: true });
        if (!error) imported += chunk.length;
      }
      duplicates = valid.length - imported;
    }

    await admin
      .from("import_jobs")
      .update({ status: "done", total: raw.length, imported, duplicates, blacklisted, invalid })
      .eq("id", importJobId);

    await admin.from("notifications").insert({
      user_id: userId,
      type: "import_done",
      title: "İçe Aktarma Tamamlandı",
      body: `${imported} numara işlendi (${duplicates} tekrar, ${invalid} geçersiz, ${blacklisted} karaliste).`,
    });

    return { ok: true, imported };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "import_error";
    await admin.from("import_jobs").update({ status: "failed", error: msg }).eq("id", importJobId);
    return { ok: false, error: msg };
  }
}

// ===================== worker: DLR + callback teslimi =====================

export async function processCallbacks(limit = 100): Promise<{ delivered: number; failed: number }> {
  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("callback_queue")
    .select("*")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  let delivered = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(job.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        await admin.from("callback_queue").update({ status: "done" }).eq("id", job.id);
        delivered++;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      const attempts = job.attempts + 1;
      if (attempts >= 5) {
        await admin
          .from("callback_queue")
          .update({ status: "failed", attempts, last_error: e instanceof Error ? e.message : "error" })
          .eq("id", job.id);
        failed++;
      } else {
        await admin
          .from("callback_queue")
          .update({
            attempts,
            last_error: e instanceof Error ? e.message : "error",
            run_at: new Date(Date.now() + 1000 * 60 * Math.pow(2, attempts)).toISOString(), // üstel bekleme
          })
          .eq("id", job.id);
      }
    }
  }
  return { delivered, failed };
}

// ===================== worker: ana giriş =====================

export async function runWorker(): Promise<{
  batch: Awaited<ReturnType<typeof processSendBatch>>;
  callbacks: Awaited<ReturnType<typeof processCallbacks>>;
  expiredTopups: number;
  cancelled: number;
  requeued: number;
  providerBalance: number | null;
  imports: number;
}> {
  const admin = createAdminClient();

  const [batch, callbacks, expired, cancelled, requeued, providerBalance, imports] = await Promise.all([
    processSendBatch(Number(process.env.WORKER_BATCH_SIZE || 250)).catch(() => ({ claimed: 0, sent: 0, failed: 0, retried: 0 })),
    processCallbacks(100).catch(() => ({ delivered: 0, failed: 0 })),
    Promise.resolve(admin.rpc("rpc_expire_topups")).then((r) => (r.data as number) ?? 0).catch(() => 0),
    // sağlayıcı pasifken bekleyen siparişler pencere dışı iptal edilmez (admin manuel onaylar)
    hasActiveProvider()
      .then((active) => (active ? Promise.resolve(admin.rpc("rpc_cancel_out_of_window")).then((r) => (r.data as number) ?? 0) : 0))
      .catch(() => 0),
    Promise.resolve(admin.rpc("rpc_requeue_stuck", { p_minutes: 10 })).then((r) => (r.data as number) ?? 0).catch(() => 0),
    checkProviderBalance().catch(() => null),
    processImportJobs(3).catch(() => 0),
  ]);

  // 7/24 izleme: zamanlayıcının en son ne zaman çalıştığı (Sistem > Sağlık'ta gösterilir)
  await admin
    .from("system_settings")
    .upsert(
      { key: "worker_last_run_at", value: new Date().toISOString(), description: "Zamanlayıcının (worker) son çalışma anı" },
      { onConflict: "key" }
    )
    .then(() => undefined, () => undefined);

  return { batch, callbacks, expiredTopups: expired, cancelled, requeued, providerBalance, imports };
}

// ===================== worker: içe aktarma kuyruğu =====================
async function processImportJobs(limit = 3): Promise<number> {
  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("jobs")
    .select("*")
    .eq("type", "import_file")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  let done = 0;
  for (const job of jobs ?? []) {
    // SKIP LOCKED benzeri: çalışıyorsa atla
    const { data: claimed } = await admin
      .from("jobs")
      .update({ status: "running", locked_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const payload = job.payload as unknown as {
      importJobId: string;
      userId: string;
      kind: "contact_list" | "blacklist";
      storagePath: string;
      bucket: string;
      listId: string | null;
    };
    const result = await processImportJob(payload);
    await admin
      .from("jobs")
      .update({
        status: result.ok ? "done" : job.attempts + 1 >= 3 ? "failed" : "pending",
        last_error: result.error ?? null,
        run_at: result.ok ? job.run_at : new Date(Date.now() + 60_000 * Math.pow(2, job.attempts)).toISOString(),
      })
      .eq("id", job.id);
    if (result.ok) done++;
  }
  return done;
}

// Sağlayıcı bakiye sorgusunun en az aralığı.
// Gatum REST API: GET /me IP başına 15 dakikada 1 istek (aşarsa 429).
export const PROVIDER_BALANCE_MIN_INTERVAL_MS = 15 * 60_000;

// Sıcak fonksiyon örneğinde başarısız denemelerin de o aralığı zorlaması için
let lastBalanceAttemptAt = 0;

// ana sağlayıcı bakiye kontrolü + eşik altı bildirim
export async function checkProviderBalance(): Promise<number | null> {
  const admin = createAdminClient();
  const provider = await getActiveProvider();

  const { data: settings } = await admin
    .from("provider_settings")
    .select("low_balance_threshold, balance, balance_currency, last_balance_at")
    .eq("provider", provider.name)
    .maybeSingle();

  const cached = settings?.balance != null && Number.isFinite(Number(settings.balance)) ? Number(settings.balance) : null;
  const lastAt = settings?.last_balance_at ? Date.parse(settings.last_balance_at) : 0;
  const recentAttempt = lastBalanceAttemptAt && Date.now() - lastBalanceAttemptAt < PROVIDER_BALANCE_MIN_INTERVAL_MS;
  if ((lastAt && Date.now() - lastAt < PROVIDER_BALANCE_MIN_INTERVAL_MS) || recentAttempt) {
    return cached; // limit penceresi dolmadı: kayıtlı değerle devam
  }

  lastBalanceAttemptAt = Date.now();
  let balance: number;
  let currency: string | null = null;
  try {
    const b = await provider.getBalance();
    balance = b.balance;
    currency = b.currency || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "bilinmeyen hata";
    // 429 (rate limit) normal: sıradaki pencerede tekrar denenir, hata yazma
    if (!msg.includes("BALANCE_RATE_LIMITED")) {
      await admin
        .from("provider_settings")
        .update({ last_error: msg.slice(0, 500) })
        .eq("provider", provider.name);
    }
    return cached;
  }

  await admin
    .from("provider_settings")
    .update({
      balance: String(balance),
      ...(currency ? { balance_currency: currency } : {}),
      last_balance_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("provider", provider.name);

  const threshold = Number(settings?.low_balance_threshold ?? 1000);
  if (balance < threshold) {
    // admin rolündeki tüm kullanıcılara bildirim
    const { data: admins } = await admin
      .from("profiles")
      .select("id, role_id, roles:role_id(name)")
      .limit(200);
    const adminIds = (admins ?? [])
      .filter((p) => ((p.roles as unknown as { name?: string } | null)?.name) === "admin")
      .map((p) => p.id);
    if (adminIds.length) {
      await admin.from("notifications").insert(
        adminIds.map((id) => ({
          user_id: id,
          type: "provider_low_balance",
          title: "Sağlayıcı Bakiyesi Düşük",
          body: `${provider.name} sağlayıcı bakiyesi ${balance}${settings?.balance_currency ? ` ${settings.balance_currency}` : ""} (eşik ${threshold} altına düştü).`,
        }))
      );
    }
  }
  return balance;
}

// ===================== DLR uygulama =====================

export async function applyDlr(providerMessageId: string, state: string, error?: string, time?: string): Promise<RpcResult> {
  try {
    const admin = createAdminClient();
    const { data, error: err } = await admin.rpc("rpc_apply_dlr", {
      p_provider_message_id: providerMessageId,
      p_state: state,
      p_error: error ?? null,
      p_time: time ?? null,
    });
    if (err) return { ok: false, ...mapError(new Error(err.message)) };
    const d = data as Record<string, unknown>;

    // callback kuyruğuna yaz
    if (d.message_id && (d.status === "delivered" || d.status === "failed")) {
      const { data: msg } = await admin
        .from("sms_messages")
        .select("user_id, recipient, order_id")
        .eq("id", String(d.message_id))
        .maybeSingle();
      if (msg) {
        const { data: key } = await admin
          .from("api_keys")
          .select("callback_url")
          .eq("user_id", msg.user_id)
          .eq("status", "active")
          .not("callback_url", "is", null)
          .limit(1)
          .maybeSingle();
        if (key?.callback_url) {
          await admin.from("callback_queue").insert({
            user_id: msg.user_id,
            url: key.callback_url,
            payload: {
              event: d.status === "delivered" ? "message.delivered" : "message.failed",
              message_id: d.message_id,
              order_id: msg.order_id,
              provider_message_id: providerMessageId,
              recipient: msg.recipient,
              status: d.status === "delivered" ? "delivered" : "failed",
            },
          });
        }
      }
    }
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, ...mapError(e) };
  }
}
