import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/security";
import { ok, unauthorized, badRequest, notFound } from "@/lib/api-response";

export const runtime = "nodejs";

// GET /api/panel/apikeys/reveal?id=<uuid>
// Yalnızca anahtarın sahibi kendi API anahtarının tam değerini görebilir.
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id gerekli.");

  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, key_encrypted, hmac_secret_encrypted")
    .eq("id", id)
    .eq("user_id", s.id)
    .maybeSingle();

  if (!data) return notFound("Anahtar bulunamadı.");
  if (!data.key_encrypted) {
    return badRequest("Bu anahtar eski sürümde üretildi, tam değeri saklanmıyor. Yeni anahtar üretin.");
  }

  try {
    const key = decrypt(data.key_encrypted);
    const secret = data.hmac_secret_encrypted ? decrypt(data.hmac_secret_encrypted) : null;
    await admin.from("audit_logs").insert({
      actor_id: s.id,
      action: "apikey.reveal",
      payload: { api_key_id: id },
    });
    return ok({ key, secret }, "OK");
  } catch {
    return badRequest("Anahtar çözülemedi (ENCRYPTION_KEY değişmiş olabilir).");
  }
}
