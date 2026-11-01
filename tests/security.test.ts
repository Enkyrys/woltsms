import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  sha256,
  hmacSha256,
  timingSafeEqualStr,
  generateApiKey,
  generateReferenceCode,
  generateSlug,
  validatePasswordPolicy,
  generatePassword,
} from "@/lib/security";

// ENCRYPTION_KEY test için sabit
process.env.ENCRYPTION_KEY = "test-encryption-key-32-bytes-long!!";

describe("AES-256-GCM şifreleme", () => {
  it("çözümleme geri döner", () => {
    const secret = "gatum-token-abc123";
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(decrypt(enc)).toBe(secret);
  });
  it("aynı düz metin her seferinde farklı şifre (rastgele IV)", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
  it("bozuk veri hata fırlatır", () => {
    expect(() => decrypt("bozuk:payload")).toThrow();
  });
  it("farklı anahtarla çözülemez", () => {
    const enc = encrypt("hemliye");
    const old = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "farkli-anahtar-32-byte-uzunlukta!";
    expect(() => decrypt(enc)).toThrow();
    process.env.ENCRYPTION_KEY = old;
  });
});

describe("hash / hmac", () => {
  it("sha256 64 hex döner", () => {
    expect(sha256("abc")).toHaveLength(64);
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hmac_sha256 doğru", () => {
    // RFC 4231 test vektörü
    expect(hmacSha256("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    );
  });
  it("timingSafeEqualStr eşitliği", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false); // uzunluk farkı
  });
});

describe("API anahtarı üretimi", () => {
  it("wsk_live_ öneki ile", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key).toMatch(/^wsk_live_[0-9a-f]{48}$/);
    expect(prefix).toBe(key.slice(0, 16));
    expect(hash).toBe(sha256(key));
    expect(hash).not.toContain(key); // hash'te ham anahtar yok
  });
  it("üretilen anahtarlar benzersiz", () => {
    const a = generateApiKey().key;
    const b = generateApiKey().key;
    expect(a).not.toBe(b);
  });
});

describe("referans kodu ve slug", () => {
  it("WOLT-XXXXXX biçiminde", () => {
    expect(generateReferenceCode()).toMatch(/^WOLT-\d{6}$/);
  });
  it("slug okunur ve belirtilen uzunlukta", () => {
    expect(generateSlug()).toMatch(/^[a-z2-9]{7}$/);
    expect(generateSlug(10)).toHaveLength(10);
  });
});

describe("şifre politikası", () => {
  it("geçerli şifre kabul", () => {
    expect(validatePasswordPolicy("Abcdef1!")).toBeNull();
  });
  it("kısa şifre reddet", () => {
    expect(validatePasswordPolicy("Ab1!")).toMatch(/8 karakter/);
  });
  it("büyük harf yoksa reddet", () => {
    expect(validatePasswordPolicy("abcdef1!")).toMatch(/büyük/);
  });
  it("küçük harf yoksa reddet", () => {
    expect(validatePasswordPolicy("ABCDEF1!")).toMatch(/küçük/);
  });
  it("rakam yoksa reddet", () => {
    expect(validatePasswordPolicy("Abcdefg!")).toMatch(/rakam/);
  });
  it("özel karakter yoksa reddet", () => {
    expect(validatePasswordPolicy("Abcdefg1")).toMatch(/özel/);
  });
  it("üretilen şifre politikayı karşılar", () => {
    for (let i = 0; i < 20; i++) {
      expect(validatePasswordPolicy(generatePassword())).toBeNull();
    }
  });
});
