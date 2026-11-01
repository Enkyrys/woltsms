import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(50, Number(url.searchParams.get("perPage") || 10));

  const { count, data } = await admin
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", s.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const rows = (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    message: n.body,
    isRead: !!n.read_at,
    createdAt: n.created_at,
    created_at: n.created_at,
  }));

  return ok(
    { list: rows, unread: rows.filter((r) => !r.isRead).length },
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

// PATCH / POST: okundu olarak işaretle (panel "tümünü okundu işaretle" POST kullanır)
export async function POST(req: Request) {
  return markRead(req);
}

export async function PATCH(req: Request) {
  return markRead(req);
}

async function markRead(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const all = body.all === true || body.action === "read-all";
  if (all) {
    await admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", s.id).is("read_at", null);
  } else if (body.id) {
    await admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", body.id).eq("user_id", s.id);
  }
  return ok({ updated: true }, "OK");
}
