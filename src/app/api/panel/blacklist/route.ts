import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { parseRecipients } from "@/lib/sms-segments";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 20));

  let query = admin.from("blacklist").select("*", { count: "exact" });
  if (!s.isAdmin) query = query.or(`user_id.eq.${s.id},user_id.is.null`);
  if (q) query = query.ilike("phone", `%${q}%`);

  const { count, data } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  return ok(
    (data ?? []).map((b) => ({
      id: b.id,
      phone: b.phone,
      userId: b.user_id,
      createdAt: b.created_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

const AddSchema = z.object({
  action: z.literal("add"),
  phones: z.string().min(1),
});

const RemoveSchema = z.object({
  action: z.literal("remove"),
  ids: z.array(z.string().uuid()).min(1).optional(),
  phones: z.union([z.string(), z.array(z.string())]).optional(),
}).refine((v) => Boolean(v.ids?.length || v.phones), { message: "ids veya phones gerekli." });

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "blacklist.manage")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Geçersiz JSON.");
  }
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");

  const phones = parseRecipients(parsed.data.phones);
  const user = await createUserClient();
  const { data, error } = await user.rpc("rpc_upsert_blacklist", { p_phones: phones, p_remove: false });
  if (error) return badRequest(error.message);
  return ok(data as Record<string, unknown>, "Karalisteye eklendi.");
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "blacklist.manage")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Geçersiz JSON.");
  }
  const parsed = RemoveSchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");

  const admin = createAdminClient();
  let deleted = 0;
  if (parsed.data.ids?.length) {
    let q = admin.from("blacklist").delete().in("id", parsed.data.ids);
    if (!s.isAdmin) q = q.eq("user_id", s.id);
    const { error } = await q;
    if (error) return badRequest(error.message);
    deleted = parsed.data.ids.length;
  }
  if (parsed.data.phones) {
    const raw = Array.isArray(parsed.data.phones) ? parsed.data.phones.join("\n") : parsed.data.phones;
    const phones = parseRecipients(raw);
    if (phones.length) {
      let q = admin.from("blacklist").delete().in("phone", phones);
      if (!s.isAdmin) q = q.eq("user_id", s.id);
      const { error } = await q;
      if (error) return badRequest(error.message);
      deleted = phones.length;
    }
  }
  return ok({ deleted }, "Silindi.");
}
