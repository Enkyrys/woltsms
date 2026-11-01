import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { ok, unauthorized, forbidden, badRequest, notFound } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "numbers" && url.searchParams.get("id")) {
    const id = url.searchParams.get("id")!;
    const { data: list } = await admin.from("contact_lists").select("*").eq("id", id).maybeSingle();
    if (!list || (!s.isAdmin && list.user_id !== s.id)) return notFound();
    const { data: nums } = await admin.from("contacts").select("phone").eq("list_id", id).limit(100000);
    return ok((nums ?? []).map((n) => n.phone));
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  let q = admin.from("contact_lists").select("*", { count: "exact" });
  if (!s.isAdmin) q = q.eq("user_id", s.id);
  const { count, data } = await q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  return ok(
    (data ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      count: l.count,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

const CreateSchema = z.object({
  title: z.string().min(1, "Başlık gerekli."),
  numbers: z.string().optional(),
});

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "contacts.manage")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Geçersiz JSON.");
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");

  const { parseRecipients } = await import("@/lib/sms/segments");
  const numbers = parseRecipients(parsed.data.numbers || "");

  const user = await createUserClient();
  const { data, error } = await user.rpc("rpc_create_contact_list", {
    p_title: parsed.data.title,
    p_numbers: numbers,
  });
  if (error) return badRequest(error.message);
  const d = data as { id: string; count: number };
  return ok({ id: d.id, title: parsed.data.title, count: d.count }, "Rehber eklendi.");
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "contacts.manage")) return forbidden();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return badRequest("id gerekli.");
  const admin = createAdminClient();
  const { error } = await admin.from("contact_lists").delete().eq("id", id).eq("user_id", s.id);
  if (error) return badRequest(error.message);
  return ok({ deleted: true }, "Rehber silindi.");
}
