import jwt from "jsonwebtoken";
import { cookies, headers } from "next/headers";
import { db, pool } from "@/db";
import { users, roles, rolePermissions, apiKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sha256, hmacSha256 } from "./security";

const JWT_SECRET = process.env.JWT_SECRET || "woltsms-dev-jwt-secret-change-me";
const COOKIE = "woltsms_session";

export type SessionUser = {
  id: number;
  username: string;
  name: string;
  email: string;
  roleId: number | null;
  roleName: string | null;
  isAdmin: boolean;
  quota: string;
  unitPrice: string;
  quotaType: string;
};

export function signSession(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

export function verifySession(token: string): SessionUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionUser;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

export async function loadUserWithRole(userId: number) {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  const u = rows[0];
  if (!u) return null;
  let roleName: string | null = null;
  if (u.roleId) {
    const r = await db.select().from(roles).where(eq(roles.id, u.roleId));
    roleName = r[0]?.name ?? null;
  }
  const isAdmin = roleName === "admin" || roleName === "SuperAdmin" || u.username === "admin";
  return { ...u, roleName, isAdmin };
}

export async function getPermissions(roleId: number | null): Promise<string[]> {
  if (!roleId) return [];
  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.permissionCode);
}

export async function hasPermission(user: SessionUser, code: string): Promise<boolean> {
  if (user.isAdmin) return true;
  const perms = await getPermissions(user.roleId);
  return perms.includes(code) || perms.includes("*");
}

// Row lock helper for atomic balance ops
export async function withLockedUser<T>(userId: number, fn: (client: import("pg").PoolClient, quota: string) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT quota FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (r.rowCount === 0) throw new Error("USER_NOT_FOUND");
    const quota = String(r.rows[0].quota ?? "0");
    const result = await fn(client, quota);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// ---- Public API auth: X-API-Key + X-Signature (HMAC-SHA256) veya Bearer ----
export type ApiAuthResult = { userId: number; keyId: number; callbackUrl: string | null } | { error: string; code: number };

export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult> {
  const apiKey = req.headers.get("x-api-key") || "";
  const signature = req.headers.get("x-signature") || "";
  const authHeader = req.headers.get("authorization") || "";
  const timestamp = req.headers.get("x-timestamp") || "";

  let rawKey = apiKey;
  if (!rawKey && authHeader.startsWith("Bearer ")) rawKey = authHeader.slice(7);
  if (!rawKey) return { error: "API anahtarı gerekli.", code: 401 };

  const prefix = rawKey.slice(0, 8);
  const keyHash = sha256(rawKey);
  const rows = await db.select().from(apiKeys).where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.keyHash, keyHash)));
  const k = rows[0];
  if (!k || k.status !== "active") return { error: "Geçersiz API anahtarı.", code: 401 };

  // IP whitelist
  if (k.ipWhitelist) {
    try {
      const list: string[] = JSON.parse(k.ipWhitelist);
      if (Array.isArray(list) && list.length > 0) {
        const h = await headers();
        const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "127.0.0.1";
        const match = list.some((w) => w.trim() === ip || w.trim() === "*");
        if (!match) return { error: "IP adresi beyaz listede değil.", code: 403 };
      }
    } catch {}
  }

  // If X-Signature present, verify HMAC over (timestamp + method + path + bodyHash?) — accept timestamp-based or body-based
  if (signature) {
    // We need secret; secret stored as hash only -> cannot verify HMAC without plaintext.
    // So we store secretHash = sha256(secret). For HMAC we derive verification using keyHash-bound secret?
    // Alternative: signature = HMAC(sha256(secret), timestamp + "." + body)
    // Document this: secret never stored plaintext, signature uses sha256(secret) as key.
    const bodyText = (req as unknown as { __bodyText?: string }).__bodyText ?? "";
    const base = `${timestamp}.${bodyText}`;
    const expected = hmacSha256(k.secretHash, base);
    // timing-safe compare loosely
    if (expected !== signature.toLowerCase() && expected !== signature) {
      return { error: "Geçersiz imza.", code: 401 };
    }
  }

  // rate-limit: 120 req/min per key (simple db-less in-memory)
  if (!checkRateLimit(`key:${k.id}`, 120, 60_000)) {
    return { error: "Hız limiti aşıldı.", code: 429 };
  }

  return { userId: k.userId, keyId: k.id, callbackUrl: k.callbackUrl };
}

const rateBuckets = new Map<string, { count: number; reset: number }>();
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now > b.reset) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export const SESSION_COOKIE = COOKIE;
export const JWT_SECRET_EXPORT = JWT_SECRET;
