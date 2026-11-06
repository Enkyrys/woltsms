import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { validatePasswordPolicy, generatePassword } from "@/lib/security";
import { adminAdjust } from "@/lib/services";
import { ok, unauthorized, forbidden, badRequest, notFound } from "@/lib/api-response";

export const runtime = "nodejs";

// GET: kullanıcı listesi (users.view)
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "users.view") && !s.isAdmin) return forbidden();

  const admin = createAdminClient();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const search = url.searchParams.get("search") || "";

  let q = admin.from("profiles").select("*", { count: "exact" });
  if (search) q = q.or(`username.ilike.%${search}%,name.ilike.%${search}%`);
  const { count, data } = await q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const ids = (data ?? []).map((p) => p.id);
  const [{ data: wallets }, { data: roles }, { data: pricing }] = await Promise.all([
    admin.from("wallets").select("user_id, balance").in("user_id", ids),
    admin.from("roles").select("id, name"),
    admin.from("pricing").select("user_id, unit_price").in("user_id", ids),
  ]);
  const balMap = new Map((wallets ?? []).map((w) => [w.user_id, w.balance]));
  const roleMap = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const priceMap = new Map((pricing ?? []).map((p) => [p.user_id, p.unit_price]));

  // e-postalar auth.users içinde; listeyle eşleştir
  const emailMap = new Map<string, string>();
  try {
    const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of authUsers?.users ?? []) if (u.email) emailMap.set(u.id, u.email);
  } catch { /* yoksay: e-posta görüntülenemez */ }

  return ok(
    (data ?? []).map((p) => ({
      id: p.id,
      username: p.username,
      isActive: p.is_active,
      name: p.name,
      quotaType: p.quota_type,
      quota: String(balMap.get(p.id) ?? "0"),
      email: emailMap.get(p.id) ?? "",
      phone: p.phone ?? "",
      roleId: p.role_id ?? "",
      unitPrice: String(priceMap.get(p.id) ?? ""),
      twoFactor: p.two_factor_enabled,
      roleName: roleMap.get(p.role_id ?? "") ?? "",
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

const CreateSchema = z.object({
  name: z.string().min(1),
  username: z
    .string()
    .trim()
    .min(3, "Kullanıcı adı en az 3 karakter olmalı.")
    .regex(/^[A-Za-z0-9._-]+$/, "Kullanıcı adı sadece harf, rakam, nokta, tire ve alt çizgi içerebilir."),
  // E-posta opsiyonel: boşsa kullanıcı adından dahili bir adres üretilir (doğrulama maili gönderilmez)
  email: z.string().email("Geçerli bir e-posta girin.").optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().optional(),
  password: z.string().optional(),
  roleId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  quotaType: z.enum(["variable", "fixed"]).optional(),
  unitPrice: z.coerce.number().optional(),
  quota: z.union([z.string(), z.number()]).optional(), // panel formu gönderir, burada yok sayılır
});

// POST: kullanıcı oluştur (service_role ile, e-posta dahil)
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "users.create") && !s.isAdmin) return forbidden();

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");

  const password = parsed.data.password || generatePassword();
  const pwError = validatePasswordPolicy(password);
  if (pwError) return badRequest(pwError);

  const user = await createUserClient(); // rpc_create_user auth.uid() ister
  const { data, error } = await user.rpc("rpc_create_user", {
    p_email: parsed.data.email || `${parsed.data.username.toLowerCase()}@woltsms.local`,
    p_password: password,
    p_username: parsed.data.username,
    p_name: parsed.data.name,
    p_phone: parsed.data.phone ?? null,
    p_role_id: parsed.data.roleId ?? null,
    p_quota_type: parsed.data.quotaType ?? "variable",
    p_unit_price: parsed.data.unitPrice ?? null,
  });
  if (error) {
    if (error.message.includes("auth.users")) return badRequest("Bu e-posta zaten kayıtlı olabilir.");
    return badRequest(error.message);
  }
  const d = data as { id: string; username: string };
  return ok({ id: d.id, username: d.username, generatedPassword: body.password ? undefined : password }, "Kullanıcı oluşturuldu.");
}

// Türkçe hata mesajları (RPC hata anahtarı → mesaj)
const USER_ERRORS: Record<string, { msg: string; code: number }> = {
  NO_PERMISSION: { msg: "Bu işlem için yetkiniz yok.", code: 403 },
  USER_NOT_FOUND: { msg: "Kullanıcı bulunamadı.", code: 404 },
  NAME_REQUIRED: { msg: "İsim boş olamaz.", code: 400 },
  INVALID_QUOTA_TYPE: { msg: "Geçersiz kota tipi.", code: 400 },
  INVALID_UNIT_PRICE: { msg: "Birim fiyat 0'dan büyük olmalı.", code: 400 },
  ROLE_NOT_FOUND: { msg: "Seçilen rol bulunamadı.", code: 404 },
  SELF_ADMIN_REMOVAL: { msg: "Kendi admin rolünüzü kaldıramazsınız.", code: 409 },
  SELF_DEACTIVATE: { msg: "Kendi hesabınızı pasifleştiremezsiniz.", code: 409 },
  SELF_DELETE: { msg: "Kendi üyeliğinizi silemezsiniz.", code: 409 },
  LAST_ADMIN: { msg: "Sistemdeki son aktif admin pasifleştirilemez, rolü değiştirilemez veya silinemez.", code: 409 },
  USER_HAS_ACTIVE_CAMPAIGNS: { msg: "Kullanıcının gönderimi süren ya da zamanlanmış kampanyası var. Önce bu kampanyaları iptal edin.", code: 409 },
};
function userError(message: string) {
  const key = Object.keys(USER_ERRORS).find((k) => message.includes(k));
  const e = key ? USER_ERRORS[key] : { msg: message, code: 400 };
  return Response.json({ success: false, code: e.code, message: e.msg }, { status: e.code });
}

// boş metin → undefined (form alanı boş bırakıldıysa değiştirilmez)
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const UpdateSchema = z.object({
  id: z.string().uuid("Geçersiz kullanıcı."),
  name: z.string().trim().min(1, "İsim boş olamaz.").max(120).optional(),
  phone: z.string().trim().max(30).optional(), // "" → telefonu temizle
  email: z.preprocess(blank, z.string().trim().email("Geçerli bir e-posta girin.").optional()),
  roleId: z.preprocess(blank, z.string().uuid("Geçersiz rol.").optional()),
  quotaType: z.enum(["variable", "fixed"]).optional(),
  unitPrice: z.preprocess(
    (v) => (blank(v) === undefined ? undefined : typeof v === "string" ? v.replace(",", ".") : v),
    z.coerce.number({ invalid_type_error: "Birim fiyat sayı olmalı." }).positive("Birim fiyat 0'dan büyük olmalı.").optional()
  ),
  isActive: z.boolean().optional(),
  password: z.preprocess(blank, z.string().optional()), // doluysa şifre sıfırlanır
  adjustAmount: z.preprocess(
    (v) => (blank(v) === undefined ? undefined : typeof v === "string" ? v.replace(",", ".") : v),
    z.coerce.number({ invalid_type_error: "Kredi tutarı sayı olmalı." }).optional()
  ),
  adjustDesc: z.string().optional(),
});

// PATCH: kullanıcı bilgilerini düzenle (users.edit)
export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "users.edit") && !s.isAdmin) return forbidden();

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
  const b = parsed.data;

  if (b.password) {
    const pwError = validatePasswordPolicy(b.password);
    if (pwError) return badRequest(pwError);
  }

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, username").eq("id", b.id).maybeSingle();
  if (!target) return notFound("Kullanıcı bulunamadı.");

  // 1) profil alanları (doğrulamalı, denetim kayıtlı)
  const user = await createUserClient();
  const { data: upd, error } = await user.rpc("admin_update_user_v2", {
    p_user_id: b.id,
    p_name: b.name ?? null,
    p_phone: b.phone ?? null,
    p_role_id: b.roleId ?? null,
    p_quota_type: b.quotaType ?? null,
    p_unit_price: b.unitPrice ?? null,
    p_is_active: b.isActive ?? null,
  });
  if (error) return userError(error.message);
  const changed: string[] = Object.keys(((upd as { changes?: Record<string, unknown> } | null)?.changes) ?? {});

  // 2) e-posta ve şifre: Supabase Auth Admin API (identities ile tutarlı)
  const authUpdate: { email?: string; email_confirm?: boolean; password?: string } = {};
  if (b.email) {
    const { data: au } = await admin.auth.admin.getUserById(b.id);
    if ((au?.user?.email || "").toLowerCase() !== b.email.toLowerCase()) {
      authUpdate.email = b.email.toLowerCase();
      authUpdate.email_confirm = true; // doğrulama maili gönderilmez
    }
  }
  if (b.password) authUpdate.password = b.password;
  if (Object.keys(authUpdate).length) {
    const { error: aerr } = await admin.auth.admin.updateUserById(b.id, authUpdate);
    if (aerr) {
      const m = aerr.message || "";
      if (/already|registered|exists|duplicate/i.test(m)) return badRequest("Bu e-posta başka bir kullanıcıda kayıtlı.");
      return badRequest(`Giriş bilgileri güncellenemedi: ${m}`);
    }
    if (authUpdate.email) changed.push("email");
    if (authUpdate.password) changed.push("password");
    await admin.from("audit_logs").insert({
      actor_id: s.id,
      action: authUpdate.password ? "user.password_reset" : "user.email_change",
      payload: { user_id: b.id, username: target.username, email: authUpdate.email ?? null, password_reset: !!authUpdate.password },
    });
  }

  // 3) paneldeki "bakiye ayarla" kutusu doluysa (rpc_admin_adjust, kendi JWT'siyle)
  if (b.adjustAmount && b.adjustAmount !== 0) {
    const adj = await adminAdjust(b.id, b.adjustAmount, b.adjustDesc || "Panel bakiye ayarı");
    if (!adj.ok) return badRequest(adj.error || "Bakiye ayarlanamadı.");
    changed.push("balance");
  }

  return ok(
    { updated: true, changed },
    changed.length === 0 ? "Değişiklik yok." : authUpdate.password ? "Kullanıcı güncellendi, şifre sıfırlandı." : "Kullanıcı güncellendi."
  );
}

// DELETE ?id=            → üyeliği sil (kullanıcı ve tüm verileri)
// DELETE ?id=&preview=1  → silinecek verilerin özeti (silmez)
export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "users.delete") && !s.isAdmin) return forbidden();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return badRequest("Geçersiz kullanıcı.");

  const user = await createUserClient();
  if (url.searchParams.get("preview")) {
    const { data, error } = await user.rpc("admin_user_delete_preview", { p_user_id: id });
    if (error) return userError(error.message);
    return ok(data, "OK");
  }

  if (id === s.id) return userError("SELF_DELETE");
  const { data, error } = await user.rpc("admin_delete_user_v2", { p_user_id: id });
  if (error) return userError(error.message);
  const d = data as { user?: { username?: string } };
  return ok({ deleted: true }, `${d.user?.username ?? "Kullanıcı"} üyeliği silindi.`);
}
