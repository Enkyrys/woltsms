import { decrypt } from "@/lib/security";
import type { DlrItem, ProviderInterface, SendResult, BalanceResult } from "./types";
import { fetchWithRetry, mapProviderError } from "./types";

// Generic HTTP SMS sağlayıcısı: admin panelinde uçlar/şablonlar tanımlanır.
// config: {
//   send_endpoint: "/sms/send",
//   method: "POST" | "GET",
//   send_body_template: {"to":"{{to}}","text":"{{text}}","sender":"{{sender}}"},
//   send_query_template: {...} (GET ise)
//   id_path: "data.id",          // yanıtten mesaj id'sinin yolu
//   ok_path: "success",          // true/false yolu (opsiyonel)
//   balance_endpoint, balance_path, balance_currency
//   auth_header: "Authorization", auth_value_template: "Bearer {{apiKey}}"
//   dlr_id_path: "id", dlr_status_path: "status",
//   dlr_map: {"delivered":"delivered","failed":"failed","sent":"sent"}
// }
export type GenericHttpConfig = {
  send_endpoint?: string;
  method?: "GET" | "POST";
  send_body_template?: Record<string, unknown>;
  send_query_template?: Record<string, unknown>;
  id_path?: string;
  ok_path?: string;
  error_path?: string;
  balance_endpoint?: string;
  balance_path?: string;
  balance_currency?: string;
  auth_header?: string;
  auth_value_template?: string;
  dlr_id_path?: string;
  dlr_status_path?: string;
  dlr_map?: Record<string, "delivered" | "failed" | "pending">;
  timeout_ms?: number;
  max_retries?: number;
};

function fill(template: unknown, vars: Record<string, string>): unknown {
  if (typeof template === "string") {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
  }
  if (Array.isArray(template)) return template.map((t) => fill(t, vars));
  if (template && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) out[k] = fill(v, vars);
    return out;
  }
  return template;
}

function getPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export class GenericHttpProvider implements ProviderInterface {
  name = "http";
  private baseUrl: string;
  private senderId: string;
  private config: GenericHttpConfig;
  private creds: Record<string, string>;

  constructor(opts: {
    baseUrl: string;
    senderId: string;
    credentialsJson: string;
    config?: GenericHttpConfig;
  }) {
    this.baseUrl = (opts.baseUrl || "").replace(/\/+$/, "");
    this.senderId = opts.senderId || "WOLTSMS";
    try {
      this.creds = JSON.parse(opts.credentialsJson || "{}");
    } catch {
      this.creds = {};
    }
    this.config = opts.config || {};
  }

  static fromEncrypted(opts: {
    baseUrl: string;
    senderId: string;
    credentialsEncrypted: string | null;
    config?: GenericHttpConfig;
  }): GenericHttpProvider {
    const json = opts.credentialsEncrypted ? decrypt(opts.credentialsEncrypted) : "{}";
    return new GenericHttpProvider({ baseUrl: opts.baseUrl, senderId: opts.senderId, credentialsJson: json, config: opts.config });
  }

  private vars(extra: Record<string, string> = {}): Record<string, string> {
    return { sender: this.senderId, ...this.creds, ...extra };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.config.auth_header && this.config.auth_value_template) {
      h[this.config.auth_header] = String(fill(this.config.auth_value_template, this.vars()));
    }
    return h;
  }

  async sendSms(to: string, text: string): Promise<SendResult> {
    const endpoint = this.config.send_endpoint || "/sms/send";
    const method = this.config.method || "POST";
    const vars = this.vars({ to, text });
    let url = `${this.baseUrl}${endpoint}`;
    let body: string | undefined;

    if (method === "GET") {
      const q = new URLSearchParams();
      const tpl = (this.config.send_query_template || { to: "{{to}}", text: "{{text}}" }) as Record<string, unknown>;
      for (const [k, v] of Object.entries(tpl)) q.set(k, String(fill(v, vars)));
      url += `?${q.toString()}`;
    } else {
      body = JSON.stringify(fill(this.config.send_body_template || { to, text, sender: this.senderId }, vars));
    }

    try {
      const res = await fetchWithRetry(url, {
        method,
        body,
        headers: this.headers(),
        timeoutMs: this.config.timeout_ms ?? 15000,
        retries: this.config.max_retries ?? 2,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (!res.ok) {
        const errText = (json as { error?: string; message?: string } | null)?.error ||
          (json as { message?: string } | null)?.message || `HTTP ${res.status}`;
        const mapped = mapProviderError(errText);
        return { ok: false, errorCode: mapped.code, error: errText, retryable: res.status >= 500 ? true : mapped.retryable };
      }

      if (this.config.ok_path) {
        const okVal = getPath(json, this.config.ok_path);
        if (okVal === false || okVal === 0 || okVal === "false") {
          const errText = String(getPath(json, this.config.error_path || "error") ?? "Sağlayıcı hatası");
          const mapped = mapProviderError(errText);
          return { ok: false, errorCode: mapped.code, error: errText, retryable: mapped.retryable };
        }
      }

      const id = getPath(json, this.config.id_path || "id");
      if (id === undefined || id === null) {
        return { ok: false, errorCode: "PROVIDER_BAD_RESPONSE", error: "Mesaj ID'si yanıtta bulunamadı.", retryable: false };
      }
      return { ok: true, providerMessageId: String(id) };
    } catch (e) {
      return { ok: false, errorCode: "PROVIDER_NETWORK", error: e instanceof Error ? e.message : "Ağ hatası", retryable: true };
    }
  }

  async sendBulk(messages: { to: string; text: string }[]): Promise<SendResult[]> {
    const out: SendResult[] = [];
    for (const m of messages) out.push(await this.sendSms(m.to, m.text));
    return out;
  }

  async getBalance(): Promise<BalanceResult> {
    if (!this.config.balance_endpoint) throw new Error("BALANCE_NOT_SUPPORTED");
    const res = await fetchWithRetry(`${this.baseUrl}${this.config.balance_endpoint}`, {
      headers: this.headers(),
      timeoutMs: this.config.timeout_ms ?? 15000,
      retries: 1,
    });
    if (!res.ok) throw new Error(`BALANCE_HTTP_${res.status}`);
    const json = await res.json();
    const bal = getPath(json, this.config.balance_path || "balance");
    return { balance: Number(bal ?? 0), currency: this.config.balance_currency || "TRY" };
  }

  async getReports(_ids: string[]): Promise<DlrItem[]> {
    return [];
  }

  parseDlrWebhook(payload: unknown, _headers: Record<string, string>): DlrItem[] {
    const idPath = this.config.dlr_id_path || "id";
    const statusPath = this.config.dlr_status_path || "status";
    const map = this.config.dlr_map || { delivered: "delivered", success: "delivered", failed: "failed", undelivered: "failed" };

    const one = (obj: unknown): DlrItem | null => {
      const id = getPath(obj, idPath);
      if (id === undefined || id === null) return null;
      const st = String(getPath(obj, statusPath) ?? "").toLowerCase();
      const mapped = map[st] || (["delivered", "failed", "pending"].includes(st) ? (st as "delivered" | "failed" | "pending") : "pending");
      return { providerMessageId: String(id), status: mapped };
    };

    if (Array.isArray(payload)) return payload.map(one).filter(Boolean) as DlrItem[];
    const single = one(payload);
    if (single) return [single];
    const list = getPath(payload, "reports");
    if (Array.isArray(list)) return list.map(one).filter(Boolean) as DlrItem[];
    return [];
  }
}
