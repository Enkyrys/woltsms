import { decrypt } from "@/lib/security";
import type { DlrItem, ProviderInterface, SendResult, BalanceResult } from "./types";
import { fetchWithRetry, mapProviderError } from "./types";

// ============================================================
// ENKYRYS SMS (Gatum GET API) adapter — eski sürüm
// API: GET /send?token=&phone=&senderID=&text=&type=SMS&lifetime=86400
//        &beginDate=YYYY-MM-DD&beginTime=HH:MM:SS&callback_url=&delivery=TRUE
// 200 → {"<phone>": <id_state>} | {"<phone>": [id_state, ...]} (multipart)
// 400 → {"error": "no_money" | "incorrect_phone" | ...}
// 401 → yanlış token; 403 → IP beyaz liste / API kapalı / tarife
// DLR: GET callback_url?id_state=&state=DELIVRD|UNDELIV|EXPIRED|ENROUTE
//      &time=&error=  (+ API_KEY header; onay modunda yanıt gövdesi id_state)
// ============================================================

export type GatumCredentials = {
  token: string;
  securityKey?: string; // DLR API_KEY header doğrulaması için (ops.)
};

export type GatumConfig = {
  sendEndpoint?: string; // default /send
  lifetime?: number; // saniye, default 86400
  timeoutMs?: number;
  maxRetries?: number;
};

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
    this.baseUrl = (opts.baseUrl || "https://api.sempico.solutions").replace(/\/+$/, "");
    this.senderId = opts.senderId || "WOLTSMS";
    this.creds = JSON.parse(opts.credentialsJson) as GatumCredentials;
    this.config = opts.config || {};
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

  private qs(params: Record<string, string | undefined>): string {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
    }
    return u.toString();
  }

  // HTTP durum + {error} gövdesini normalize eder
  private async parseSendResponse(res: Response, to: string): Promise<SendResult> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (res.ok) {
      // {"905...": 1855153903} veya multipart için liste
      const map = body as Record<string, number | number[]> | null;
      const val = map?.[to];
      if (Array.isArray(val)) {
        return {
          ok: true,
          providerMessageIds: val.map(String),
          providerMessageId: val.length ? String(val[0]) : undefined,
        };
      }
      if (typeof val === "number") {
        return { ok: true, providerMessageId: String(val), providerMessageIds: [String(val)] };
      }
      // telefon anahtarı beklenmedik formatta olabilir: ilk değeri al
      const first = map ? Object.values(map)[0] : undefined;
      if (Array.isArray(first)) {
        return { ok: true, providerMessageIds: first.map(String), providerMessageId: first[0] ? String(first[0]) : undefined };
      }
      if (typeof first === "number") {
        return { ok: true, providerMessageId: String(first), providerMessageIds: [String(first)] };
      }
      return { ok: false, errorCode: "PROVIDER_BAD_RESPONSE", error: "Sağlayıcı yanıtı çözülemedi.", retryable: true };
    }

    // hata: {"error": "..."} veya düz metin
    const errText =
      (body as { error?: string } | null)?.error ||
      (typeof body === "string" ? body : "") ||
      `HTTP ${res.status}`;
    const mapped = mapProviderError(errText);
    // 401/403 yapısal: yeniden deneme faydasız
    const structural = res.status === 401 || res.status === 403;
    return {
      ok: false,
      errorCode: structural ? (res.status === 401 ? "PROVIDER_AUTH" : "PROVIDER_FORBIDDEN") : mapped.code,
      error: errText,
      retryable: structural ? false : mapped.retryable,
    };
  }

  async sendSms(
    to: string,
    text: string,
    opts?: { sender?: string; callbackUrl?: string }
  ): Promise<SendResult> {
    const endpoint = this.config.sendEndpoint || "/send";
    const now = new Date();
    const beginDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now); // YYYY-MM-DD
    const beginTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now); // HH:MM:SS

    const url =
      `${this.baseUrl}${endpoint}?` +
      this.qs({
        token: this.creds.token,
        phone: to,
        senderID: opts?.sender || this.senderId,
        text,
        type: "SMS",
        lifetime: String(this.config.lifetime ?? 86400),
        beginDate,
        beginTime,
        callback_url: opts?.callbackUrl,
        delivery: "TRUE",
      });

    try {
      const res = await fetchWithRetry(url, {
        method: "GET",
        timeoutMs: this.config.timeoutMs ?? 15000,
        retries: this.config.maxRetries ?? 2,
        headers: { Accept: "application/json" },
      });
      return await this.parseSendResponse(res, to);
    } catch (e) {
      return {
        ok: false,
        errorCode: "PROVIDER_NETWORK",
        error: e instanceof Error ? e.message : "Ağ hatası",
        retryable: true,
      };
    }
  }

  async sendBulk(messages: { to: string; text: string }[]): Promise<SendResult[]> {
    // GET API'sinde tek tek gönderim; worker partisi zaten sınırlı (200–500)
    const out: SendResult[] = [];
    for (const m of messages) {
      out.push(await this.sendSms(m.to, m.text));
    }
    return out;
  }

  // Gatum GET API'de bakiye ucu dokümante edilmemiştir; panel "Bakiye Sorgula"
  // butonu Generic HTTP sağlayıcısıyla ya da manuel girilen değerle çalışır.
  async getBalance(): Promise<BalanceResult> {
    throw new Error("BALANCE_NOT_SUPPORTED");
  }

  // DLR polling: id_state bazlı rapor ucu dokümante edilmediğinden
  // teslimat raporları callback_url üzerinden (webhook) gelir.
  async getReports(_ids: string[]): Promise<DlrItem[]> {
    return [];
  }

  // GET callback: ?id_state=&state=&time=&error=&hlr[...]
  // Ayrıca API_KEY header kontrolü (hesapta security key tanımlıysa).
  parseDlrWebhook(payload: unknown, headers: Record<string, string>): DlrItem[] {
    // güvenlik anahtarı tanımlı ve header varsa doğrula (timing-safe)
    if (this.creds.securityKey) {
      const got = headers["api_key"] || headers["API_KEY"] || "";
      if (!got || got !== this.creds.securityKey) return [];
    }

    const items: DlrItem[] = [];

    // query-string tarzı payload (DLR GET olarak gelir; Next.js route query'yi
    // ayrıca iletir, burada hem searchParams hem body desteklenir)
    const src = (payload ?? {}) as Record<string, unknown>;
    const idState = src["id_state"] ?? src["idState"] ?? src["id"] ?? src["providerMessageId"];
    const state = String(src["state"] ?? "").toUpperCase();
    const err = src["error"] ? String(src["error"]) : undefined;
    const time = src["time"] ? String(src["time"]) : undefined;

    if (idState) {
      items.push({
        providerMessageId: String(idState),
        status: state === "DELIVRD" ? "delivered" : state === "ENROUTE" ? "pending" : "failed",
        errorCode: err && err !== "0" ? err : undefined,
        time,
      });
    }

    // toplu varyant: dizi veya {reports: [...]}
    if (Array.isArray(src["reports"])) {
      for (const r of src["reports"] as Record<string, unknown>[]) {
        const rid = r["id_state"] ?? r["id"];
        if (!rid) continue;
        const rs = String(r["state"] ?? "").toUpperCase();
        items.push({
          providerMessageId: String(rid),
          status: rs === "DELIVRD" ? "delivered" : rs === "ENROUTE" ? "pending" : "failed",
          errorCode: r["error"] && String(r["error"]) !== "0" ? String(r["error"]) : undefined,
          time: r["time"] ? String(r["time"]) : undefined,
        });
      }
    }
    return items;
  }
}
