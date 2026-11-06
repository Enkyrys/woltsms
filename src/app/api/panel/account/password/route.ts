import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { validatePasswordPolicy } from "@/lib/security";
import { ok, unauthorized, badRequest, tooMany } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  currentPassword: z.string().min(1, "Mevcut şifrenizi girin."),
  newPassword: z.string().min(1, "Yeni şifreyi girin."),
  confirmPassword: z.string().min(1, "Yeni şifreyi tekrar girin."),
  signOutOthers: z.boolean().optional(),
});

// POST: kullanıcı kendi şifresini değiştirir (mevcut şifre doğrulanır)
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
  const { currentPassword, newPassword, confirmPassword, signOutOthers } = parsed.data;

  if (newPassword !== confirmPassword) return badRequest("Yeni şifreler birbiriyle eşleşmiyor.");
  if (newPassword === currentPassword) return badRequest("Yeni şifre mevcut şifreden farklı olmalı.");
  const pwError = validatePasswordPolicy(newPassword);
  if (pwError) return badRequest(pwError);

  const admin = createAdminClient();
  // kaba kuvvet koruması: kullanıcı başına 15 dakikada 5 deneme
  const { data: allowed } = await admin.rpc("rate_limit_check", { p_key: `pwchange:${s.id}`, p_max: 5, p_window_seconds: 900 });
  if (allowed === false) return tooMany("Çok fazla deneme. Lütfen 15 dakika sonra tekrar deneyin.");

  // mevcut şifreyi doğrula: çerezlere dokunmayan ayrı bir istemciyle giriş denemesi
  const { data: au } = await admin.auth.admin.getUserById(s.id);
  const email = au?.user?.email;
  if (!email) return badRequest("Hesap bilgisi bulunamadı.");
  const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: verifyErr } = await verifier.auth.signInWithPassword({ email, password: currentPassword });
  if (verifyErr) {
    await admin.from("audit_logs").insert({ actor_id: s.id, action: "account.password_change_failed", payload: { reason: "wrong_current_password" } });
    return badRequest("Mevcut şifre hatalı.");
  }
  await verifier.auth.signOut().catch(() => undefined); // doğrulama oturumunu kapat

  const { error } = await admin.auth.admin.updateUserById(s.id, {
    password: newPassword,
    user_metadata: { ...(au?.user?.user_metadata ?? {}), password_changed_at: new Date().toISOString() },
  });
  if (error) return badRequest("Şifre değiştirilemedi. Lütfen tekrar deneyin.");

  // isteğe bağlı: diğer cihazlardaki oturumları kapat (bu oturum açık kalır)
  let othersSignedOut = false;
  if (signOutOthers) {
    try {
      const user = await createUserClient();
      const { error: soErr } = await user.auth.signOut({ scope: "others" });
      othersSignedOut = !soErr;
    } catch { /* yok say */ }
  }

  await admin.from("audit_logs").insert({ actor_id: s.id, action: "account.password_change", payload: { others_signed_out: othersSignedOut } });
  return ok({ changed: true, othersSignedOut }, othersSignedOut ? "Şifreniz değiştirildi, diğer cihazlardaki oturumlar kapatıldı." : "Şifreniz değiştirildi.");
}
