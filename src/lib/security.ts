import crypto from "crypto";
import bcrypt from "bcryptjs";

const ENC_KEY = (process.env.ENCRYPTION_KEY || "woltsms-dev-encryption-key-32bytes!").padEnd(32, "0").slice(0, 32);

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 8) return "Şifre en az 8 karakter olmalı.";
  if (!/[A-ZÇĞİÖŞÜ]/.test(pw)) return "Şifre en az 1 büyük harf içermeli.";
  if (!/[a-zçğiöşü]/.test(pw)) return "Şifre en az 1 küçük harf içermeli.";
  if (!/[0-9]/.test(pw)) return "Şifre en az 1 rakam içermeli.";
  if (!/[^A-Za-z0-9çÇğĞıIİöÖşŞüÜ]/.test(pw)) return "Şifre en az 1 özel karakter içermeli.";
  return null;
}

export function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*?";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pw = pick(upper) + pick(lower) + pick(digits) + pick(special);
  const all = upper + lower + digits + special;
  for (let i = 0; i < 8; i++) pw += pick(all);
  return pw.split("").sort(() => Math.random() - 0.5).join("");
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENC_KEY), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENC_KEY), iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function hmacSha256(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function generateReferenceCode(): string {
  return "WOLT-" + Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateSlug(len = 7): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
