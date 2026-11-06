import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePasswordPolicy } from "@/lib/security";
import { clientIp } from "@/lib/presence";

export const runtime = "nodejs";

// POST /api/auth/register — ana sayfadaki "Yeni Üyelik Aç" formu.
// Hesap askıda açılır; admin Üyelik Yönetimi'nden onaylayınca giriş yapılabilir.
const Schema = z.object({
  name: z.string().trim().min(2, "Ad soyad / firma adı girin.").max(120),
  username: z.string().trim().min(3, "Kullanıcı adı en az 3 karakter olmalı.").max(32, "Kullanıcı adı en fazla 32 karakter olabilir.")
    .regex(/^[A-Za-z0-9._-]+$/, "Kullanıcı adı yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir."),
  phone: z.string().trim().min(10, "Geçerli bir telefon numarası girin.").max(20).regex(/^[0-9+()\s-]+$/, "Geçerli bir telefon numarası girin."),
  email: z.union([z.literal(""), z.string().trim().email("Geçerli bir e-posta girin.")]).optional(),
  password: z.string().min(1, "Şifre gerekli."),
  passwordConfirm: z.string().min(1, "Şifreyi tekrar girin."),
  note: z.string().max(500).optional(),
  accept: z.literal(true, { errorMap: () => ({ message: "Devam etmek için koşulları onaylayın." }) }),
  website: z.string().optional(), // bal küpü: botlar doldurur, insanlar görmez
});

const ERRORS: Record<string, { msg: string; code: number }> = {
  SIGNUP_DISABLED: { msg: "Yeni üyelik alımı şu an kapalı. Lütfen bizimle iletişime geçin.", code: 403 },
  INVALID_USERNAME: { msg: "Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, tire, alt çizgi.", code: 400 },
  NAME_REQUIRED: { msg: "Ad soyad / firma adı girin.", code: 400 },
  USERNAME_TAKEN: { msg: "Bu kullanıcı adı alınmış. Başka bir kullanıcı adı deneyin.", code: 409 },
  EMAIL_TAKEN: { msg: "Bu e-posta ile zaten bir üyelik var.", code: 409 },
  TOO_MANY_SIGNUPS: { msg: "Bu bağlantıdan bekleyen çok fazla başvuru var. Lütfen bizimle iletişime geçin.", code: 429 },
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, code: 400, message: parsed.error.errors[0]?.message || "Geçersiz istek." }, { status: 400 });
  }
  const b = parsed.data;

  // bot: bal küpü doluysa başarılı gibi yanıt ver ama hiçbir şey oluşturma
  if (b.website && b.website.trim() !== "") {
    return NextResponse.json({ success: true, code: 200, message: "Başvurunuz alındı." });
  }
  if (b.password !== b.passwordConfirm) {
    return NextResponse.json({ success: false, code: 400, message: "Şifreler birbiriyle eşleşmiyor." }, { status: 400 });
  }
  const pwError = validatePasswordPolicy(b.password);
  if (pwError) return NextResponse.json({ success: false, code: 400, message: pwError }, { status: 400 });

  const ip = clientIp(req);
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("rate_limit_check", { p_key: `signup:${ip}`, p_max: 5, p_window_seconds: 3600 });
  if (allowed === false) {
    return NextResponse.json({ success: false, code: 429, message: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." }, { status: 429 });
  }

  const { data, error } = await admin.rpc("rpc_register_member", {
    p_username: b.username,
    p_password: b.password,
    p_name: b.name,
    p_phone: b.phone,
    p_email: b.email || null,
    p_note: b.note || null,
    p_ip: ip,
  });
  if (error) {
    const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
    const e = key ? ERRORS[key] : { msg: "Başvuru alınamadı. Lütfen daha sonra tekrar deneyin.", code: 400 };
    return NextResponse.json({ success: false, code: e.code, message: e.msg }, { status: e.code });
  }
  const d = data as { username: string };
  return NextResponse.json({
    success: true,
    code: 200,
    message: "Başvurunuz alındı. Üyeliğiniz onaylanınca kullanıcı adınız ve şifrenizle giriş yapabilirsiniz.",
    data: { username: d.username, status: "pending" },
  });
}
