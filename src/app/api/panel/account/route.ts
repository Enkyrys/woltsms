import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hesabım: kullanıcının kendi bilgileri
//   GET   → profil, e-posta, rol, son giriş
//   PATCH → isim, telefon, e-posta (kullanıcı adı ve rol yalnız admin tarafından değişir)
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const [{ data: p }, { data: au }] = await Promise.all([
    admin.from("profiles").select("username, name, phone, two_factor_enabled, last_login_at, created_at").eq("id", s.id).maybeSingle(),
    admin.auth.admin.getUserById(s.id),
  ]);
  const email = au?.user?.email ?? "";
  return ok({
    username: p?.username ?? s.username,
    name: p?.name ?? s.name,
    phone: p?.phone ?? "",
    // otomatik üretilmiş dahili adres kullanıcıya boş gösterilir
    email: email.endsWith("@woltsms.local") ? "" : email,
    roleName: s.roleName,
    twoFactor: !!p?.two_factor_enabled,
    lastLoginAt: p?.last_login_at ?? null,
    createdAt: p?.created_at ?? null,
    passwordChangedAt: (au?.user?.user_metadata as { password_changed_at?: string } | undefined)?.password_changed_at ?? null,
  });
}

const PatchSchema = z.object({
  name: z.string().trim().min(1, "İsim boş olamaz.").max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Geçerli bir e-posta girin.")]).optional(),
});

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
  const b = parsed.data;
  const admin = createAdminClient();

  const prof: Record<string, unknown> = {};
  if (b.name !== undefined) prof.name = b.name;
  if (b.phone !== undefined) prof.phone = b.phone === "" ? null : b.phone;
  if (Object.keys(prof).length) {
    prof.updated_at = new Date().toISOString();
    const { error } = await admin.from("profiles").update(prof).eq("id", s.id);
    if (error) return badRequest("Bilgiler kaydedilemedi.");
  }

  if (b.email !== undefined && b.email !== "") {
    const { data: au } = await admin.auth.admin.getUserById(s.id);
    if ((au?.user?.email || "").toLowerCase() !== b.email.toLowerCase()) {
      const { error } = await admin.auth.admin.updateUserById(s.id, { email: b.email.toLowerCase(), email_confirm: true });
      if (error) {
        return badRequest(/already|registered|exists|duplicate/i.test(error.message) ? "Bu e-posta başka bir kullanıcıda kayıtlı." : "E-posta güncellenemedi.");
      }
    }
  }

  await admin.from("audit_logs").insert({ actor_id: s.id, action: "account.update", payload: { fields: Object.keys(b) } });
  return ok({ updated: true }, "Bilgileriniz güncellendi.");
}
