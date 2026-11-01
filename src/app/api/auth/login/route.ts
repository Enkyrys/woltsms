import { NextResponse } from "next/server";
import { z } from "zod";
import { loginWithUsername } from "@/lib/auth";
import { badRequest, unauthorized } from "@/lib/api-response";
import { createAdminClient } from "@/lib/supabase/admin";

const LoginSchema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli."),
  password: z.string().min(1, "Şifre gerekli."),
  token: z.string().optional(), // 2FA TOTP (opsiyonel)
});

// Giriş: kullanıcı adı sunucuda e-postaya çözülür, Supabase Auth signInWithPassword.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Geçersiz JSON.");
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
  }
  const { username, password } = parsed.data;

  // brute-force koruması (ip başına)
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = (fwd.split(",")[0] || "unknown").trim();
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("rate_limit_check", {
    p_key: `login:${ip}`,
    p_max: Number(process.env.LOGIN_RATE_LIMIT || 10),
    p_window_seconds: 300,
  });
  if (allowed === false) {
    return NextResponse.json(
      { success: false, code: 429, message: "Çok fazla giriş denemesi. Lütfen 5 dakika bekleyin." },
      { status: 429 }
    );
  }

  const result = await loginWithUsername(username.trim(), password);
  if (!result.ok) {
    // başarısız denemeyi audit'a yaz
    void Promise.resolve(
      admin.from("audit_logs").insert({ action: "auth.login_failed", ip, payload: { username } })
    ).catch(() => undefined);
    return unauthorized(result.error);
  }

  return NextResponse.json({ success: true, code: 200, message: "Giriş başarılı." });
}
