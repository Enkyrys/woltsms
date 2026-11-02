import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/security";
import { GatumProvider } from "@/lib/providers/gatum";
import { GenericHttpProvider } from "@/lib/providers/http";
import { getProviderByName } from "@/lib/providers";
import { PROVIDER_BALANCE_MIN_INTERVAL_MS } from "@/lib/services";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";

// Admin ayarları: ödeme (banka/kripto), sağlayıcı, duyuru, sistem, audit
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "payment";

  if (scope === "payment") {
    if (!hasPermissionSync(s, "credit.settings") && !s.isAdmin) return forbidden();
    const [{ data: settings }, { data: banks }, { data: assets }] = await Promise.all([
      admin.from("payment_settings").select("*").limit(1).maybeSingle(),
      admin.from("bank_accounts").select("*").order("sort_order"),
      admin.from("crypto_assets").select("*").order("sort_order"),
    ]);
    return ok({
      settings: {
        minTopupTry: settings?.min_topup_try ?? "100",
        maxTopupTry: settings?.max_topup_try ?? "500000",
        requestTtlMinutes: settings?.request_ttl_minutes ?? 1440,
        maxOpenRequests: settings?.max_open_requests ?? 3,
        bankNote: settings?.bank_note ?? "",
      },
      banks: (banks ?? []).map((b) => ({
        id: b.id,
        bankName: b.bank_name,
        accountHolder: b.account_holder,
        iban: b.iban,
        branch: b.branch,
        isActive: b.is_active,
        sortOrder: b.sort_order,
      })),
      assets: (assets ?? []).map((a) => ({
        id: a.id,
        asset: a.asset,
        network: a.network,
        walletAddress: a.wallet_address,
        memoTag: a.memo_tag,
        rateTry: a.rate_try,
        rateUpdatedAt: a.rate_updated_at,
        minAmountTry: a.min_amount_try,
        isActive: a.is_active,
        sortOrder: a.sort_order,
        explorerTxUrlTemplate: a.explorer_tx_url_template,
      })),
    });
  }

  if (scope === "provider") {
    if (!hasPermissionSync(s, "provider.view") && !s.isAdmin) return forbidden();
    const { data } = await admin
      .from("provider_settings")
      .select("id, provider, base_url, sender_id, is_active, low_balance_threshold, balance, balance_currency, last_balance_at, last_error, config, credentials_encrypted")
      .order("provider");
    return ok(
      (data ?? []).map((p) => ({
        id: p.id,
        provider: p.provider,
        baseUrl: p.base_url,
        senderId: p.sender_id,
        isActive: p.is_active,
        lowBalanceThreshold: p.low_balance_threshold,
        balance: p.balance,
        balanceCurrency: p.balance_currency,
        lastBalanceAt: p.last_balance_at,
        lastError: p.last_error,
        config: p.config,
        hasCredentials: !!p.credentials_encrypted, // yalnız "kayıtlı mı" bilgisi; değer asla dönmez
      }))
    );
  }

  if (scope === "announce") {
    if (!hasPermissionSync(s, "announcement.manage") && !s.isAdmin) return forbidden();
    const { data } = await admin.from("announcements").select("*").order("created_at", { ascending: false });
    return ok((data ?? []).map((a) => ({ id: a.id, text: a.text, isActive: a.is_active })));
  }

  if (scope === "system") {
    if (!hasPermissionSync(s, "settings.view") && !s.isAdmin) return forbidden();
    const { data } = await admin.from("system_settings").select("*").order("key");
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.key] = row.value;
    return ok(map);
  }

  if (scope === "health") {
    if (!s.isAdmin && !hasPermissionSync(s, "settings.view")) return forbidden();
    const [{ error: dbErr }, { count: pendingTopups }, { count: queuedMsgs }, { data: provider }] = await Promise.all([
      admin.from("system_settings").select("key", { head: true, count: "exact" }),
      admin.from("topup_requests").select("id", { head: true, count: "exact" }).eq("status", "pending"),
      admin.from("sms_messages").select("id", { head: true, count: "exact" }).eq("status", "queued"),
      admin.from("provider_settings").select("provider, is_active, balance, balance_currency, last_balance_at, last_error").eq("is_active", true).order("updated_at", { ascending: false }).limit(1).then((r) => ({ data: r.data?.[0] ?? null })),
    ]);
    return ok({
      status: dbErr ? "degraded" : "ok",
      db: dbErr ? dbErr.message : "ok",
      time: new Date().toISOString(),
      pendingTopups: pendingTopups ?? 0,
      queuedMessages: queuedMsgs ?? 0,
      activeProvider: provider?.provider ?? "mock",
      providerBalance: provider?.balance ?? null,
      providerBalanceCurrency: provider?.balance_currency ?? null,
      providerBalanceAt: provider?.last_balance_at ?? null,
      providerLastError: provider?.last_error ?? null,
      workerUrl: process.env.APP_URL ? `${process.env.APP_URL}/api/internal/worker` : "",
      cronConfigured: Boolean(process.env.CRON_SECRET),
    });
  }

  if (scope === "audit") {
    if (!hasPermissionSync(s, "audit.view") && !s.isAdmin) return forbidden();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 20));
    const { count, data } = await admin
      .from("audit_logs")
      .select("*, profiles:actor_id(username)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * perPage, page * perPage - 1);
    return ok(
      (data ?? []).map((a) => ({
        id: a.id,
        action: a.action,
        username: (a.profiles as unknown as { username?: string } | null)?.username ?? "",
        payload: JSON.stringify(a.payload),
        ip: a.ip,
        createdAt: a.created_at,
      })),
      "OK",
      { total: count ?? 0, page, perPage }
    );
  }

  return badRequest("Geçersiz scope.");
}

// POST: ayar güncelleme
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const admin = createAdminClient();

  if (action === "save-payment") {
    if (!hasPermissionSync(s, "credit.settings") && !s.isAdmin) return forbidden();
    const { data: existing } = await admin.from("payment_settings").select("id").limit(1).maybeSingle();
    const payload = {
      min_topup_try: String(body.minTopupTry ?? "100"),
      max_topup_try: String(body.maxTopupTry ?? "500000"),
      request_ttl_minutes: Number(body.requestTtlMinutes ?? 1440),
      max_open_requests: Number(body.maxOpenRequests ?? 3),
      bank_note: String(body.bankNote ?? ""),
    };
    if (existing) {
      await admin.from("payment_settings").update(payload).eq("id", existing.id);
    } else {
      await admin.from("payment_settings").insert(payload);
    }
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "settings.payment", payload: payload as never });
    return ok({ updated: true }, "Ödeme ayarları kaydedildi.");
  }

  if (action === "bank-upsert") {
    if (!hasPermissionSync(s, "credit.settings") && !s.isAdmin) return forbidden();
    const payload = {
      bank_name: String(body.bankName || ""),
      account_holder: String(body.accountHolder || ""),
      iban: String(body.iban || ""),
      branch: body.branch ? String(body.branch) : null,
      is_active: body.isActive !== false,
      sort_order: Number(body.sortOrder ?? 0),
    };
    let id = body.id as string | undefined;
    if (id) {
      await admin.from("bank_accounts").update(payload).eq("id", id);
    } else {
      const { data } = await admin.from("bank_accounts").insert(payload).select("id").single();
      id = data?.id;
    }
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "settings.bank", payload: { id, ...payload } as never });
    return ok({ id }, "Banka hesabı kaydedildi.");
  }

  if (action === "bank-delete") {
    if (!hasPermissionSync(s, "credit.settings") && !s.isAdmin) return forbidden();
    await admin.from("bank_accounts").delete().eq("id", String(body.id));
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "settings.bank_delete", payload: { id: body.id } as never });
    return ok({ deleted: true }, "Silindi.");
  }

  if (action === "crypto-upsert") {
    if (!hasPermissionSync(s, "credit.settings") && !s.isAdmin) return forbidden();
    const payload = {
      asset: String(body.asset || "").toUpperCase(),
      network: String(body.network || "").toUpperCase(),
      wallet_address: String(body.walletAddress || ""),
      memo_tag: body.memoTag ? String(body.memoTag) : null,
      explorer_tx_url_template: String(body.explorerTxUrlTemplate || ""),
      rate_try: String(body.rateTry || "1"),
      rate_updated_at: new Date().toISOString(),
      min_amount_try: String(body.minAmountTry || "100"),
      is_active: body.isActive !== false,
      sort_order: Number(body.sortOrder ?? 0),
    };
    let id = body.id as string | undefined;
    if (id) {
      await admin.from("crypto_assets").update(payload).eq("id", id);
    } else {
      const { data } = await admin.from("crypto_assets").insert(payload).select("id").single();
      id = data?.id;
    }
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "settings.crypto", payload: { id, asset: payload.asset, network: payload.network } as never });
    return ok({ id }, "Kripto varlık kaydedildi.");
  }

  if (action === "crypto-delete") {
    if (!hasPermissionSync(s, "credit.settings") && !s.isAdmin) return forbidden();
    await admin.from("crypto_assets").delete().eq("id", String(body.id));
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "settings.crypto_delete", payload: { id: body.id } as never });
    return ok({ deleted: true }, "Silindi.");
  }

  if (action === "save-provider") {
    if (!hasPermissionSync(s, "provider.manage") && !s.isAdmin) return forbidden();
    const provider = String(body.provider || "");
    if (!provider) return badRequest("provider gerekli.");

    const payload: Record<string, unknown> = {
      base_url: String(body.baseUrl || ""),
      sender_id: String(body.senderId || "WOLTSMS"),
      is_active: body.isActive === true,
      low_balance_threshold: String(body.lowBalanceThreshold ?? "1000"),
      config: (body.config as never) ?? {},
    };
    // kimlik bilgileri yalnız gönderilirse şifrelenir (boşsa korunur)
    if (body.credentials && typeof body.credentials === "object") {
      payload.credentials_encrypted = encrypt(JSON.stringify(body.credentials));
    }
    // aynı anda yalnız tek sağlayıcı aktif olabilir
    if (payload.is_active === true) {
      await admin.from("provider_settings").update({ is_active: false }).neq("provider", provider);
    }
    await admin.from("provider_settings").upsert({ provider, ...payload }, { onConflict: "provider" });
    await admin.from("audit_logs").insert({
      actor_id: s.id,
      action: "settings.provider",
      payload: { provider, isActive: payload.is_active } as never,
    });
    return ok({ saved: true }, "Sağlayıcı ayarı kaydedildi. Kimlik bilgileri şifreli saklandı.");
  }

  // Sağlayıcı bağlantı testi (kaydetmez, aktif etmez).
  // mode: "connection" → ücretsiz doğrulama | "sms" → tek gerçek test SMS'i (ücretlidir)
  if (action === "test-provider") {
    if (!hasPermissionSync(s, "provider.manage") && !s.isAdmin) return forbidden();
    const provider = String(body.provider || "");
    const mode = body.mode === "sms" ? "sms" : "connection";
    const { data: row } = await admin.from("provider_settings").select("*").eq("provider", provider).maybeSingle();

    const typed = (body.credentials && typeof body.credentials === "object" ? body.credentials : {}) as Record<string, string>;
    let saved: Record<string, string> = {};
    try { saved = row?.credentials_encrypted ? JSON.parse(decrypt(row.credentials_encrypted)) : {}; } catch { saved = {}; }
    const creds = { ...saved, ...Object.fromEntries(Object.entries(typed).filter(([, v]) => String(v).trim() !== "")) };
    const baseUrl = String(body.baseUrl || row?.base_url || "https://restapi.sempico.solutions/v1");
    const senderId = String(body.senderId || row?.sender_id || "WOLTSMS");

    let result: { ok: boolean; level: string; message: string; latencyMs?: number; httpStatus?: number; providerMessageId?: string };

    if (provider === "mock") {
      result = { ok: true, level: "success", message: "Mock sağlayıcı: gerçek bağlantı yok, test amaçlıdır.", latencyMs: 0 };
    } else if (provider === "gatum") {
      const gatum = new GatumProvider({ baseUrl, senderId, credentialsJson: JSON.stringify(creds), config: (row?.config ?? {}) as never });
      if (mode === "connection") {
        result = await gatum.testConnection();
      } else {
        const phone = String(body.phone || "").replace(/\D/g, "");
        if (phone.length < 8 || phone.length > 15) return badRequest("Geçerli bir telefon numarası girin (ülke koduyla, örn. 90555...).");
        const started = Date.now();
        const r = await gatum.sendSms(phone, String(body.text || "WOLTSMS test mesaji"));
        result = r.ok
          ? { ok: true, level: "success", latencyMs: Date.now() - started, providerMessageId: r.providerMessageId, message: `Test SMS sağlayıcıya iletildi (id_state: ${r.providerMessageId}).` }
          : { ok: false, level: "error", latencyMs: Date.now() - started, message: `Gönderim reddedildi: ${r.error || r.errorCode}` };
      }
    } else {
      try {
        const started = Date.now();
        const http = GenericHttpProvider.fromEncrypted({ baseUrl, senderId, credentialsEncrypted: row?.credentials_encrypted ?? null, config: (row?.config ?? {}) as never });
        const bal = await http.getBalance();
        result = { ok: true, level: "success", latencyMs: Date.now() - started, message: `Bağlantı başarılı. Bakiye: ${bal.balance} ${bal.currency}` };
      } catch (e) {
        result = { ok: false, level: "error", message: `Test başarısız: ${e instanceof Error ? e.message : "hata"}` };
      }
    }

    // token/telefon loglanmaz
    await admin.from("audit_logs").insert({
      actor_id: s.id,
      action: "provider.test",
      payload: { provider, mode, ok: result.ok, httpStatus: result.httpStatus ?? null } as never,
    });
    return ok(result, result.message);
  }

  // Elle bakiye girişi: API'den okunamayan/okunmak istenmeyen durumlar için yedek yol
  if (action === "set-provider-balance") {
    if (!hasPermissionSync(s, "provider.manage") && !s.isAdmin) return forbidden();
    const provider = String(body.provider || "");
    const balance = Number(body.balance);
    if (!provider || !isFinite(balance) || balance < 0) return badRequest("Geçerli bir bakiye girin.");
    const currency = String(body.currency || "EUR").toUpperCase().slice(0, 5);
    await admin
      .from("provider_settings")
      .update({ balance: String(balance), balance_currency: currency, last_balance_at: new Date().toISOString() })
      .eq("provider", provider);
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "provider.balance_manual", payload: { provider, balance, currency } as never });
    return ok({ balance, currency, refreshed: false }, "Sağlayıcı bakiyesi kaydedildi.");
  }

  // Bakiyeyi sağlayıcı API'sinden çek (Gatum: GET /me → balance_units + currency).
  // Doküman: /me IP başına 15 dakikada 1 istek → bu pencere dolmadan tekrar sorgulanmaz.
  if (action === "refresh-provider-balance") {
    if (!hasPermissionSync(s, "provider.manage") && !s.isAdmin) return forbidden();
    const provider = String(body.provider || "");
    if (!provider) return badRequest("provider gerekli.");
    const { data: row } = await admin.from("provider_settings").select("*").eq("provider", provider).maybeSingle();
    if (!row) return badRequest("Sağlayıcı bulunamadı.");

    const lastAt = row.last_balance_at ? Date.parse(row.last_balance_at) : 0;
    const sinceMs = lastAt ? Date.now() - lastAt : Number.POSITIVE_INFINITY;
    if (body.force !== true && sinceMs < PROVIDER_BALANCE_MIN_INTERVAL_MS) {
      const mins = Math.max(1, Math.ceil((PROVIDER_BALANCE_MIN_INTERVAL_MS - sinceMs) / 60_000));
      return ok(
        { balance: row.balance, currency: row.balance_currency, refreshed: false, lastBalanceAt: row.last_balance_at },
        `Bakiye ${mins} dakika önce sorgulandı; sağlayıcı sınırı (15 dk'da 1 istek) nedeniyle tekrar sorgulanmadı.`
      );
    }

    const instance = await getProviderByName(provider);
    if (!instance) return badRequest("Sağlayıcı yapılandırması bulunamadı.");
    try {
      const b = await instance.getBalance();
      const at = new Date().toISOString();
      await admin
        .from("provider_settings")
        .update({ balance: String(b.balance), balance_currency: b.currency, last_balance_at: at, last_error: null })
        .eq("provider", provider);
      await admin
        .from("audit_logs")
        .insert({ actor_id: s.id, action: "provider.balance_refresh", payload: { provider, balance: b.balance, currency: b.currency } as never });
      return ok(
        { balance: b.balance, currency: b.currency, refreshed: true, lastBalanceAt: at },
        `Bakiye güncellendi: ${b.balance} ${b.currency}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bakiye sorgulanamadı.";
      const limited = msg.includes("BALANCE_RATE_LIMITED");
      if (!limited) {
        await admin.from("provider_settings").update({ last_error: msg.slice(0, 500) }).eq("provider", provider);
      }
      return badRequest(
        limited
          ? "Sağlayıcı istek limiti doldu (15 dakikada 1 istek); lütfen birkaç dakika sonra tekrar deneyin."
          : `Bakiye sorgulanamadı: ${msg}`
      );
    }
  }

  if (action === "set-active-provider") {
    if (!hasPermissionSync(s, "provider.manage") && !s.isAdmin) return forbidden();
    const provider = String(body.provider || "");
    await admin.from("provider_settings").update({ is_active: false }).neq("provider", provider);
    await admin.from("provider_settings").update({ is_active: true }).eq("provider", provider);
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "provider.activate", payload: { provider } as never });
    return ok({ active: provider }, "Aktif sağlayıcı değiştirildi.");
  }

  if (action === "announcement-upsert") {
    if (!hasPermissionSync(s, "announcement.manage") && !s.isAdmin) return forbidden();
    if (body.id) {
      await admin.from("announcements").update({ text: String(body.text || ""), is_active: body.isActive !== false }).eq("id", String(body.id));
    } else {
      await admin.from("announcements").insert({ text: String(body.text || ""), is_active: body.isActive !== false });
    }
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "settings.announcement", payload: {} as never });
    return ok({ saved: true }, "Duyuru kaydedildi.");
  }

  if (action === "announcement-delete") {
    if (!hasPermissionSync(s, "announcement.manage") && !s.isAdmin) return forbidden();
    await admin.from("announcements").delete().eq("id", String(body.id));
    return ok({ deleted: true }, "Silindi.");
  }

  if (action === "system-upsert") {
    if (!hasPermissionSync(s, "settings.manage") && !s.isAdmin) return forbidden();
    const key = String(body.key || "");
    if (!key) return badRequest("key gerekli.");
    await admin
      .from("system_settings")
      .upsert({ key, value: String(body.value ?? "") }, { onConflict: "key" });
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "settings.system", payload: { key } as never });
    return ok({ saved: true }, "Ayar kaydedildi.");
  }

  return badRequest("Geçersiz action.");
}
