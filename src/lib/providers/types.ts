// WOLTSMS - Provider Adapter deseni (lib/providers/)
// İlk adapter: Gatum SMS (sempico.solutions). Ek olarak MockProvider (test)
// ve Generic HTTP (herhangi bir JSON API). Yeni sağlayıcı = yeni adapter +
// provider_settings tablosuna kayıt; paneldeki "Entegrasyonlar" sekmesinden
// kimlik bilgileri girilir (AES-256-GCM ile şifreli saklanır).

export type SendResult = {
  ok: boolean;
  providerMessageId?: string; // tek parça id_state
  providerMessageIds?: string[]; // çok parçalı (multipart)
  errorCode?: string; // normalize edilmiş kod
  error?: string; // insan-okur sağlayıcı hatası
  retryable?: boolean; // true ise worker yeniden dener
};

export type DlrItem = {
  providerMessageId: string;
  status: "delivered" | "failed" | "pending";
  errorCode?: string;
  time?: string;
};

export type SendOptions = {
  sender?: string;
  callbackUrl?: string;
  /** Planlanan gönderim anı (UTC ISO veya Date). Verilmezse "şimdi". */
  sendAt?: Date | string | null;
};

export type BalanceResult = { balance: number; currency: string };

export interface ProviderInterface {
  name: string;
  /**
   * opts.sendAt: siparişin planlanan gönderim anı (UTC). Sağlayıcı adapter'ı bunu
   * kendi saat dilimine çevirerek iletir (Gatum: Europe/London → beginDate/beginTime).
   */
  sendSms(to: string, text: string, opts?: SendOptions): Promise<SendResult>;
  sendBulk(messages: { to: string; text: string; sendAt?: Date | string | null }[]): Promise<SendResult[]>;
  getBalance(): Promise<BalanceResult>;
  getReports(ids: string[]): Promise<DlrItem[]>;
  parseDlrWebhook(payload: unknown, headers: Record<string, string>): DlrItem[];
}

// Sağlayıcı hata kodlarının iç duruma karşılığı.
// Anahtarlar Gatum REST API v1 `errors` alanındaki kodların kendisidir
// (büyük/küçük harf duyarsız eşleşir), serbest metinler için alt-satır
// parçaları da ayrıca denenir.
export const PROVIDER_ERROR_MAP: Record<string, { code: string; retryable: boolean }> = {
  no_money: { code: "PROVIDER_NO_MONEY", retryable: true },
  phone_in_black_list: { code: "PROVIDER_BLACKLIST", retryable: false },
  incorrect_phone: { code: "PROVIDER_BAD_PHONE", retryable: false },
  incorrect_phone_length: { code: "PROVIDER_BAD_PHONE", retryable: false },
  no_mcc_mnc: { code: "PROVIDER_NO_ROUTE", retryable: false },
  no_active_aggregator: { code: "PROVIDER_NO_ROUTE", retryable: false },
  no_source_price: { code: "PROVIDER_NO_PRICE", retryable: false },
  no_client_price: { code: "PROVIDER_NO_PRICE", retryable: false },
  blocked_originator: { code: "PROVIDER_BLOCKED_SENDER", retryable: false },
  blocked_shortener_rule: { code: "PROVIDER_BLOCKED_TEXT", retryable: false },
  undefined_code: { code: "PROVIDER_UNDEFINED", retryable: false },
  "rejected by daily limit": { code: "PROVIDER_DAILY_LIMIT", retryable: true },

  // REST API v1 ek kodları
  incorrect_originator: { code: "PROVIDER_BLOCKED_SENDER", retryable: false },
  not_registr_originator: { code: "PROVIDER_BLOCKED_SENDER", retryable: false },
  blocked_by_moderation: { code: "PROVIDER_BLOCKED_TEXT", retryable: false },
  unsupported_encoding: { code: "PROVIDER_BAD_TEXT", retryable: false },
  no_sms: { code: "PROVIDER_BAD_REQUEST", retryable: false },
  user_not_allowed_sending_to_this_aggregator: { code: "PROVIDER_NO_ROUTE", retryable: false },
  reseller_not_allowed_sending_to_this_aggregator: { code: "PROVIDER_NO_ROUTE", retryable: false },
  no_reseller_price: { code: "PROVIDER_NO_PRICE", retryable: false },
  reseller_no_money: { code: "PROVIDER_NO_MONEY", retryable: false },
  reseller_blocked: { code: "PROVIDER_FORBIDDEN", retryable: false },
  undefined_reseller: { code: "PROVIDER_FORBIDDEN", retryable: false },
  "no sms was sent": { code: "PROVIDER_BAD_REQUEST", retryable: false },
  "too many sms in one request (max 100)": { code: "PROVIDER_BAD_REQUEST", retryable: false },
};

export function mapProviderError(raw: string): { code: string; retryable: boolean } {
  const full = String(raw || "").toLowerCase().trim();
  if (!full) return { code: "PROVIDER_ERROR", retryable: true };
  if (PROVIDER_ERROR_MAP[full]) return PROVIDER_ERROR_MAP[full];
  // serbest metin ("Gönderim reddedildi: no_money" gibi) kelimelerinde ayrıca dene
  for (const key of Object.keys(PROVIDER_ERROR_MAP)) {
    if (key.length > 3 && full.includes(key)) return PROVIDER_ERROR_MAP[key];
  }
  return { code: "PROVIDER_ERROR", retryable: true };
}

// fetch with timeout + sınırlı yeniden deneme (üstel bekleme)
export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const { timeoutMs = 15000, retries = 2, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal, cache: "no-store" });
      // 4xx retry edilmez (kural hatası); 5xx/429 dener
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
          continue;
        }
        return res;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("NETWORK_ERROR");
}
