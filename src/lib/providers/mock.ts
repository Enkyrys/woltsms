import type { DlrItem, ProviderInterface, SendResult } from "./types";

// Test/geliştirme sağlayıcısı: dış çağrı yok, rastgele DLR benzeri ID üretir.
export class MockProvider implements ProviderInterface {
  name = "mock";

  async sendSms(to: string, _text: string): Promise<SendResult> {
    // test için özel durumlar
    if (to.endsWith("0000")) {
      return { ok: false, errorCode: "PROVIDER_BAD_PHONE", error: "Mock: geçersiz numara", retryable: false };
    }
    if (to.endsWith("9999")) {
      return { ok: false, errorCode: "PROVIDER_NO_MONEY", error: "Mock: yetersiz sağlayıcı bakiyesi", retryable: true };
    }
    const id = `mock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return { ok: true, providerMessageId: id };
  }

  async sendBulk(messages: { to: string; text: string }[]): Promise<SendResult[]> {
    return Promise.all(messages.map((m) => this.sendSms(m.to, m.text)));
  }

  async getBalance(): Promise<{ balance: number; currency: string }> {
    return { balance: 999999, currency: "TRY" };
  }

  async getReports(ids: string[]): Promise<DlrItem[]> {
    // Mock: hepsi delivered
    return ids.map((id) => ({ providerMessageId: id, status: "delivered" as const }));
  }

  parseDlrWebhook(payload: unknown, _headers: Record<string, string>): DlrItem[] {
    const p = payload as { providerMessageId?: string; id_state?: string; state?: string } | null;
    if (!p) return [];
    const id = p.providerMessageId || p.id_state;
    if (!id) return [];
    return [{ providerMessageId: String(id), status: "delivered" }];
  }
}
