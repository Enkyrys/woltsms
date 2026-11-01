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
  const id = url.searchParams.get("id");

  if (id) {
    const { data: ticket } = await admin.from("support_tickets").select("*").eq("id", id).maybeSingle();
    if (!ticket || (!s.isAdmin && ticket.user_id !== s.id)) return notFound();
    const { data: msgs } = await admin
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });
    return ok({
      ticket: {
        id: ticket.id,
        status: ticket.status,
        subject: ticket.subject,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
      },
      messages: (msgs ?? []).map((m) => ({
        id: m.id,
        userId: m.user_id,
        isAdmin: m.is_admin,
        body: m.body,
        message: m.body, // panel sayfasının beklediği alan adı
        createdAt: m.created_at,
      })),
    });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(100, Number(url.searchParams.get("perPage") || 10));
  let q = admin
    .from("support_tickets")
    .select("*, profiles:user_id(username)", { count: "exact" });
  if (!s.isAdmin) q = q.eq("user_id", s.id);
  const { count, data } = await q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  // son mesajlar (liste kartında "son mesaj" önizlemesi)
  const ids = (data ?? []).map((t) => t.id);
  const lastByTicket = new Map<string, string>();
  if (ids.length) {
    const { data: lastMsgs } = await admin
      .from("ticket_messages")
      .select("ticket_id, body, created_at")
      .in("ticket_id", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    for (const m of lastMsgs ?? []) {
      if (!lastByTicket.has(m.ticket_id)) lastByTicket.set(m.ticket_id, m.body);
    }
  }

  return ok(
    (data ?? []).map((t) => ({
      id: t.id,
      status: t.status,
      subject: t.subject,
      message: t.subject,
      lastMessage: lastByTicket.get(t.id) ?? t.subject,
      username: (t.profiles as unknown as { username?: string } | null)?.username ?? "",
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}

// Panel hem POST {subject,message} (yeni talep) hem POST {ticketId,message} (yanıt)
// hem de PATCH {id,body} kullanır; üçünü de kabul ederiz.
const CreateSchema = z.object({
  subject: z.string().min(1, "Konu gerekli."),
  message: z.string().min(1, "Mesaj gerekli.").optional(),
  body: z.string().min(1).optional(),
}).refine((v) => Boolean(v.message || v.body), { message: "Mesaj gerekli." });

const ReplySchema = z.object({
  id: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
  body: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  isAdmin: z.boolean().optional(),
}).refine((v) => Boolean((v.id || v.ticketId) && (v.body || v.message)), {
  message: "Geçersiz istek.",
});

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const body = await req.json().catch(() => ({}));

  const parsed = CreateSchema.safeParse(body);
  if (parsed.success) {
    const user = await createUserClient();
    const { data, error } = await user.rpc("rpc_create_ticket", {
      p_subject: parsed.data.subject,
      p_body: parsed.data.message || parsed.data.body || "",
    });
    if (error) return badRequest(error.message);
    return ok(data as Record<string, unknown>, "Destek talebi oluşturuldu.");
  }

  const reply = ReplySchema.safeParse(body);
  if (reply.success) {
    if (reply.data.isAdmin && !hasPermissionSync(s, "support.manage")) return forbidden();
    const user = await createUserClient();
    const { error } = await user.rpc("rpc_reply_ticket", {
      p_ticket_id: reply.data.ticketId || reply.data.id,
      p_body: reply.data.body || reply.data.message || "",
      p_is_admin: reply.data.isAdmin ?? false,
    });
    if (error) return badRequest(error.message);
    return ok({ replied: true }, "Yanıt gönderildi.");
  }

  return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
}

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const parsed = ReplySchema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");
  if (parsed.data.isAdmin && !hasPermissionSync(s, "support.manage")) return forbidden();

  const user = await createUserClient();
  const { error } = await user.rpc("rpc_reply_ticket", {
    p_ticket_id: parsed.data.ticketId || parsed.data.id,
    p_body: parsed.data.body || parsed.data.message || "",
    p_is_admin: parsed.data.isAdmin ?? false,
  });
  if (error) return badRequest(error.message);
  return ok({ replied: true }, "Yanıt gönderildi.");
}
