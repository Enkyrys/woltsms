import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { generateSlug } from "@/lib/security";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const page = Math.max(1, Number(new URL(req.url).searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(new URL(req.url).searchParams.get("perPage") || 10));

  let q = admin.from("short_urls").select("*", { count: "exact" });
  if (!s.isAdmin) q = q.eq("user_id", s.id);
  const { count, data } = await q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  return ok(
    (data ?? []).map((u) => ({
      id: u.id,
      businessName: u.business_name,
      originalUrl: u.original_url,
      slug: u.slug,
      shortUrl: `${process.env.APP_URL || ""}/s/${u.slug}`,
      clicks: u.clicks,
      createdAt: u.created_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

const CreateSchema = z.object({
  originalUrl: z.string().url("Geçerli bir URL girin."),
  businessName: z.string().optional(),
  slug: z.string().min(3).max(20).regex(/^[a-z0-9-]+$/, "Slug yalnızca küçük harf, rakam ve tire içerebilir.").optional(),
});

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "shorturl.manage")) return forbidden();

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");

  const slug = parsed.data.slug || generateSlug();
  const user = await createUserClient();
  const { data, error } = await user.rpc("rpc_create_short_url", {
    p_original_url: parsed.data.originalUrl,
    p_business_name: parsed.data.businessName || "",
    p_slug: slug,
  });
  if (error) {
    if (error.message.includes("duplicate")) return badRequest("Bu slug zaten kullanılıyor.");
    return badRequest(error.message);
  }
  return ok(
    { id: (data as { id: string }).id, slug, shortUrl: `${process.env.APP_URL || ""}/s/${slug}` },
    "Kısa URL oluşturuldu."
  );
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "shorturl.manage")) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id gerekli.");
  const user = await createUserClient();
  const { error } = await user.rpc("rpc_delete_short_url", { p_id: id });
  if (error) return badRequest(error.message);
  return ok({ deleted: true }, "Silindi.");
}
