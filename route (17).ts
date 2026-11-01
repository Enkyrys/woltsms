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

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  roleId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  quotaType: z.enum(["variable", "fixed"]).optional(),
  unitPrice: z.coerce.number().optional(),
  adjustAmount: z.coerce.number().optional(), // paneldeki "bakiye ayarla"
  adjustDesc: z.string().optional(),
});

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "users.edit") && !s.isAdmin) return forbidden();

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");

  const user = await createUserClient();
  const { error } = await user.rpc("admin_update_user", {
    p_user_id: parsed.data.id,
    p_name: parsed.data.name ?? null,
    p_phone: parsed.data.phone ?? null,
    p_role_id: parsed.data.roleId ?? null,
    p_quota_type: parsed.data.quotaType ?? null,
    p_email: parsed.data.email ?? null,
    p_unit_price: parsed.data.unitPrice ?? null,
  });
  if (error) return badRequest(error.message);

  // paneldeki "bakiye ayarla" kutusu doluysa (rpc_admin_adjust, kendi JWT'siyle)
  if (parsed.data.adjustAmount && parsed.data.adjustAmount !== 0) {
    const adj = await adminAdjust(parsed.data.id, parsed.data.adjustAmount, parsed.data.adjustDesc || "Panel bakiye ayarı");
    if (!adj.ok) return badRequest(adj.error || "Bakiye ayarlanamadı.");
  }
  return ok({ updated: true }, "Kullanıcı güncellendi.");
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "users.delete") && !s.isAdmin) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id gerekli.");
  if (id === s.id) return badRequest("Kendinizi silemezsiniz.");

  const user = await createUserClient();
  const { error } = await user.rpc("admin_delete_user", { p_user_id: id });
  if (error) return badRequest(error.message);
  return ok({ deleted: true }, "Kullanıcı silindi.");
}
