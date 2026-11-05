// Test için @/lib/auth: oturum bir global değişkenden okunur
type S = { id: string; isAdmin: boolean; permissions: string[]; username: string };
const g = globalThis as unknown as { __session: S | null; __loginUser: string | null };
g.__session ??= null; g.__loginUser ??= null;
export async function getSession() { return g.__session; }
export async function loginWithUsername(_u: string, _p: string) {
  return g.__loginUser ? { ok: true as const, userId: g.__loginUser } : { ok: false as const, error: "Geçersiz kullanıcı veya şifre.", code: 401 };
}
export async function logout() { g.__session = null; }
export function hasPermissionSync(s: S, p: string) { return s.isAdmin || s.permissions.includes(p); }
export function setTestSession(s: S | null) { g.__session = s; }
export function setTestLoginUser(id: string | null) { g.__loginUser = id; }
