import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePasswordPolicy } from "@/lib/security";
import { ok, badRequest, unauthorized } from "@/lib/api-response";

export const runtime = "nodejs";

// İlk admin'i oluşturur (yalnız bootstrap; sonraki kullanımlarda 409 döner).
// Güvenlik: BOOTSTRAP_TOKEN env'i zorunlu; üretimde migration/seed.sql ile de yapılabilir.
const Schema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  bootstrapToken: z.string(),
});

export async function POST(req: Request) {
  const expected = process.env.BOOTSTRAP_TOKEN;
  if (!expected) return badRequest("BOOTSTRAP_TOKEN tanımlı değil; bu uç nokta devre dışı.");

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");
  if (parsed.data.bootstrapToken !== expected) return unauthorized("Geçersiz bootstrap token.");

  const pwError = validatePasswordPolicy(parsed.data.password);
  if (pwError) return badRequest(pwError);

  const admin = createAdminClient();

  // admin rolünü bul
  const { data: role } = await admin.from("roles").select("id").eq("name", "admin").maybeSingle();
  if (!role) return badRequest("admin rolü bulunamadı; migration'ları uygulayın.");

  // tek kullanımlık bootstrap: yalnız henüz admin yokken çalışır
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("role_id", role.id)
    .limit(1)
    .maybeSingle();
  if (existing) return Response.json(
    { success: false, code: 409, message: "Zaten bir admin var; bu uç nokta kapalı." },
    { status: 409 }
  );

  const username = parsed.data.username.toLowerCase();
  const email = parsed.data.email.toLowerCase();
  const { data: dupe } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (dupe) return badRequest("Kullanıcı adı zaten alınmış.");

  // service_role ile doğrudan oluştururuz (auth.uid() yok; RPC'ler auth ister)
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (authErr || !created.user) return badRequest(`Kullanıcı oluşturulamadı: ${authErr?.message}`);

  const uid = created.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    id: uid,
    username,
    name: parsed.data.name || "Yönetici",
    role_id: role.id,
    quota_type: "variable",
    created_by: null,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    return badRequest(pErr.message);
  }
  await admin.from("wallets").insert({ user_id: uid, balance: 0, reserved: 0 });
  await admin.from("audit_logs").insert({
    actor_id: uid,
    action: "seed.first_admin",
    payload: { username, email } as never,
  });

  return ok({ id: uid, username }, "İlk admin oluşturuldu.");
}
