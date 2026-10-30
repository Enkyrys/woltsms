import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { roles, rolePermissions, permissions, auditLogs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSession, hasPermission } from "@/lib/auth";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "roles.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const url = new URL(req.url);
  if (url.searchParams.get("action") === "permissions") {
    const perms = await db.select().from(permissions);
    return NextResponse.json({ success: true, code: 200, message: "OK", data: perms });
  }
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  const search = url.searchParams.get("search") || "";
  let where = "1=1";
  if (search) where += ` AND name ILIKE '%${search.replace(/'/g, "''")}%'`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM roles WHERE ${where}`)).rows[0].c);
  const rows = (await pool.query(`SELECT id, name, read_only as "readOnly", created_at as "createdAt", updated_at as "updatedAt" FROM roles WHERE ${where} ORDER BY id ASC LIMIT $1 OFFSET $2`, [perPage, (page - 1) * perPage])).rows;
  // attach permissions
  for (const r of rows) {
    const rp = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, r.id));
    r.permissions = rp.map((x) => x.permissionCode);
  }
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "roles.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const b = await req.json();
  if (!b.name) return NextResponse.json({ success: false, code: 400, message: "Rol adı gerekli." }, { status: 400 });
  const ins = await db.insert(roles).values({ name: String(b.name), readOnly: Boolean(b.readOnly) }).returning();
  const perms: string[] = Array.isArray(b.permissions) ? b.permissions : [];
  for (const p of perms) await db.insert(rolePermissions).values({ roleId: ins[0].id, permissionCode: p });
  await db.insert(auditLogs).values({ actorId: s.id, action: "roles.create", payload: JSON.stringify({ name: b.name }) });
  return NextResponse.json({ success: true, code: 200, message: "Rol oluşturuldu.", data: ins[0] });
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "roles.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const b = await req.json();
  if (!b.id) return NextResponse.json({ success: false, code: 400, message: "ID gerekli." }, { status: 400 });
  await db.update(roles).set({ name: b.name ? String(b.name) : undefined, readOnly: b.readOnly !== undefined ? Boolean(b.readOnly) : undefined, updatedAt: new Date() }).where(eq(roles.id, Number(b.id)));
  if (Array.isArray(b.permissions)) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, Number(b.id)));
    for (const p of b.permissions) await db.insert(rolePermissions).values({ roleId: Number(b.id), permissionCode: String(p) });
  }
  await db.insert(auditLogs).values({ actorId: s.id, action: "roles.update", payload: JSON.stringify({ id: b.id }) });
  return NextResponse.json({ success: true, code: 200, message: "Rol güncellendi." });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "roles.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const rows = await db.select().from(roles).where(eq(roles.id, id));
  if (!rows[0]) return NextResponse.json({ success: false, code: 404, message: "Bulunamadı." }, { status: 404 });
  if (["admin", "Consumer", "Consumer_admin"].includes(rows[0].name)) {
    return NextResponse.json({ success: false, code: 400, message: "Sistem rolleri silinemez." }, { status: 400 });
  }
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
  await db.delete(roles).where(eq(roles.id, id));
  return NextResponse.json({ success: true, code: 200, message: "Rol silindi." });
}
