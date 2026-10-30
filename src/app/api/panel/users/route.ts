import { NextResponse } from "next/server";
import { db, pool } from "@/db";
import { users, roles, auditLogs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSession, hasPermission } from "@/lib/auth";
import { hashPassword, validatePasswordPolicy } from "@/lib/security";
import { creditBalance } from "@/lib/services";

function like(col: string, v: string) {
  return `${col} ILIKE '%${v.replace(/'/g, "''")}%'`;
}

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "users.manage"))) {
    return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  }
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("perPage") || 10)));
  const search = url.searchParams.get("search") || "";
  const sort = url.searchParams.get("sort") || "createdAt";
  const dir = (url.searchParams.get("dir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const sortMap: Record<string, string> = {
    username: "u.username", name: "u.name", email: "u.email", createdAt: "u.created_at", updatedAt: "u.updated_at", quota: "u.quota",
  };
  const orderCol = sortMap[sort] || "u.created_at";
  let where = "1=1";
  if (search) where += ` AND (${like("u.username", search)} OR ${like("u.name", search)} OR ${like("u.email", search)})`;
  const total = Number((await pool.query(`SELECT COUNT(*) c FROM users u WHERE ${where}`)).rows[0].c);
  const rows = (
    await pool.query(
      `SELECT u.id, u.username, u.name, u.email, u.phone, u.role_id as "roleId", r.name as "roleName", u.quota_type as "quotaType", u.quota, u.unit_price as "unitPrice", u.is_active as "isActive", u.two_factor as "twoFactor", u.created_at as "createdAt", u.updated_at as "updatedAt" FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE ${where} ORDER BY ${orderCol} ${dir} LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    )
  ).rows;
  return NextResponse.json({ success: true, code: 200, message: "OK", data: rows, meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "users.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const b = await req.json();
  const { name, username, email, phone, password, quotaType, quota, roleId, unitPrice } = b;
  if (!name || !username || !email || !password) return NextResponse.json({ success: false, code: 400, message: "Zorunlu alanlar eksik." }, { status: 400 });
  const pwErr = validatePasswordPolicy(String(password));
  if (pwErr) return NextResponse.json({ success: false, code: 422, message: pwErr }, { status: 422 });
  try {
    const ins = await db
      .insert(users)
      .values({
        name: String(name),
        username: String(username),
        email: String(email),
        phone: phone ? String(phone) : null,
        passwordHash: await hashPassword(String(password)),
        quotaType: quotaType === "fixed" ? "fixed" : "variable",
        quota: String(Number(quota || 0)),
        roleId: roleId ? Number(roleId) : null,
        unitPrice: String(Number(unitPrice || 1)),
        isActive: true,
      })
      .returning();
    await db.insert(auditLogs).values({ actorId: s.id, action: "users.create", payload: JSON.stringify({ id: ins[0].id, username }) });
    return NextResponse.json({ success: true, code: 200, message: "Kullanıcı oluşturuldu.", data: ins[0] });
  } catch (e) {
    return NextResponse.json({ success: false, code: 400, message: "Kullanıcı adı veya e-posta zaten kayıtlı." }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "users.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const b = await req.json();
  const { id, name, email, phone, quotaType, quota, roleId, unitPrice, isActive, password, adjustAmount, adjustDesc } = b;
  if (!id) return NextResponse.json({ success: false, code: 400, message: "ID gerekli." }, { status: 400 });
  const rows = await db.select().from(users).where(eq(users.id, Number(id)));
  if (!rows[0]) return NextResponse.json({ success: false, code: 404, message: "Kullanıcı bulunamadı." }, { status: 404 });
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = String(name);
  if (email !== undefined) patch.email = String(email);
  if (phone !== undefined) patch.phone = phone ? String(phone) : null;
  if (quotaType !== undefined) patch.quotaType = quotaType === "fixed" ? "fixed" : "variable";
  if (roleId !== undefined) patch.roleId = roleId ? Number(roleId) : null;
  if (unitPrice !== undefined) patch.unitPrice = String(Number(unitPrice));
  if (isActive !== undefined) patch.isActive = Boolean(isActive);
  if (password) {
    const pwErr = validatePasswordPolicy(String(password));
    if (pwErr) return NextResponse.json({ success: false, code: 422, message: pwErr }, { status: 422 });
    patch.passwordHash = await hashPassword(String(password));
  }
  await db.update(users).set(patch).where(eq(users.id, Number(id)));
  // Manuel kredi ekle/çıkar
  if (adjustAmount !== undefined && Number(adjustAmount) !== 0) {
    const amt = Number(adjustAmount);
    if (amt > 0) {
      await creditBalance({ userId: Number(id), amount: amt, type: "adjust", description: adjustDesc || `Manuel kredi ekleme (admin: ${s.username})`, refType: "manual", refId: `admin-${s.id}` });
    } else {
      // negative adjust via direct update + transaction row
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const r = await client.query("SELECT quota FROM users WHERE id=$1 FOR UPDATE", [Number(id)]);
        const cur = Number(r.rows[0].quota ?? 0);
        const nb = cur + amt;
        if (nb < 0) throw new Error("Bakiye negatife düşemez.");
        await client.query("UPDATE users SET quota=$1 WHERE id=$2", [nb.toFixed(4), Number(id)]);
        await client.query(`INSERT INTO wallet_transactions (user_id,type,credit,unit_price,total_price,currency,balance_after,ref_type,ref_id,description) VALUES ($1,'adjust',$2,1,$3,'TRY',$4,'manual',$5,$6)`, [Number(id), amt.toFixed(4), amt.toFixed(4), nb.toFixed(4), `admin-${s.id}`, adjustDesc || `Manuel kredi düşme (admin: ${s.username})`]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        return NextResponse.json({ success: false, code: 400, message: e instanceof Error ? e.message : "Düzeltme hatası" }, { status: 400 });
      } finally {
        client.release();
      }
    }
  }
  await db.insert(auditLogs).values({ actorId: s.id, action: "users.update", payload: JSON.stringify({ id }) });
  return NextResponse.json({ success: true, code: 200, message: "Kullanıcı güncellendi." });
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum gerekli." }, { status: 401 });
  if (!(await hasPermission(s, "users.manage"))) return NextResponse.json({ success: false, code: 403, message: "Yetkiniz yok." }, { status: 403 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id || id === s.id) return NextResponse.json({ success: false, code: 400, message: "Geçersiz işlem." }, { status: 400 });
  await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, id));
  await db.insert(auditLogs).values({ actorId: s.id, action: "users.deactivate", payload: JSON.stringify({ id }) });
  return NextResponse.json({ success: true, code: 200, message: "Kullanıcı pasife alındı." });
}
