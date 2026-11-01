import crypto from "crypto";

// WOLTSMS - güvenlik yardımcıları
// ENCRYPTION_KEY: 32 byte (base64 veya düz metin), yalnız sunucu env.

function getEncKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || "woltsms-dev-encryption-key-32bytes!!";
  // base64 ise çöz, değilse 32 byte'a uzat
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch {
    // düz metin
  }
  return Buffer.from(raw.padEnd(32, "0").slice(0, 32), "utf8");
}

// AES-256-GCM: format iv:tag:ciphertext (base64)
export function encrypt(plain: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("INVALID_ENCRYPTED_PAYLOAD");
  const key = getEncKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

// API anahtarı üretimi: wsk_live_<hex>
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(24).toString("hex");
  const key = `wsk_live_${raw}`;
  const prefix = key.slice(0, 16); // wsk_live_ + 7 karakter
  return { key, prefix, hash: sha256(key) };
}

// Referans kodu: WOLT-483920
export function generateReferenceCode(): string {
  return `WOLT-${Math.floor(100000 + Math.random() * 900000)}`;
}

// Kısa URL slug: kısa, okunur, çakışmaz
export function generateSlug(len = 7): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

// Şifre politikası: ≥8, 1 büyük, 1 küçük, 1 rakam, 1 özel
export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 8) return "Şifre en az 8 karakter olmalı.";
  if (!/[A-ZÇĞİÖŞÜ]/.test(pw)) return "Şifre en az 1 büyük harf içermeli.";
  if (!/[a-zçğıöşü]/.test(pw)) return "Şifre en az 1 küçük harf içermeli.";
  if (!/[0-9]/.test(pw)) return "Şifre en az 1 rakam içermeli.";
  if (!/[^A-Za-z0-9çÇğĞıIİöÖşŞüÜ]/.test(pw)) return "Şifre en az 1 özel karakter içermeli.";
  return null;
}

export function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*?";
  const all = upper + lower + digits + special;
  const pick = (set: string, n: number) => {
    let s = "";
    const buf = crypto.randomBytes(n * 2);
    for (let i = 0; i < n; i++) s += set[buf[i] % set.length];
    return s;
  };
  let pw = pick(upper, 1) + pick(lower, 1) + pick(digits, 1) + pick(special, 1) + pick(all, 8);
  // karıştır
  const arr = [...pw];
  const shuffle = crypto.randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}
