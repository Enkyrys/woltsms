import { getSession } from "@/lib/auth";
import { unauthorized } from "@/lib/api-response";

export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized("Oturum yok.");

  return Response.json({
    success: true,
    code: 200,
    message: "OK",
    data: {
      id: s.id,
      username: s.username,
      name: s.name,
      email: s.email,
      roleId: s.roleId,
      roleName: s.roleName,
      isAdmin: s.isAdmin,
      quota: s.balance,
      balance: s.balance,
      reserved: s.reserved,
      unitPrice: s.unitPrice,
      quotaType: s.quotaType,
      permissions: s.permissions,
    },
  });
}
