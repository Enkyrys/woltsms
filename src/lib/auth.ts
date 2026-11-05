import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256, timingSafeEqualStr } from "@/lib/security";
import type { Database } from "@/db/types";

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  isAdmin: boolean;
  quotaType: string;
  unitPrice: string;
  balance: string;
  reserved: string;
  permissions: string[];
};

export type ApiAuth =
  | { error: string; code: number }
  | {
      userId: string;
      apiKeyId: string;
      callbackUrl: string | null;
      ipOk: boolean;
    };

export const SESSION_COOKIE = "woltsms-auth";

// ===================== oturum (Supabase Auth) =====================

export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return loadUserWithRole(user.id, user.email || "");
}

export async function loadUserWithRole(userId: string, email = ""): Promise<SessionUser | null> {
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile) return null;

  const [{ data: wallet }, { data: perms }, { data: pricingRows }] = await Promise.all([
    admin.from("wallets").select("balance, reserved").eq("user_id", userId).maybeSingle(),
    profile.role_id
      ? admin.from("role_permissions").select("permission_code").eq("role_id", profile.role_id)
      : Promise.resolve({ data: [] as { permission_code: string }[] }),
    admin
      .from("pricing")
      .select("unit_price, user_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  let unitPrice = "1";
  if (pricingRows?.unit_price != null) {
    unitPrice = String(pricingRows.unit_price);
  } else {
    const { data: def } = await admin.from("pricing").select("unit_price").is("user_id", null).maybeSingle();
    if (def?.unit_price != null) unitPrice = String(def.unit_price);
  }

  const roleName = profile.role_id
    ? ((await admin.from("roles").select("name").eq("id", profile.role_id).maybeSingle()).data?.name ?? null)
    : null;
  const isAdmin = roleName === "admin";
  const permissionCodes = isAdmin ? ["*"] : (perms ?? []).map((p) => p.permission_code);

  return {
    id: profile.id,
    username: profile.username,
    name: profile.name,
    email,
    roleId: profile.role_id,
    roleName,
    isAdmin,
    quotaType: profile.quota_type,
    unitPrice,
    balance: String(wallet?.balance ?? "0"),
    reserved: String(wallet?.reserved ?? "0"),
    permissions: permissionCodes,
  };
}

export async function getPermissions(roleId: string | null): Promise<string[]> {
  if (!roleId) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("role_permissions").select("permission_code").eq("role_id", roleId);
  return (data ?? []).map((r) => r.permission_code);
}

export function hasPermissionSync(s: SessionUser | null, perm: string): boolean {
  if (!s) return false;
  if (s.isAdmin || s.permissions.includes("*")) return true;
  return s.permissions.includes(perm);
}

// asenkron varyant (eski imzayı korur)
export async function hasPermission(s: SessionUser | null, perm: string): Promise<boolean> {
  return hasPermissionSync(s, perm);
}

// ===================== giriş (kullanıcı adı → e-posta) =====================

export async function loginWithUsername(username: string, password: string): Promise<
  { ok: true; userId: string } | { ok: false; error: string; code: number }
> {
  const admin = createAdminClient();
  // kullanıcı adını e-postaya çöz
  const { data: email } = await admin.rpc("resolve_username_email", { p_username: username });
  if (!email) return { ok: false, error: "Geçersiz kullanıcı veya şifre.", code: 401 };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, error: "Geçersiz kullanıcı veya şifre.", code: 401 };
  }
  return { ok: true, userId: data.user.id };
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}

// ===================== API anahtarı doğrulama =====================

function ipAllowed(ip: string, whitelist: string[]): boolean {
  if (!whitelist || whitelist.length === 0) return true;
  for (const entry of whitelist) {
    const e = String(entry || "").trim();
    if (!e) continue;
    if (e === ip) return true;
    if (e.includes("/")) {
      // CIDR eşleşmesi (IPv4)
      const [net, bitsStr] = e.split("/");
      const bits = Number(bitsStr);
      const ipParts = ip.split(".").map(Number);
      const netParts = net.split(".").map(Number);
      if (ipParts.length === 4 && netParts.length === 4 && !Number.isNaN(bits) && bits >= 0 && bits <= 32) {
        const ipInt = ((ipParts[0] << 24) >>> 0) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
        const netInt = ((netParts[0] << 24) >>> 0) + (netParts[1] << 16) + (netParts[2] << 8) + netParts[3];
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if ((ipInt & mask) === (netInt & mask)) return true;
      }
    }
  }
  return false;
}

export async function authenticateApiRequest(req: Request): Promise<ApiAuth> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: "API anahtarı gerekli. Authorization: Bearer <anahtar>", code: 401 };

  const key = match[1].trim();
  const keyHash = sha256(key);
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("api_keys")
    .select("id, user_id, status, ip_whitelist, callback_url, last_used_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (!row) return { error: "Geçersiz API anahtarı.", code: 401 };
  if (row.status !== "active") return { error: "API anahtarı pasif.", code: 401 };

  // IP beyaz liste
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = (fwd.split(",")[0] || req.headers.get("x-real-ip") || "").trim();
  const whitelist = Array.isArray(row.ip_whitelist) ? (row.ip_whitelist as string[]) : [];
  const ipOk = ipAllowed(ip, whitelist);
  if (!ipOk) return { error: "Bu IP adresinden erişim izni yok.", code: 403 };

  // son kullanım + rate limit (anahtar başına 120 istek/dk)
  const { data: allowed } = await admin.rpc("rate_limit_check", {
    p_key: `apikey:${row.id}`,
    p_max: Number(process.env.API_RATE_LIMIT_PER_MIN || 120),
    p_window_seconds: 60,
  });
  if (allowed === false) return { error: "İstek limiti aşıldı. Lütfen daha sonra tekrar deneyin.", code: 429 };

  void Promise.resolve(
    admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id)
  ).catch(() => undefined);

  return { userId: row.user_id, apiKeyId: row.id, callbackUrl: row.callback_url, ipOk };
}

// ===================== imza doğrulama (opsiyonel) =====================

export async function verifyHmacSignature(apiKeyId: string, body: string, signature: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("api_keys").select("hmac_secret_encrypted").eq("id", apiKeyId).maybeSingle();
  if (!data?.hmac_secret_encrypted) return true; // imza modu kapalı
  const { decrypt, hmacSha256 } = await import("@/lib/security");
  const secret = decrypt(data.hmac_secret_encrypted);
  const expected = hmacSha256(secret, body);
  return timingSafeEqualStr(expected, signature.replace(/^sha256=/i, ""));
}

// ===================== iç uç nokta (CRON_SECRET) =====================

export async function verifyCronSecret(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // production'da zorunlu
  const given =
    req.headers.get("x-cron-secret") ||
    new URL(req.url).searchParams.get("secret") ||
    "";
  return timingSafeEqualStr(secret, given);
}

// ===================== sayfa koruması =====================

export async function requireSession(perm?: string): Promise<SessionUser | { error: string; code: number }> {
  const s = await getSession();
  if (!s) return { error: "Oturum gerekli.", code: 401 };
  if (perm && !hasPermissionSync(s, perm)) return { error: "Yetkiniz yok.", code: 403 };
  return s;
}

export function isSessionError(v: unknown): v is { error: string; code: number } {
  return typeof v === "object" && v !== null && "error" in v && "code" in v;
}

// Database tipi ihracı (tip güvenliği için)
export type { Database };

// headers/cookies kullanımını Next.js için sakla (SSG/SSR uyumu)
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

export { cookies };
