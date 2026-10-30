// Provider Adapter deseni
// Backend: Next.js (Node.js) + React. Ana sağlayıcı: env ile yapılandırılan Generic HTTP SMS sağlayıcısı.
// Varsayılan aktif sağlayıcı: MockProvider (test). Admin panelinden Generic HTTP sağlayıcısına geçilebilir.

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  errorCode?: string;
  error?: string;
};

export type DlrItem = {
  providerMessageId: string;
  status: "delivered" | "failed" | "pending";
  errorCode?: string;
};

export interface ProviderInterface {
  name: string;
  sendSms(to: string, text: string, opts?: { sender?: string }): Promise<SendResult>;
  sendBulk(messages: { to: string; text: string }[]): Promise<SendResult[]>;
  getBalance(): Promise<{ balance: number; currency: string }>;
  getReports(ids: string[]): Promise<DlrItem[]>;
  parseDlrWebhook(payload: unknown, headers: Record<string, string>): DlrItem[];
}

export class MockProvider implements ProviderInterface {
  name = "mock";
  async sendSms(to: string, _text: string): Promise<SendResult> {
    // Simulate ~98% success; numbers ending with 00 fail deterministically
    if (to.endsWith("00")) {
      return { ok: false, errorCode: "MOCK_FAIL", error: "Mock teslimat hatası" };
    }
    return { ok: true, providerMessageId: "MOCK-" + Date.now().toString(36) + "-" + to.slice(-4) };
  }
  async sendBulk(messages: { to: string; text: string }[]): Promise<SendResult[]> {
    const out: SendResult[] = [];
    for (const m of messages) out.push(await this.sendSms(m.to, m.text));
    return out;
  }
  async getBalance() {
    return { balance: 987654.32, currency: "TRY" as const };
  }
  async getReports(ids: string[]): Promise<DlrItem[]> {
    return ids.map((id) => ({ providerMessageId: id, status: id.includes("FAIL") ? "failed" : "delivered" as const }));
  }
  parseDlrWebhook(payload: unknown): DlrItem[] {
    try {
      const p = payload as { reports?: { id: string; status: string; error?: string }[] } | { id: string; status: string }[];
      if (Array.isArray(p)) {
        return p.map((r) => ({
          providerMessageId: String(r.id),
          status: r.status === "delivered" || r.status === "0" ? "delivered" : r.status === "pending" ? "pending" : "failed",
          errorCode: (r as { error?: string }).error,
        }));
      }
      if (p && typeof p === "object" && Array.isArray((p as { reports?: unknown[] }).reports)) {
        return ((p as { reports: { id: string; status: string; error?: string }[] }).reports).map((r) => ({
          providerMessageId: String(r.id),
          status: r.status === "delivered" ? "delivered" : r.status === "pending" ? "pending" : "failed",
          errorCode: r.error,
        }));
      }
    } catch {}
    return [];
  }
}

// Generic HTTP provider (Netgsm / Twilio-benzeri REST'e uyarlanabilir)
// credentials: { baseUrl, apiKey, secret, sender, balanceEndpoint, sendEndpoint }
export class GenericHttpProvider implements ProviderInterface {
  name = "generic";
  private cfg: Record<string, string>;
  constructor(cfg: Record<string, string>) {
    this.cfg = cfg;
  }
  private get baseUrl() {
    return (this.cfg.baseUrl || process.env.SMS_PROVIDER_BASE_URL || "").replace(/\/$/, "");
  }
  async sendSms(to: string, text: string, opts?: { sender?: string }): Promise<SendResult> {
    const base = this.baseUrl;
    if (!base) {
      // fallback to mock behaviour when not configured
      return new MockProvider().sendSms(to, text);
    }
    try {
      const endpoint = this.cfg.sendEndpoint || "/sms/send";
      const res = await fetch(`${base}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey || process.env.SMS_PROVIDER_API_KEY || ""}`,
        },
        body: JSON.stringify({ to, text, sender: opts?.sender || this.cfg.sender || process.env.SMS_PROVIDER_SENDER || "WOLTSMS" }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string; error?: string; code?: string };
      if (!res.ok) return { ok: false, errorCode: data.code || String(res.status), error: data.error || "Sağlayıcı hatası" };
      return { ok: true, providerMessageId: String(data.id || data.messageId || `GEN-${Date.now()}`) };
    } catch (e) {
      return { ok: false, errorCode: "PROVIDER_UNREACHABLE", error: e instanceof Error ? e.message : "Bağlantı hatası" };
    }
  }
  async sendBulk(messages: { to: string; text: string }[]): Promise<SendResult[]> {
    const out: SendResult[] = [];
    for (const m of messages) out.push(await this.sendSms(m.to, m.text));
    return out;
  }
  async getBalance() {
    const base = this.baseUrl;
    if (!base) return new MockProvider().getBalance();
    try {
      const endpoint = this.cfg.balanceEndpoint || "/sms/balance";
      const res = await fetch(`${base}${endpoint}`, {
        headers: { Authorization: `Bearer ${this.cfg.apiKey || ""}` },
      });
      const data = (await res.json().catch(() => ({}))) as { balance?: number; credit?: number; currency?: string };
      return { balance: Number(data.balance ?? data.credit ?? 0), currency: data.currency || "TRY" };
    } catch {
      return { balance: 0, currency: "TRY" as const };
    }
  }
  async getReports(ids: string[]): Promise<DlrItem[]> {
    // Generic polling — empty when not configured
    if (!this.baseUrl) return new MockProvider().getReports(ids);
    return ids.map((id) => ({ providerMessageId: id, status: "pending" as const }));
  }
  parseDlrWebhook(payload: unknown): DlrItem[] {
    return new MockProvider().parseDlrWebhook(payload);
  }
}

export async function getActiveProvider(): Promise<ProviderInterface> {
  try {
    const { db } = await import("@/db");
    const { providerSettings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(providerSettings).where(eq(providerSettings.isActive, true));
    const active = rows[0];
    if (!active || active.provider === "mock") return new MockProvider();
    let cfg: Record<string, string> = {};
    if (active.credentialsEncrypted) {
      try {
        const { decrypt } = await import("./security");
        cfg = JSON.parse(decrypt(active.credentialsEncrypted));
      } catch {}
    }
    // env override
    cfg = {
      baseUrl: process.env.SMS_PROVIDER_BASE_URL || cfg.baseUrl || "",
      apiKey: process.env.SMS_PROVIDER_API_KEY || cfg.apiKey || "",
      secret: process.env.SMS_PROVIDER_SECRET || cfg.secret || "",
      sender: process.env.SMS_PROVIDER_SENDER || cfg.sender || "WOLTSMS",
      ...cfg,
    };
    return new GenericHttpProvider(cfg);
  } catch {
    return new MockProvider();
  }
}
