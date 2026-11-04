import { authenticateApiRequest } from "@/lib/auth";
import { applyCorsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// GET /api/v1/connection
// Bayi bağlantı kontrolü: Authorization: Bearer <anahtar> ile gelen anahtarı api_keys tablosundan
// doğrular ve user_id / key_encrypted / hmac_secret_encrypted kayıtlarını kontrol eder.
//   Kayıt varsa  → { connected: true,  message: "Bağlandı" }
//   Yoksa/geçersiz → { connected: false, message: "Bağlantı yok: ..." }
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return applyCorsHeaders(
      Response.json(
        { success: false, code: auth.code, connected: false, message: `Bağlantı yok: ${auth.error}` },
        { status: auth.code }
      ),
      req
    );
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("api_keys")
    .select("id, user_id, key_prefix, key_encrypted, hmac_secret_encrypted, status, last_used_at, created_at")
    .eq("id", auth.apiKeyId)
    .maybeSingle();

  if (!row || !row.user_id) {
    return applyCorsHeaders(
      Response.json(
        { success: false, code: 404, connected: false, message: "Bağlantı yok: anahtar kaydı bulunamadı." },
        { status: 404 }
      ),
      req
    );
  }

  return applyCorsHeaders(
    Response.json({
      success: true,
      code: 200,
      connected: true,
      message: "Bağlandı",
      data: {
        api_key_id: row.id,
        key_prefix: row.key_prefix,
        status: row.status,
        checks: {
          user_id: !!row.user_id,
          key_encrypted: !!row.key_encrypted, // false → anahtar eski sürümde üretilmiş (panelde tekrar gösterilemez)
          hmac_secret_encrypted: !!row.hmac_secret_encrypted, // true → X-Signature imzası kullanılabilir
        },
        last_used_at: row.last_used_at,
        created_at: row.created_at,
      },
    }),
    req
  );
}
