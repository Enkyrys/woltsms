import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { GatumProvider, clearGatumTokenCache } from "@/lib/providers/gatum";
import { MockProvider } from "@/lib/providers/mock";
import { mapProviderError } from "@/lib/providers/types";

const BASE = "https://restapi.sempico.solutions/v1";

type Call = { url: string; init?: RequestInit };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearGatumTokenCache();
});

beforeEach(() => {
  clearGatumTokenCache();
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// fetch'i yakalar; her çağrıda verilen handler çağrılır (sıralı cevaplar için index sayar)
function stubFetch(handler: (url: string, init: RequestInit | undefined, index: number) => Response): Call[] {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const index = calls.length;
    calls.push({ url: u, init });
    return handler(u, init, index);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function makeGatum(opts: { credentials?: Record<string, string>; baseUrl?: string } = {}): GatumProvider {
  return new GatumProvider({
    baseUrl: opts.baseUrl ?? BASE,
    senderId: "WOLTSMS",
    credentialsJson: JSON.stringify(opts.credentials ?? { accessToken: "test-token" }),
  });
}

function sentBody(init: RequestInit | undefined): unknown[] {
  return JSON.parse(String(init?.body ?? "[]")) as unknown[];
}

describe("GatumProvider.sendSms (REST API v1)", () => {
  it("200 + tek id_state → ok, providerMessageId", async () => {
    stubFetch(() => json(200, { status: true, data: { "905321234567": [{ id_state: 1855153903 }] } }));
    const r = await makeGatum().sendSms("905321234567", "Merhaba");
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toBe("1855153903");
    expect(r.providerMessageIds).toEqual(["1855153903"]);
  });

  it("200 + çok parçalı (multipart) → providerMessageIds", async () => {
    stubFetch(() => json(200, { status: true, data: { "905321234567": [{ id_state: 111 }, { id_state: 222 }] } }));
    const r = await makeGatum().sendSms("905321234567", "uzun mesaj");
    expect(r.ok).toBe(true);
    expect(r.providerMessageIds).toEqual(["111", "222"]);
    expect(r.providerMessageId).toBe("111");
  });

  it("POST /send, X-Access-Token header'ı ve paket gövdesi doğru", async () => {
    const calls = stubFetch(() => json(200, { status: true, data: { "905321234567": [{ id_state: 1 }] } }));
    await makeGatum().sendSms("905321234567", "Merhaba dünya & özel", { callbackUrl: "https://wolt.app/api/v1/webhooks/dlr/gatum" });

    const call = calls[0];
    expect(call.url).toBe(`${BASE}/send`);
    expect(call.init?.method).toBe("POST");
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Access-Token"]).toBe("test-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = sentBody(call.init);
    expect(body).toHaveLength(1);
    const pkg = body[0] as Record<string, unknown>;
    expect(pkg.number).toEqual(["905321234567"]);
    expect(pkg.senderID).toBe("WOLTSMS");
    expect(pkg.text).toBe("Merhaba dünya & özel");
    expect(pkg.type).toBe("sms");
    expect(pkg.lifetime).toBe(86400);
    expect(pkg.delivery).toBe(true);
    expect(pkg.campaign).toBe("WOLTSMS");
    expect(pkg.callback_url).toBe("https://wolt.app/api/v1/webhooks/dlr/gatum");
  });

  it("200 + numara bazlı hata → ilgili kod, retryable değil", async () => {
    stubFetch(() => json(200, { status: true, data: { "905321234567": [{ error: "no_active_aggregator" }] } }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_NO_ROUTE");
    expect(r.retryable).toBe(false);
  });

  it("400 no_money → retryable, PROVIDER_NO_MONEY", async () => {
    stubFetch(() => json(400, { status: false, error_code: 400, errors: "no_money" }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_NO_MONEY");
    expect(r.retryable).toBe(true); // bakiye yüklenebilir → yeniden dene
  });

  it("400 incorrect_phone → retryable değil", async () => {
    stubFetch(() => json(400, { status: false, error_code: 400, errors: "incorrect_phone" }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_BAD_PHONE");
    expect(r.retryable).toBe(false);
  });

  it("400 phone_in_black_list → retryable değil", async () => {
    stubFetch(() => json(400, { status: false, error_code: 400, errors: "phone_in_black_list" }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_BLACKLIST");
    expect(r.retryable).toBe(false);
  });

  it("401 → PROVIDER_AUTH, retryable değil (statik token'da yenileme yok)", async () => {
    stubFetch(() => json(401, { status: false, error_code: 401, errors: "Invalid Access token" }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_AUTH");
    expect(r.retryable).toBe(false);
  });

  it("403 → PROVIDER_FORBIDDEN, retryable değil", async () => {
    stubFetch(() => json(403, { status: false, error_code: 403, errors: "IP is not in WhiteList" }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_FORBIDDEN");
    expect(r.retryable).toBe(false);
  });

  it("429 → PROVIDER_RATE_LIMIT, yeniden denenebilir", async () => {
    stubFetch(() => json(429, { status: false, error_code: 429, errors: "Too Many Requests" }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_RATE_LIMIT");
    expect(r.retryable).toBe(true);
  });

  it("ağ hatası → PROVIDER_NETWORK, retryable", async () => {
    stubFetch(() => {
      throw new Error("ECONNRESET");
    });
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_NETWORK");
    expect(r.retryable).toBe(true);
  });
});

describe("GatumProvider OAuth 2.0 token akışı", () => {
  it("username/password → /authorize + /access-token + /send", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/authorize")) return json(200, { status: true, data: { authorization_code: "code-1", expires_at: "2099-01-01 12:00:00" } });
      if (url.endsWith("/access-token")) return json(200, { status: true, data: { access_token: "oauth-token", expires_at: "2099-01-01 12:00:00" } });
      return json(200, { status: true, data: { "905321234567": [{ id_state: 7 }] } });
    });

    const provider = makeGatum({ credentials: { username: "client", password: "secret" } });
    const r = await provider.sendSms("905321234567", "Merhaba");

    expect(r.ok).toBe(true);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/authorize", "/v1/access-token", "/v1/send"]);
    const sendHeaders = (calls[2].init?.headers ?? {}) as Record<string, string>;
    expect(sendHeaders["X-Access-Token"]).toBe("oauth-token");
    const authBody = JSON.parse(String(calls[0].init?.body)) as Record<string, string>;
    expect(authBody).toEqual({ username: "client", password: "secret" });
  });

  it("token önbellekte tutulur: ikinci gönderimde yeniden yetkilendirme yapılmaz", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/authorize")) return json(200, { status: true, data: { authorization_code: "code-1", expires_at: "2099-01-01 12:00:00" } });
      if (url.endsWith("/access-token")) return json(200, { status: true, data: { access_token: "oauth-token", expires_at: "2099-01-01 12:00:00" } });
      return json(200, { status: true, data: { "905321234567": [{ id_state: 7 }] } });
    });

    const provider = makeGatum({ credentials: { username: "client", password: "secret" } });
    await provider.sendSms("905321234567", "bir");
    expect(calls).toHaveLength(3);

    await provider.sendSms("905321234567", "iki");
    expect(calls).toHaveLength(4); // yalnız /send
    expect(calls[3].url.endsWith("/send")).toBe(true);
  });

  it("send sırasında 401 → token yenilenir ve bir kez daha denenir", async () => {
    let sendCount = 0;
    const calls = stubFetch((url) => {
      if (url.endsWith("/authorize")) return json(200, { status: true, data: { authorization_code: "code-1", expires_at: "2099-01-01 12:00:00" } });
      if (url.endsWith("/access-token")) return json(200, { status: true, data: { access_token: `token-${++sendCount}`, expires_at: "2099-01-01 12:00:00" } });
      if (sendCount === 1) return json(401, { status: false, error_code: 401, errors: "Invalid Access token" });
      return json(200, { status: true, data: { "905321234567": [{ id_state: 7 }] } });
    });

    const provider = makeGatum({ credentials: { username: "client", password: "secret" } });
    const r = await provider.sendSms("905321234567", "Merhaba");

    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/authorize"))).toHaveLength(2);
  });

  it("kimlik bilgisi yoksa PROVIDER_AUTH döner", async () => {
    stubFetch(() => json(200, {}));
    const provider = makeGatum({ credentials: {} });
    const r = await provider.sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_AUTH");
    expect(r.retryable).toBe(false);
  });
});

describe("GatumProvider.getBalance (GET /me)", () => {
  it("balance_units + currency döner", async () => {
    const calls = stubFetch(() => json(200, { status: true, data: { balance_units: 1000, currency: "USD" } }));
    const b = await makeGatum().getBalance();
    expect(b).toEqual({ balance: 1000, currency: "USD" });
    expect(calls[0].url).toBe(`${BASE}/me`);
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Access-Token"]).toBe("test-token");
  });

  it("429 → BALANCE_RATE_LIMITED fırlatır (15 dk/1 istek limiti)", async () => {
    stubFetch(() => json(429, { status: false, error_code: 429, errors: "Too Many Requests" }));
    await expect(makeGatum().getBalance()).rejects.toThrow("BALANCE_RATE_LIMITED");
  });

  it("401 → BALANCE_AUTH fırlatır", async () => {
    stubFetch(() => json(401, { status: false, error_code: 401, errors: "Invalid Access token" }));
    await expect(makeGatum().getBalance()).rejects.toThrow("BALANCE_AUTH");
  });
});

describe("GatumProvider.testConnection (ücretsiz, SMS göndermez)", () => {
  it("authorize + token + replacement 200 → success", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/authorize")) return json(200, { status: true, data: { authorization_code: "c", expires_at: "2099-01-01 12:00:00" } });
      if (url.endsWith("/access-token")) return json(200, { status: true, data: { access_token: "t", expires_at: "2099-01-01 12:00:00" } });
      return json(200, { status: true, data: { "905000000000": { status: true, error: null, replacing: null } } });
    });

    const r = await makeGatum({ credentials: { username: "client", password: "secret" } }).testConnection();
    expect(r.ok).toBe(true);
    expect(r.level).toBe("success");
    expect(r.httpStatus).toBe(200);
    expect(calls.some((c) => c.url.endsWith("/replacement"))).toBe(true);
    // /send'e istek atılmamalı (ücretsiz test)
    expect(calls.some((c) => c.url.endsWith("/send"))).toBe(false);
  });

  it("replacement 403 → error, IP/izin mesajı", async () => {
    stubFetch((url) => {
      if (url.endsWith("/authorize")) return json(200, { status: true, data: { authorization_code: "c", expires_at: "2099-01-01 12:00:00" } });
      if (url.endsWith("/access-token")) return json(200, { status: true, data: { access_token: "t", expires_at: "2099-01-01 12:00:00" } });
      return json(403, { status: false, error_code: 403, errors: "You are not allowed to send via RESTAPI" });
    });
    const r = await makeGatum({ credentials: { username: "client", password: "secret" } }).testConnection();
    expect(r.ok).toBe(false);
    expect(r.level).toBe("error");
    expect(r.httpStatus).toBe(403);
    expect(r.message).toContain("403");
  });

  it("kimlik yoksa hata mesajı döner", async () => {
    stubFetch(() => json(200, {}));
    const r = await makeGatum({ credentials: {} }).testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("girilmemiş");
  });
});

describe("GatumProvider.sendBulk", () => {
  it("100'den fazla mesajı 100'lük paketlere böler", async () => {
    const calls = stubFetch((url, init) => {
      if (!url.endsWith("/send")) return json(200, { status: true, data: {} });
      const pkgs = sentBody(init);
      const data: Record<string, unknown> = {};
      for (const p of pkgs) {
        const num = (p as { number: string[] }).number[0];
        data[num] = [{ id_state: num.slice(-4) }];
      }
      return json(200, { status: true, data });
    });

    const messages = Array.from({ length: 120 }, (_, i) => ({ to: `90555000${String(i).padStart(4, "0")}`, text: `msg ${i}` }));
    const out = await makeGatum().sendBulk(messages);

    expect(out).toHaveLength(120);
    expect(out.every((r) => r.ok)).toBe(true);
    const sendCalls = calls.filter((c) => c.url.endsWith("/send"));
    expect(sendCalls).toHaveLength(2);
    expect(sentBody(sendCalls[0].init)).toHaveLength(100);
    expect(sentBody(sendCalls[1].init)).toHaveLength(20);
  });
});

describe("GatumProvider.parseDlrWebhook (POST JSON dizisi)", () => {
  it("dizi payload → id_state ve durumlar eşleşir", () => {
    const items = makeGatum().parseDlrWebhook(
      [
        { id_state: 1855153903, state: "DELIVRD", time: "2026-01-01 10:00:00", error: 0, phone: "905321234567", part_no: 1 },
        { id_state: 1855153904, state: "UNDELIV", error: 3 },
        { id_state: 1855153905, state: "EXPIRED" },
        { id_state: 1855153906, state: "ENROUTE" },
      ],
      {}
    );
    expect(items).toHaveLength(4);
    expect(items[0].status).toBe("delivered");
    expect(items[0].providerMessageId).toBe("1855153903");
    expect(items[0].time).toBe("2026-01-01 10:00:00");
    expect(items[1].status).toBe("failed");
    expect(items[1].errorCode).toBe("3");
    expect(items[2].status).toBe("failed");
    expect(items[3].status).toBe("pending");
  });

  it("error=0 ise hata kodu aktarılmaz", () => {
    const items = makeGatum().parseDlrWebhook([{ id_state: "1", state: "DELIVRD", error: 0 }], {});
    expect(items[0].errorCode).toBeUndefined();
  });

  it("tekil nesne (eski varyant) hâlâ çalışır", () => {
    const items = makeGatum().parseDlrWebhook({ id_state: "1855153903", state: "DELIVRD" }, {});
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("delivered");
  });

  it("security key tanımlıysa API_KEY header olmadan reddeder", () => {
    const items = makeGatum({ credentials: { accessToken: "t", securityKey: "secret123" } }).parseDlrWebhook(
      [{ id_state: "1", state: "DELIVRD" }],
      {}
    );
    expect(items).toHaveLength(0);
  });

  it("security key doğru header ile kabul edilir", () => {
    const items = makeGatum({ credentials: { accessToken: "t", securityKey: "secret123" } }).parseDlrWebhook(
      [{ id_state: "1", state: "DELIVRD" }],
      { api_key: "secret123" }
    );
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("delivered");
  });

  it("reports dizisi (eski toplu varyant) işlenir", () => {
    const items = makeGatum().parseDlrWebhook(
      {
        reports: [
          { id_state: "1", state: "DELIVRD" },
          { id_state: "2", state: "UNDELIV", error: "5" },
        ],
      },
      {}
    );
    expect(items).toHaveLength(2);
    expect(items[1].status).toBe("failed");
  });
});

describe("mapProviderError", () => {
  it("bilinen kodlar eşleşir", () => {
    expect(mapProviderError("no_money").code).toBe("PROVIDER_NO_MONEY");
    expect(mapProviderError("incorrect_phone").code).toBe("PROVIDER_BAD_PHONE");
    expect(mapProviderError("blocked_originator").code).toBe("PROVIDER_BLOCKED_SENDER");
  });

  it("REST API v1 kodları eşleşir", () => {
    expect(mapProviderError("incorrect_originator").code).toBe("PROVIDER_BLOCKED_SENDER");
    expect(mapProviderError("not_registr_originator").retryable).toBe(false);
    expect(mapProviderError("no_reseller_price").code).toBe("PROVIDER_NO_PRICE");
    expect(mapProviderError("reseller_no_money").retryable).toBe(false);
    expect(mapProviderError("unsupported_encoding").code).toBe("PROVIDER_BAD_TEXT");
  });

  it("serbest metin içindeki kod da yakalanır", () => {
    expect(mapProviderError("Gönderim reddedildi: no_money").code).toBe("PROVIDER_NO_MONEY");
  });

  it("bilinmeyen kod varsayılan", () => {
    expect(mapProviderError("xyz").code).toBe("PROVIDER_ERROR");
  });

  it("büyük/küçük harf duyarsız", () => {
    expect(mapProviderError("NO_MONEY").code).toBe("PROVIDER_NO_MONEY");
  });
});

describe("MockProvider", () => {
  it("başarılı gönderim sahte id döner", async () => {
    const r = await new MockProvider().sendSms("905321234567", "test");
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toMatch(/^mock-/);
  });
  it("0000 ile biten numara hata döner", async () => {
    const r = await new MockProvider().sendSms("9053210000", "test");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_BAD_PHONE");
  });
  it("9999 ile biten numara yeniden denenebilir hata döner", async () => {
    const r = await new MockProvider().sendSms("9053219999", "test");
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
  });
  it("getReports delivered döner", async () => {
    const reports = await new MockProvider().getReports(["abc"]);
    expect(reports[0].status).toBe("delivered");
  });
});
