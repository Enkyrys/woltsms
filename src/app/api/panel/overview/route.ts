import { getSession } from "@/lib/auth";
import { unauthorized } from "@/lib/api-response";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();

  const admin = createAdminClient();
  const uid = s.id;
  const scope = s.isAdmin ? null : uid;

  const [{ count: ordersCount }, { count: smsCount }, { count: deliveredCount }, { count: pendingTopups }, { data: notifs }, { data: anns }] =
    await Promise.all([
      scope
        ? admin.from("orders").select("id", { count: "exact", head: true }).eq("user_id", scope)
        : admin.from("orders").select("id", { count: "exact", head: true }),
      admin
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .match(scope ? { user_id: scope } : {}),
      admin
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "delivered")
        .match(scope ? { user_id: scope } : {}),
      admin
        .from("topup_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "reported"])
        .match(scope ? { user_id: scope } : {}),
      admin
        .from("notifications")
        .select("id, type, title, body, read_at, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(10),
      admin.from("announcements").select("id, text").eq("is_active", true).limit(3),
    ]);

  return Response.json({
    success: true,
    code: 200,
    message: "OK",
    data: {
      ordersCount: ordersCount ?? 0,
      smsCount: smsCount ?? 0,
      deliveredCount: deliveredCount ?? 0,
      balance: s.balance,
      reserved: s.reserved,
      pendingTopups: pendingTopups ?? 0,
      notifications: (notifs ?? []).map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        message: n.body,
        readAt: n.read_at,
        created_at: n.created_at,
        createdAt: n.created_at,
      })),
      announcements: (anns ?? []).map((a) => ({ id: a.id, text: a.text })),
      announcement: (anns ?? [])[0]?.text ?? "",
      quotaLabel: s.quotaType === "variable" ? "Kota yok" : "Değişken Kota",
    },
  });
}
