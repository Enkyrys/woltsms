import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "roles.view") && !s.isAdmin) return forbidden();

  const admin = createAdminClient();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const { data: role } = await admin.from("roles").select("*").eq("id", id).maybeSingle();
    const { data: assigned } = await admin.from("role_permissions").select("permission_code").eq("role_id", id);
    const { data: allPerms } = await admin.from("permissions").select("*").order("group_name").order("code");
    return ok({
      role,
      assigned: (assigned ?? []).map((r) => r.permission_code),
      all: allPerms ?? [],
    });
  }

  // panel "Yetki Matrisi" kataloğu
  if (url.searchParams.get("action") === "permissions") {
    const { data: allPerms } = await admin
      .from("permissions")
      .select("code, name, group_name")
      .order("group_name")
      .order("code");
    return ok((allPerms ?? []).map((p) => ({
      code: p.code,
      name: p.name,
      groupName: p.group_name,
    })), "OK");
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const search = url.searchParams.get("search") || "";

  let listQ = admin.from("roles").select("*", { count: "exact" });
  if (search) listQ = listQ.ilike("name", `%${search}%`);
  const { count, data } = await listQ
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  // satır bazlı yetki sayıları (liste "N yetki" ve düzenleme formu için)
  const roleIds = (data ?? []).map((r) => r.id);
  const permsByRole = new Map<string, string[]>();
  if (roleIds.length) {
    const { data: rps } = await admin
      .from("role_permissions")
      .select("role_id, permission_code")
      .in("role_id", roleIds);
    for (const rp of rps ?? []) {
      const arr = permsByRole.get(rp.role_id) ?? [];
      arr.push(rp.permission_code);
      permsByRole.set(rp.role_id, arr);
    }
  }

  return ok(
    (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      readOnly: r.read_only,
      permissions: permsByRole.get(r.id) ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

const CreateSchema = z.object({
  name: z.string().min(1),
  readOnly: z.boolean().optional(),
});

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "roles.manage") && !s.isAdmin) return forbidden();

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");

  const user = await createUserClient();
  const { data, error } = await user.rpc("admin_create_role", {
    p_name: parsed.data.name,
    p_read_only: parsed.data.readOnly ?? false,
  });
  if (error) return badRequest(error.message);
  return ok(data as Record<string, unknown>, "Rol oluşturuldu.");
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  readOnly: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (!hasPermissionSync(s, "roles.manage") && !s.isAdmin) return forbidden();

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");

  const user = await createUserClient();
  if (parsed.data.permissions) {
    const { error } = await user.rpc("admin_set_role_permissions", {
      p_role_id: parsed.data.id,
      p_codes: parsed.data.permissions,
    });
    if (error) return badRequest(error.message);
  }
  if (parsed.data.name !== undefined) {
    const { error } = await user.rpc("admin_update_role", {
      p_role_id: parsed.data.id,
      p_name: parsed.data.name,
      p_read_only: parsed.data.readOnly ?? false,
    });
    if (error) return badRequest(error.message);
  }
  return ok({ updated: true }, "Rol güncellendi.");
}
