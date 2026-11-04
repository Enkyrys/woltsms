import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey, encrypt, randomToken } from "@/lib/security";
import { ok, unauthorized, badRequest, notFound } from "@/lib/api-response";

export const runtime = "nodejs";

// GET: kullanıcının anahtarları (hash asla dönmez)
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, key_encrypted, status, ip_whitelist, callback_url, last_used_at, created_at")
    .eq("user_id", s.id)
    .order("created_at", { ascending: false });

  return ok(
    (data ?? []).map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key_prefix,
      revealable: !!k.key_encrypted, // şifreli kopya varsa tekrar gösterilebilir
      status: k.status,
      ipWhitelist: Array.isArray(k.ip_whitelist) ? (k.ip_whitelist as string[]).join(", ") : "",
      callbackUrl: k.callback_url ?? "",
      lastUsedAt: k.last_used_at,
      createdAt: k.created_at,
    }))
  );
}

const CreateSchema = z.object({
  name: z.string().optional(),
  ipWhitelist: z.string().optional(),
  callbackUrl: z.string().url().optional().or(z.literal("").transform(() => undefined)),
});

// POST: anahtar üret (bir kez gösterilir)
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");

  const { key, prefix, hash } = generateApiKey();
  const secret = `wss_${randomToken(24)}`; // isteğe bağlı X-Signature imzası için
  const ips = (parsed.data.ipWhitelist || "")
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: s.id,
      name: parsed.data.name || "API Anahtarı",
      key_prefix: prefix,
      key_hash: hash,
      key_encrypted: encrypt(key),
      hmac_secret_encrypted: encrypt(secret),
      ip_whitelist: ips,
      callback_url: parsed.data.callbackUrl || null,
    })
    .select("id, name, key_prefix, created_at")
    .single();

  if (error) return badRequest(error.message);
  return ok(
    {
      id: data.id,
      name: data.name,
      keyPrefix: data.key_prefix,
      key,
      secret,
      // eski arayüzle uyum için takma adlar
      apiKey: key,
      apiSecret: secret,
      createdAt: data.created_at,
    },
    "API anahtarı oluşturuldu."
  );
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  ipWhitelist: z.string().optional(),
  callbackUrl: z.string().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");

  const ips = parsed.data.ipWhitelist !== undefined
    ? parsed.data.ipWhitelist.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
    : undefined;

  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (ips !== undefined) update.ip_whitelist = ips;
  if (parsed.data.callbackUrl !== undefined) update.callback_url = parsed.data.callbackUrl || null;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;

  const { error } = await admin.from("api_keys").update(update).eq("id", parsed.data.id).eq("user_id", s.id);
  if (error) return badRequest(error.message);
  return ok({ updated: true }, "Güncellendi.");
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id gerekli.");
  const admin = createAdminClient();
  const { error } = await admin.from("api_keys").delete().eq("id", id).eq("user_id", s.id);
  if (error) return badRequest(error.message);
  return ok({ deleted: true }, "Silindi.");
}
