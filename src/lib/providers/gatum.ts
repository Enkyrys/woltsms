import { decrypt, timingSafeEqualStr } from "@/lib/security";
import type { DlrItem, ProviderInterface, SendResult, BalanceResult, SendOptions } from "./types";
import { PROVIDER_TZ, providerSchedule } from "@/lib/timezone";
import { fetchWithRetry, mapProviderError } from "./types";

// ============================================================
// Gatum SMS — REST API v1 (9.20.0)
// Base: https://restapi.sempico.solutions/v1
//
// Kimlik doğrulama (OAuth 2.0 benzeri, 2 adım):
//   POST /authorize     {username,password}      → {authorization_code, expires_at}
//   POST /access-token  {authorization_code}     → {access_token, expires_at}
//   Sonraki TÜM isteklerde header: X-Access-Token
//
// Gönderim:  POST /send  → gövde JSON DİZİSİ (istek başına en fazla 100 SMS)
//   paket alanları: number[], senderID, text, type, beginDate (YYYY-MM-DD),
//   beginTime (HH:MM), lifetime, delivery, campaign, callback_url
//   ÖNEMLİ: sağlayıcı İngiltere'dedir ve beginDate/beginTime'ı UTC saatiyle yorumlar
//   (Sempico paneli saati UTC'dir). Kullanıcının seçtiği an burada UTC'ye çevrilerek
//   iletilir: UTC+4'te 10:02 → 06:02, Türkiye'de (UTC+3) 10:02 → 07:02.
//   config.timezone ile değiştirilebilir (ör. "Europe/London").
//   yanıt: {"status":true,"data":{"<phone>":[{"id_state":123}]}}
//   hata : {"status":false,"error_code":400,"errors":"..."}  (veya numara bazlı {"error":"..."})
// Bakiye:    GET /me   → data.balance_units + data.currency  (IP başına 15 dk'da 1 istek!)
// Bağlantı:  POST /replacement (ücretsiz, SMS göndermez)
// DLR:       callback_url'e POST edilen JSON DİZİSİ + API_KEY header
//            (onay modunda yanıt: onaylanan id_state'lerden oluşan JSON dizisi)
// ============================================================

export type GatumCredentials = {
  username?: string; // Gatum/Sempico hesap girişi
  password?: string;
  /** Doğrudan girilmiş access token (opsiyonel; yoksa username/password ile alınır) */
  accessToken?: string;
  /** Eski panel kayıtlarındaki adlandırma; accessToken okunamazsa kullanılır */
  token?: string;
  /** DLR isteklerinde API_KEY header'ı olarak gelir (opsiyonel) */
  securityKey?: string;
};

export type ConnectionTestResult = {
  ok: boolean;
  level: "success" | "warning" | "error";
  httpStatus?: number;
  latencyMs: number;
  message: string;
  detail?: unknown;
};

export type GatumConfig = {
  sendEndpoint?: string; // default /send
  authEndpoint?: string; // default /authorize
  tokenEndpoint?: string; // default /access-token
  balanceEndpoint?: string; // default /me
  replacementEndpoint?: string; // default /replacement
  campaign?: string; // istatistik grubu (default WOLTSMS)
  type?: string; // sms | flashsms | wappush | vcard | hlr | mnp (default sms)
  lifetime?: number; // saniye, default 86400
  timezone?: string; // sağlayıcının saat dilimi (beginDate/beginTime), default UTC
  sendSchedule?: boolean; // false → beginDate/beginTime gönderilmez (default true)
  timeoutMs?: number;
  maxRetries?: number;
};

type Envelope = { status?: boolean; data?: unknown; error_code?: number; errors?: unknown };
type ApiResponse = { status: number; json: unknown };
type CachedToken = { accessToken: string; expiresAtMs: number };

// Token'lar istemci nesnesiyle taşınmaz (her çağrıda yeni nesne kurulur);
// sıcak fonksiyon örnekleri arasında token'ı burada paylaşıyoruz.
const tokenCache = new Map<string, CachedToken>();
const TOKEN_SAFETY_MS = 60_000; // expires_at'ten 1 sn değil 60 sn önce yenile
const TOKEN_FALLBACK_TTL_MS = 10 * 60_000; // expires_at okunamazsa

export function clearGatumTokenCache(): void {
  tokenCache.clear();
}

function envelope(json: unknown): Envelope {
  return json && typeof json === "object" ? (json as Envelope) : {};
}

function errorText(json: unknown): string {
  const e = envelope(json).errors;
  if (Array.isArray(e)) return e.map(String).join("; ");
  if (typeof e === "string" && e.trim()) return e.trim();
  const alt = (json as { error?: unknown } | null)?.error;
  if (typeof alt === "string" && alt.trim()) return alt.trim();
  return "";
}

function parseExpiresAt(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v.includes("T") ? v : v.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

// provider_settings.config panelden snake_case (send_endpoint, timeout_ms...)
// olarak yazılır; burada GatumConfig'in camelCase alanlarına eşlenir.
function normalizeConfig(raw: Record<string, unknown> | undefined): GatumConfig {
  const c = raw ?? {};
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (c[k] !== undefined && c[k] !== null && c[k] !== "") return c[k];
    }
    return undefined;
  };
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  return {
    sendEndpoint: str(pick("sendEndpoint", "send_endpoint")),
    authEndpoint: str(pick("authEndpoint", "auth_endpoint")),
    tokenEndpoint: str(pick("tokenEndpoint", "token_endpoint")),
    balanceEndpoint: str(pick("balanceEndpoint", "balance_endpoint")),
    replacementEndpoint: str(pick("replacementEndpoint", "replacement_endpoint")),
    campaign: str(pick("campaign")),
    type: str(pick("type")),
    lifetime: num(pick("lifetime")),
    timezone: str(pick("timezone", "provider_timezone", "time_zone")),
    sendSchedule: (() => {
      const v = pick("sendSchedule", "send_schedule");
      if (v === undefined) return undefined;
      return !(v === false || v === "false" || v === 0 || v === "0");
    })(),
    timeoutMs: num(pick("timeoutMs", "timeout_ms")),
    maxRetries: num(pick("maxRetries", "max_retries")),
  };
}

export class GatumProvider implements ProviderInterface {
  name = "gatum";
  private baseUrl: string;
  private senderId: string;
  private creds: GatumCredentials;
  private config: GatumConfig;

  constructor(opts: {
    baseUrl: string;
    senderId: string;
    credentialsJson: string; // decrypt() edilmiş JSON
    config?: GatumConfig;
  }) {
    this.baseUrl = (opts.baseUrl || "https://restapi.sempico.solutions/v1").replace(/\/+$/, "");
    this.senderId = opts.senderId || "WOLTSMS";
    try {
      this.creds = JSON.parse(opts.credentialsJson || "{}") as GatumCredentials;
    } catch {
      this.creds = {};
    }
    this.config = normalizeConfig(opts.config as unknown as Record<string, unknown> | undefined);
  }

  // provider_settings.credentials_encrypted → çözülmüş JSON
  static fromEncrypted(opts: {
    baseUrl: string;
    senderId: string;
    credentialsEncrypted: string | null;
    config?: GatumConfig;
  }): GatumProvider {
    const json = opts.credentialsEncrypted ? decrypt(opts.credentialsEncrypted) : "{}";
    return new GatumProvider({
      baseUrl: opts.baseUrl,
      senderId: opts.senderId,
      credentialsJson: json,
      config: opts.config,
    });
  }

  // ---------------- ortak HTTP ----------------

  private async api(
    path: string,
    init: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number; retries?: number } = {}
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.token) headers["X-Access-Token"] = init.token;

    const res = await fetchWithRetry(`${this.baseUrl}${path}`, {
      method: init.method || "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      timeoutMs: init.timeoutMs ?? this.config.timeoutMs ?? 15000,
      retries: init.retries ?? this.config.maxRetries ?? 2,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  // ---------------- token (OAuth 2.0) ----------------

  private authKey(): string {
    return `${this.baseUrl}|${(this.creds.username || "").trim()}`;
  }

  private staticToken(): string | null {
    const t = (this.creds.accessToken || this.creds.token || "").trim();
    return t || null;
  }

  private invalidateToken(): void {
    tokenCache.delete(this.authKey());
  }

  private async getAccessToken(opts: { force?: boolean } = {}): Promise<string> {
    const fixed = this.staticToken();
    if (fixed && !opts.force) return fixed;

    const username = (this.creds.username || "").trim();
    const password = this.creds.password || "";
    if (!username || !password) {
      if (fixed) return fixed;
      throw new Error("Gatum kimlik bilgileri eksik: kullanıcı adı/şifre veya access token tanımlı değil.");
    }

    const key = this.authKey();
    if (!opts.force) {
      const cached = tokenCache.get(key);
      if (cached && cached.expiresAtMs - TOKEN_SAFETY_MS > Date.now()) return cached.accessToken;
    }

    const auth = await this.api(this.config.authEndpoint || "/authorize", {
      method: "POST",
      body: { username, password },
      retries: 0,
      timeoutMs: 15000,
    });
    if (auth.status === 403) {
      throw new Error(`Erişim reddedildi (403): ${errorText(auth.json) || "hesapta REST API kapalı."}`);
    }
    if (auth.status !== 200) {
      throw new Error(errorText(auth.json) || `Kimlik doğrulama başarısız (HTTP ${auth.status}).`);
    }
    const code = (envelope(auth.json).data as { authorization_code?: string } | null)?.authorization_code;
    if (!code) throw new Error("/authorize yanıtında authorization_code yok.");

    const tok = await this.api(this.config.tokenEndpoint || "/access-token", {
      method: "POST",
      body: { authorization_code: code },
      retries: 0,
      timeoutMs: 15000,
    });
    if (tok.status !== 200) {
      throw new Error(errorText(tok.json) || `Token alınamadı (HTTP ${tok.status}).`);
    }
    const data = envelope(tok.json).data as { access_token?: string; expires_at?: string } | null;
    const accessToken = data?.access_token;
    if (!accessToken) throw new Error("/access-token yanıtında access_token yok.");

    const parsed = parseExpiresAt(data?.expires_at);
    const expiresAtMs = parsed
      ? Math.min(parsed, Date.now() + TOKEN_FALLBACK_TTL_MS)
      : Date.now() + TOKEN_FALLBACK_TTL_MS;
    tokenCache.set(key, { accessToken, expiresAtMs });
    return accessToken;
  }

  // ---------------- gönderim ----------------

  /** Sağlayıcıya iletilecek planlı gönderim alanları (varsayılan UTC = Sempico saati). */
  scheduleFields(sendAt?: Date | string | null): { beginDate: string; beginTime: string } | Record<string, never> {
    if (this.config.sendSchedule === false) return {};
    const { beginDate, beginTime } = providerSchedule(sendAt ?? null, this.config.timezone || PROVIDER_TZ);
    return { beginDate, beginTime };
  }

  buildPackage(
    numbers: string[],
    text: string,
    opts?: SendOptions
  ): Record<string, unknown> {
    return {
      number: numbers,
      senderID: opts?.sender || this.senderId,
      text,
      type: this.config.type || "sms",
      ...this.scheduleFields(opts?.sendAt),
      lifetime: this.config.lifetime ?? 86400,
      delivery: true,
      campaign: this.config.campaign || "WOLTSMS",
      ...(opts?.callbackUrl ? { callback_url: opts.callbackUrl } : {}),
    };
  }

  private pickEntry(map: Record<string, unknown>, to: string): unknown {
    if (Object.prototype.hasOwnProperty.call(map, to)) return map[to];
    const norm = (s: string) => String(s).replace(/\D/g, "").replace(/^0+/, "");
    const target = norm(to);
    if (target) {
      for (const [k, v] of Object.entries(map)) {
        if (norm(k) === target) return v;
      }
    }
    const keys = Object.keys(map);
    if (keys.length === 1) return map[keys[0]];
    return undefined;
  }

  // [{"id_state":123}] | [{"error":"no_money"}] | [123] | 123
  private normalizeParts(entry: unknown): { ids: string[]; error?: string } {
    if (entry === undefined || entry === null) return { ids: [] };
    const items = Array.isArray(entry) ? entry : [entry];
    const ids: string[] = [];
    let error: string | undefined;
    for (const item of items) {
      if (item && typeof item === "object") {
        const o = item as { id_state?: unknown; id?: unknown; error?: unknown };
        if (o.id_state !== undefined && o.id_state !== null) ids.push(String(o.id_state));
        else if (o.id !== undefined && o.id !== null) ids.push(String(o.id));
        else if (o.error) error = String(o.error);
      } else if (typeof item === "number") {
        ids.push(String(item));
      } else if (typeof item === "string" && item.trim()) {
        // düz metin ya da hata kodu
        if (/^\d+$/.test(item.trim())) ids.push(item.trim());
        else error = item.trim();
      }
    }
    return error && ids.length === 0 ? { ids: [], error } : { ids };
  }

  private parseSendResponse(res: ApiResponse, to: string): SendResult {
    const { status, json } = res;

    if (status === 401) {
      return { ok: false, errorCode: "PROVIDER_AUTH", error: errorText(json) || "Geçersiz veya süresi dolmuş access token.", retryable: false };
    }
    if (status === 403) {
      return { ok: false, errorCode: "PROVIDER_FORBIDDEN", error: errorText(json) || "Erişim reddedildi (IP beyaz liste / REST API kapalı).", retryable: false };
    }
    if (status === 429) {
      return { ok: false, errorCode: "PROVIDER_RATE_LIMIT", error: errorText(json) || "Sağlayıcı istek limiti aşıldı (429).", retryable: true };
    }

    const env = envelope(json);
    if (status >= 400 || env.status === false) {
      const text = errorText(json) || `HTTP ${status}`;
      const mapped = mapProviderError(text);
      return { ok: false, errorCode: mapped.code, error: text, retryable: status >= 500 ? true : mapped.retryable };
    }

    const data = env.data;
    if (!data || typeof data !== "object") {
      return { ok: false, errorCode: "PROVIDER_BAD_RESPONSE", error: "Sağlayıcı yanıtı çözülemedi.", retryable: true };
    }

    const entry = this.pickEntry(data as Record<string, unknown>, to);
    const parts = this.normalizeParts(entry);
    if (parts.ids.length) {
      return { ok: true, providerMessageId: parts.ids[0], providerMessageIds: parts.ids };
    }
    const mapped = mapProviderError(parts.error || "");
    return {
      ok: false,
      errorCode: mapped.code,
      error: parts.error || "Sağlayıcı yanıtında sonuç bulunamadı.",
      retryable: mapped.retryable,
    };
  }

  async sendSms(
    to: string,
    text: string,
    opts?: SendOptions
  ): Promise<SendResult> {
    const endpoint = this.config.sendEndpoint || "/send";
    const payload = [this.buildPackage([to], text, opts)];

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (e) {
      return { ok: false, errorCode: "PROVIDER_AUTH", error: e instanceof Error ? e.message : "Kimlik doğrulama hatası", retryable: false };
    }

    let res: ApiResponse;
    try {
      // POST'ta fazladan deneme yinelenen gönderim üretir: tek deneme
      res = await this.api(endpoint, { method: "POST", body: payload, token, retries: 1 });
    } catch (e) {
      return { ok: false, errorCode: "PROVIDER_NETWORK", error: e instanceof Error ? e.message : "Ağ hatası", retryable: true };
    }

    // token'ın süresi dolmuş/iptal edilmişse yenileyip bir kez daha dene
    if (res.status === 401 && !this.staticToken()) {
      this.invalidateToken();
      try {
        token = await this.getAccessToken({ force: true });
        res = await this.api(endpoint, { method: "POST", body: payload, token, retries: 1 });
      } catch (e) {
        return { ok: false, errorCode: "PROVIDER_AUTH", error: e instanceof Error ? e.message : "Token yenileme hatası", retryable: false };
      }
    }

    return this.parseSendResponse(res, to);
  }

  // Doküman: istek başına en fazla 100 SMS; istekler eşzamanlı değil, senkron gönderilmeli.
  async sendBulk(messages: { to: string; text: string; sendAt?: Date | string | null }[]): Promise<SendResult[]> {
    const out: SendResult[] = new Array(messages.length);
    const CHUNK = 100;

    for (let i = 0; i < messages.length; i += CHUNK) {
      const slice = messages.slice(i, i + CHUNK);
      const unique = new Set(slice.map((m) => m.to));
      if (unique.size !== slice.length) {
        // aynı numaraya iki paket aynı yanıt anahtarında çakışır → tek tek gönder
        for (let j = 0; j < slice.length; j++) {
          out[i + j] = await this.sendSms(slice[j].to, slice[j].text, { sendAt: slice[j].sendAt });
        }
        continue;
      }
      const chunkResults = await this.postPackages(slice);
      for (let j = 0; j < slice.length; j++) out[i + j] = chunkResults[j];
    }
    return out;
  }

  private async postPackages(slice: { to: string; text: string; sendAt?: Date | string | null }[]): Promise<SendResult[]> {
    const endpoint = this.config.sendEndpoint || "/send";
    const payload = slice.map((m) => this.buildPackage([m.to], m.text, { sendAt: m.sendAt }));

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (e) {
      const err = { ok: false, errorCode: "PROVIDER_AUTH", error: e instanceof Error ? e.message : "Kimlik doğrulama hatası", retryable: false } as const;
      return slice.map(() => ({ ...err }));
    }

    let res: ApiResponse;
    try {
      res = await this.api(endpoint, { method: "POST", body: payload, token, retries: 1 });
    } catch (e) {
      const err = { ok: false, errorCode: "PROVIDER_NETWORK", error: e instanceof Error ? e.message : "Ağ hatası", retryable: true } as const;
      return slice.map(() => ({ ...err }));
    }

    if (res.status === 401 && !this.staticToken()) {
      this.invalidateToken();
      try {
        token = await this.getAccessToken({ force: true });
        res = await this.api(endpoint, { method: "POST", body: payload, token, retries: 1 });
      } catch (e) {
        const err = { ok: false, errorCode: "PROVIDER_AUTH", error: e instanceof Error ? e.message : "Token yenileme hatası", retryable: false } as const;
        return slice.map(() => ({ ...err }));
      }
    }

    return slice.map((m) => this.parseSendResponse(res, m.to));
  }

  // ---------------- bakiye (GET /me) ----------------

  // Dikkat: /me IP başına 15 dakikada 1 istekle sınırlı.
  // checkProviderBalance bu yüzden last_balance_at'a bakarak çağırır.
  async getBalance(): Promise<BalanceResult> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (e) {
      throw new Error(`BALANCE_AUTH: ${e instanceof Error ? e.message : "kimlik hatası"}`);
    }

    let res: ApiResponse;
    try {
      res = await this.api(this.config.balanceEndpoint || "/me", { token, retries: 0, timeoutMs: 10000 });
    } catch (e) {
      throw new Error(`BALANCE_NETWORK: ${e instanceof Error ? e.message : "ağ hatası"}`);
    }

    if (res.status === 429) throw new Error("BALANCE_RATE_LIMITED");

    if (res.status === 401 && !this.staticToken()) {
      this.invalidateToken();
      try {
        token = await this.getAccessToken({ force: true });
        res = await this.api(this.config.balanceEndpoint || "/me", { token, retries: 0, timeoutMs: 10000 });
      } catch {
        throw new Error("BALANCE_AUTH");
      }
      if (res.status === 429) throw new Error("BALANCE_RATE_LIMITED");
    }

    if (res.status === 401) {
      throw new Error(`BALANCE_AUTH${errorText(res.json) ? `: ${errorText(res.json)}` : ""}`);
    }
    if (res.status !== 200) {
      throw new Error(`BALANCE_HTTP_${res.status}${errorText(res.json) ? `: ${errorText(res.json)}` : ""}`);
    }

    const data = envelope(res.json).data as { balance_units?: unknown; currency?: unknown } | null;
    if (!data || typeof data !== "object") throw new Error("BALANCE_BAD_RESPONSE");
    const balance = Number(data.balance_units);
    if (!Number.isFinite(balance)) throw new Error("BALANCE_BAD_RESPONSE");
    return { balance, currency: String(data.currency || "TRY") };
  }

  // ---------------- bağlantı testi ----------------

  // SMS göndermez ve ücret yazmaz: /authorize + /access-token ile kimlik,
  // ardından /replacement ile token + IP beyaz liste + REST API yetkisi doğrulanır.
  async testConnection(opts?: { phone?: string; text?: string }): Promise<ConnectionTestResult> {
    const started = Date.now();
    const hasCreds = Boolean(((this.creds.username || "").trim() && this.creds.password) || this.staticToken());
    if (!hasCreds) {
      return { ok: false, level: "error", latencyMs: 0, message: "Kullanıcı adı/şifre veya access token girilmemiş." };
    }

    let token: string;
    try {
      token = await this.getAccessToken({ force: true }); // her manuel test gerçek kimlik doğrulaması yapsın
    } catch (e) {
      return { ok: false, level: "error", latencyMs: Date.now() - started, message: e instanceof Error ? e.message : "Kimlik doğrulama hatası." };
    }

    const phone = String(opts?.phone || "905000000000").replace(/\D/g, "");
    try {
      const res = await this.api(this.config.replacementEndpoint || "/replacement", {
        method: "POST",
        body: [{ number: [phone], senderID: this.senderId, text: opts?.text || "WOLTSMS baglanti testi" }],
        token,
        retries: 0,
        timeoutMs: 10000,
      });
      const latencyMs = Date.now() - started;
      const detail = res.json;

      if (res.status === 200) {
        return { ok: true, level: "success", httpStatus: 200, latencyMs, message: "Bağlantı başarılı: token doğrulandı, REST API erişimi açık.", detail };
      }
      if (res.status === 401) {
        return { ok: false, level: "error", httpStatus: 401, latencyMs, message: "Access token geçersiz, süresi dolmuş veya iptal edilmiş (401).", detail };
      }
      if (res.status === 403) {
        return { ok: false, level: "error", httpStatus: 403, latencyMs, message: `Erişim reddedildi (403): ${errorText(detail) || "IP beyaz listede değil ya da hesapta/tarifede REST API kapalı."}`, detail };
      }
      if (res.status === 429) {
        return { ok: false, level: "warning", httpStatus: 429, latencyMs, message: "Sağlayıcı istek limiti aşıldı (429); biraz sonra tekrar deneyin.", detail };
      }
      if (res.status === 400) {
        return { ok: true, level: "warning", httpStatus: 400, latencyMs, message: `Token doğrulandı, test isteği reddedildi: ${errorText(detail) || "bilinmeyen neden"}. Gerçek gönderimde sorun olmayabilir.`, detail };
      }
      return { ok: false, level: "error", httpStatus: res.status, latencyMs, message: `Beklenmeyen yanıt (HTTP ${res.status}).`, detail };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        ok: false,
        level: "error",
        latencyMs: Date.now() - started,
        message: aborted
          ? "Zaman aşımı: sağlayıcıya süresinde ulaşılamadı."
          : `Sağlayıcıya ulaşılamadı: ${e instanceof Error ? e.message : "ağ hatası"}`,
      };
    }
  }

  // ---------------- DLR ----------------

  // Teslimat raporları webhook (callback_url) üzerinden gelir;
  // /sms-full-data IP başına 15 dakikada 1 istekle sınırlı olduğundan polling kullanılmaz.
  async getReports(_ids: string[]): Promise<DlrItem[]> {
    return [];
  }

  private mapState(state: string): DlrItem["status"] {
    const s = String(state || "").toUpperCase();
    if (s === "DELIVRD" || s === "DELIVERD" || s === "DELIVERED") return "delivered";
    if (s === "UNDELIV" || s === "EXPIRED" || s === "UNDELIVERED" || s === "DELETED" || s === "REJECTD") return "failed";
    return "pending";
  }

  private toItem(r: Record<string, unknown>): DlrItem | null {
    const id = r["id_state"] ?? r["idState"] ?? r["id"] ?? r["providerMessageId"];
    if (id === undefined || id === null || id === "") return null;
    const err = r["error"];
    return {
      providerMessageId: String(id),
      status: this.mapState(String(r["state"] ?? "")),
      errorCode: err !== undefined && err !== null && String(err) !== "0" ? String(err) : undefined,
      time: r["time"] ? String(r["time"]) : undefined,
    };
  }

  // DLR: callback_url'e POST edilen JSON dizisi
  //   [{id_state, originator, phone, type_sms, text_sms, num_parts, part_no, state, time, price?, error?, hlr?}]
  // Eski tekil nesne / {reports:[...]} varyantları da desteklenir.
  parseDlrWebhook(payload: unknown, headers: Record<string, string>): DlrItem[] {
    // hesapta güvenlik anahtarı tanımlıysa API_KEY header'ı zorunlu (timing-safe)
    if (this.creds.securityKey) {
      const got = headers["api_key"] || "";
      if (!got || !timingSafeEqualStr(this.creds.securityKey, got)) return [];
    }

    const items: DlrItem[] = [];

    const push = (v: unknown) => {
      if (Array.isArray(v)) {
        for (const r of v) {
          const item = this.toItem((r ?? {}) as Record<string, unknown>);
          if (item) items.push(item);
        }
        return true;
      }
      if (v && typeof v === "object") {
        const item = this.toItem(v as Record<string, unknown>);
        if (item) items.push(item);
        return true;
      }
      return false;
    };

    if (Array.isArray(payload)) {
      push(payload);
      return items;
    }

    const src = (payload ?? {}) as Record<string, unknown>;
    if (Array.isArray(src["reports"])) push(src["reports"]);
    else if (Array.isArray(src["data"])) push(src["data"]);
    else push(src);

    return items;
  }
}
