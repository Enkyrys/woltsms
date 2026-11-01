import { describe, it, expect, vi, afterEach } from "vitest";
import { GatumProvider } from "@/lib/providers/gatum";
import { MockProvider } from "@/lib/providers/mock";
import { mapProviderError } from "@/lib/providers/types";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGatum(securityKey?: string): GatumProvider {
  return new GatumProvider({
    baseUrl: "https://api.sempico.solutions",
    senderId: "WOLTSMS",
    credentialsJson: JSON.stringify({ token: "test-token", securityKey }),
  });
}

describe("GatumProvider.sendSms", () => {
  it("200 + tek id_state → ok, providerMessageId", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ "905321234567": 1855153903 }), { status: 200 })
    ));
    const r = await makeGatum().sendSms("905321234567", "Merhaba");
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toBe("1855153903");
  });

  it("200 + multipart (liste) → providerMessageIds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ "905321234567": [111, 222, 333] }), { status: 200 })
    ));
    const r = await makeGatum().sendSms("905321234567", "uzun mesaj");
    expect(r.ok).toBe(true);
    expect(r.providerMessageIds).toEqual(["111", "222", "333"]);
    expect(r.providerMessageId).toBe("111");
  });

  it("URL token, phone, senderID, text içerir ve URL-encoded", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ "905321234567": 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await makeGatum().sendSms("905321234567", "Merhaba dünya & özel");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("https://api.sempico.solutions/send?");
    expect(url).toContain("token=test-token");
    expect(url).toContain("phone=905321234567");
    expect(url).toContain("senderID=WOLTSMS");
    expect(url).toContain("type=SMS");
    expect(url).toContain("delivery=TRUE");
    // text URL-encoded olmalı (boşluk + & gibi)
    expect(url).toMatch(/text=Merhaba%20d%C3%BCnya/);
  });

  it("400 no_money → retryable, PROVIDER_NO_MONEY", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "no_money" }), { status: 400 })
    ));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_NO_MONEY");
    expect(r.retryable).toBe(true); // bakiye yüklenebilir → yeniden dene
  });

  it("400 incorrect_phone → retryable değil", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "incorrect_phone" }), { status: 400 })
    ));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_BAD_PHONE");
    expect(r.retryable).toBe(false);
  });

  it("400 phone_in_black_list → retryable değil", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "phone_in_black_list" }), { status: 400 })
    ));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
  });

  it("401 → PROVIDER_AUTH, retryable değil", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "Incorrect token" }), { status: 401 })
    ));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_AUTH");
    expect(r.retryable).toBe(false);
  });

  it("403 → PROVIDER_FORBIDDEN, retryable değil", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "IP is not in WhiteList" }), { status: 403 })
    ));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_FORBIDDEN");
    expect(r.retryable).toBe(false);
  });

  it("ağ hatası → PROVIDER_NETWORK, retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const r = await makeGatum().sendSms("905321234567", "x");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PROVIDER_NETWORK");
    expect(r.retryable).toBe(true);
  });
});

describe("GatumProvider.parseDlrWebhook", () => {
  it("DELIVRD → delivered", () => {
    const items = makeGatum().parseDlrWebhook(
      { id_state: "1855153903", state: "DELIVRD", time: "2026-01-01 10:00:00", error: "0" },
      {}
    );
    expect(items).toHaveLength(1);
    expect(items[0].providerMessageId).toBe("1855153903");
    expect(items[0].status).toBe("delivered");
  });

  it("UNDELIV → failed, error kodu aktarılır", () => {
    const items = makeGatum().parseDlrWebhook(
      { id_state: "123", state: "UNDELIV", error: "3" },
      {}
    );
    expect(items[0].status).toBe("failed");
    expect(items[0].errorCode).toBe("3");
  });

  it("EXPIRED → failed", () => {
    const items = makeGatum().parseDlrWebhook({ id_state: "123", state: "EXPIRED" }, {});
    expect(items[0].status).toBe("failed");
  });

  it("ENROUTE → pending", () => {
    const items = makeGatum().parseDlrWebhook({ id_state: "123", state: "ENROUTE" }, {});
    expect(items[0].status).toBe("pending");
  });

  it("security key tanımlıysa API_KEY header olmadan reddeder", () => {
    const items = makeGatum("secret123").parseDlrWebhook({ id_state: "1", state: "DELIVRD" }, {});
    expect(items).toHaveLength(0);
  });

  it("security key doğru header ile kabul edilir", () => {
    const items = makeGatum("secret123").parseDlrWebhook(
      { id_state: "1", state: "DELIVRD" },
      { api_key: "secret123" }
    );
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("delivered");
  });

  it("toplu rapor dizisi işlenir", () => {
    const items = makeGatum().parseDlrWebhook(
      { reports: [
        { id_state: "1", state: "DELIVRD" },
        { id_state: "2", state: "UNDELIV", error: "5" },
      ] },
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
