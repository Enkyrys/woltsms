import { NextResponse } from "next/server";
import { getSession, getPermissions, loadUserWithRole } from "@/lib/auth";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ success: false, code: 401, message: "Oturum yok." }, { status: 401 });
  const full = await loadUserWithRole(s.id);
  if (!full) return NextResponse.json({ success: false, code: 401, message: "Kullanıcı bulunamadı." }, { status: 401 });
  const perms = s.isAdmin ? ["*"] : await getPermissions(s.roleId);
  return NextResponse.json({
    success: true,
    code: 200,
    message: "OK",
    data: {
      ...s,
      quota: String(full.quota ?? "0"),
      unitPrice: String(full.unitPrice ?? "1"),
      quotaType: full.quotaType,
      permissions: perms,
    },
  });
}
