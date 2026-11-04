"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, StatusBadge, OrderStatusBadge, ORDER_STATUS_LABELS, Empty, Modal } from "@/components/ui";
import CampaignEditModal, { type EditableCampaign } from "@/components/CampaignEditModal";

// Sağlayıcı saati veritabanında saat dilimsiz duvar saati olarak tutulur ("2026-11-05T06:02:00").
// new Date() ile çevrilmez (tarayıcı kendi saatine kaydırırdı); olduğu gibi biçimlendirilir.
function fmtProviderTime(v: unknown, tz: unknown): string {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return "-";
  return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} ${String(tz || "UTC")}`;
}
const fmtLocal = (v: unknown) => (v ? new Date(String(v)).toLocaleString("tr-TR") : "-");
const pretty = (v: unknown) => {
  if (v === null || v === undefined) return "-";
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

type Row = {
  id: string; name: string | null; status: string; totalCount: number; processedCount: number; failedCount: number;
  username: string; scheduledAt: string | null; providerScheduledAt: string | null; providerTimezone: string;
  providerTriggeredAt: string | null; createdAt: string; message: string; note: string;
};
type Detail = {
  order: {
    id: string; name: string | null; status: string; message: string; note: string | null;
    totalCount: number; dispatchedCount: number; successCount: number; deliveredCount: number; unsentFailedCount: number;
    totalCost: string; scheduledAt: string | null; providerScheduledAt: string | null; providerTimezone: string;
    providerTriggeredAt: string | null; dispatchFinishedAt: string | null; lastProviderResponse: unknown;
    editable: boolean; createdAt: string; source: string;
  };
  messages: { id: string; recipient: string; status: string; segments: number; cost: string; attempts: number; errorCode: string | null; providerMessageId: string | null }[];
  attempts: { id: number; recipient: string; attempt: number; ok: boolean; outcome: string; httpStatus: number | null; errorCode: string | null; response: unknown; createdAt: string }[];
};

const OUTCOME: Record<string, string> = { sent: "Başarılı", retry: "Yeniden denenecek", failed: "Başarısız", ignored: "Tekrar (yok sayıldı)" };

export default function SiparislerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<EditableCampaign | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (p = page, pp = perPage, st = status, q = search) => {
    fetch(`/api/panel/orders?page=${p}&perPage=${pp}&status=${encodeURIComponent(st)}&q=${encodeURIComponent(q)}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => {
    load(1, 10, "", "");
    fetch("/api/auth/me").then(async (r) => { if (r.ok) { const j = await r.json(); setIsAdmin(!!j.data?.isAdmin); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sağlayıcı API'si pasifken bekleyen siparişi manuel olarak "iletildi" onayla (admin)
  const deliver = async (id: string) => {
    if (!confirm("Bu kampanya iletildi olarak onaylansın mı? Mesajlar 'İletildi' işaretlenir ve bakiye kesinleşir.")) return;
    setBusy(true);
    const r = await fetch("/api/panel/admin/orders/deliver", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setNotice(j.success ? `Kampanya iletildi olarak onaylandı (${j.data?.messages ?? 0} mesaj).` : (j.message || "İşlem başarısız."));
    setDetail(null);
    load(page, perPage, status);
  };
  const canDeliver = (st: string) => isAdmin && (st === "pending" || st === "scheduled" || st === "processing");

  const open = async (id: string) => {
    const r = await fetch(`/api/panel/orders?id=${id}`);
    const j = await r.json();
    if (j.success) setDetail(j.data);
  };

  const cancel = async (id: string) => {
    if (!confirm("Kampanya iptal edilsin mi? Gönderilmemiş mesajların bedeli iade edilir.")) return;
    const r = await fetch(`/api/panel/orders?id=${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    setNotice(j.message || (j.success ? "İptal edildi." : "İptal edilemedi."));
    setDetail(null);
    load(page, perPage, status);
  };

  const o = detail?.order;

  return (
    <div>
      <PageTitle>Kampanyalar</PageTitle>
      {notice && <div className="card mb-3 text-sm flex justify-between"><span>{notice}</span><button onClick={() => setNotice("")}>✕</button></div>}
      <div className="flex justify-between gap-2 mb-3 flex-wrap">
        <a href="/panel/zamanlanmis" className="btn-outline text-[13px] px-4 py-2">🕒 Zamanlanmış Kampanyalar</a>
        <button onClick={() => setShowFilter(!showFilter)} className="btn-outline w-10 h-10 grid place-items-center" aria-label="Filtre">⧩</button>
      </div>
      {showFilter && (
        <div className="card mb-3 flex gap-3 items-center flex-wrap">
          <span className="text-sm">Durum:</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); load(1, perPage, e.target.value); }} className="input !w-56">
            <option value="">Tümü</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input className="input !w-64" placeholder="Kampanya adı / mesaj ara" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(1, perPage, status, search); }} />
          <button className="btn-primary px-4 py-2 text-[13px]" onClick={() => load(1, perPage, status, search)}>Ara</button>
        </div>
      )}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b">
            <th>Kampanya</th><th>Durum</th><th>Başarılı / Toplam</th><th>Oluşturan</th><th>Planlanan Gönderim</th><th title="ENKYRYS'e gönderim saati (UTC)">ENKYRYS Saati (UTC)</th><th className="sorted-col">Oluşturulma ⤓</th>{isAdmin && <th>İşlem</th>}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={isAdmin ? 8 : 7}><Empty text="Kampanya bulunamadı." /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row cursor-pointer" onClick={() => open(r.id)}>
                <td>
                  <div className="font-bold text-[#0FB5A0]">{r.name || `#${r.id.slice(0, 8)}`}</div>
                  <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{r.message}</div>
                </td>
                <td><OrderStatusBadge status={r.status} /></td>
                <td>{r.processedCount}/{r.totalCount}{r.failedCount > 0 && <span className="text-red-600 text-[12px]"> · {r.failedCount} başarısız</span>}</td>
                <td>{r.username}</td>
                <td>{fmtLocal(r.scheduledAt)}</td>
                <td>
                  <span className="font-mono text-[12px]">{r.status === "draft" ? "-" : fmtProviderTime(r.providerScheduledAt, r.providerTimezone)}</span>
                  {r.providerTriggeredAt && <div className="text-[11px] text-[#0A8F7E]">✓ ENKYRYS&apos;e gönderildi</div>}
                </td>
                <td>{fmtLocal(r.createdAt)}</td>
                {isAdmin && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {canDeliver(r.status) && <button disabled={busy} className="btn-outline text-[12px] px-2.5 py-1" onClick={() => deliver(r.id)}>İletildi Onayla</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp, status)} />
      </div>

      {detail && o && (
        <Modal title={o.name || `Kampanya #${o.id.slice(0, 8)}`} wide onClose={() => setDetail(null)}>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm mb-4">
            <div><b>Kampanya adı:</b> {o.name || "-"}</div>
            <div><b>Durum:</b> <OrderStatusBadge status={o.status} /></div>
            <div><b>Toplam alıcı:</b> {o.totalCount}</div>
            <div><b>Gönderilen (API&apos;ye iletilen):</b> {o.dispatchedCount}</div>
            <div><b>Başarılı:</b> <span className="text-green-700 font-semibold">{o.successCount}</span>{o.deliveredCount > 0 && <span className="text-slate-500"> ({o.deliveredCount} teslim edildi)</span>}</div>
            <div><b>Başarısız:</b> <span className="text-red-700 font-semibold">{o.unsentFailedCount}</span></div>
            <div><b>Planlanan gönderim:</b> {o.status === "draft" ? "-" : fmtLocal(o.scheduledAt)} <span className="text-slate-400">(sizin saatiniz)</span></div>
            <div><b>ENKYRYS saati:</b> <span className="font-mono">{o.status === "draft" ? "-" : fmtProviderTime(o.providerScheduledAt, o.providerTimezone)}</span></div>
            <div><b>Gerçek gönderim başlangıcı:</b> {o.providerTriggeredAt ? fmtLocal(o.providerTriggeredAt) : o.status === "scheduled" ? "Zamanı bekleniyor" : o.status === "draft" ? "-" : "Başlatılıyor…"}</div>
            <div><b>Gönderim bitişi:</b> {fmtLocal(o.dispatchFinishedAt)}</div>
            <div><b>Tutar:</b> ₺{o.totalCost}</div>
            <div><b>Oluşturulma:</b> {fmtLocal(o.createdAt)} · {o.source === "api" ? "API" : "Panel"}</div>
            <div className="sm:col-span-2"><b>SMS içeriği:</b> <span className="whitespace-pre-wrap">{o.message}</span></div>
            {o.note ? <div className="sm:col-span-2"><b>Not:</b> {o.note}</div> : null}
          </div>

          <div className="flex gap-2 mb-4 flex-wrap">
            <a className="btn-outline text-[12px] px-3 py-1.5" href={`/api/panel/orders?id=${o.id}&export=csv`}>CSV İndir</a>
            {o.status === "draft" && <a className="btn-primary text-[12px] px-3 py-1.5" href={`/panel/dashboard?draft=${o.id}`}>Taslağı Aç / Gönder</a>}
            {o.editable && (
              <button className="btn-primary text-[12px] px-3 py-1.5" onClick={() => setEditing({ id: o.id, name: o.name, message: o.message, scheduledAt: o.scheduledAt })}>Düzenle</button>
            )}
            {canDeliver(o.status) && (
              <button disabled={busy} className="btn-outline text-[12px] px-3 py-1.5" onClick={() => deliver(o.id)}>İletildi Olarak Onayla</button>
            )}
            {(o.status === "scheduled" || o.status === "pending" || o.status === "draft") && (
              <button className="btn-red text-[12px] px-3 py-1.5" onClick={() => cancel(o.id)}>İptal Et</button>
            )}
          </div>

          <div className="mb-4">
            <div className="font-bold text-sm mb-1">API yanıtı (son)</div>
            <pre className="text-[11px] bg-slate-50 dark:bg-slate-800 rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap break-all">{pretty(o.lastProviderResponse)}</pre>
          </div>

          {detail.attempts.length > 0 && (
            <div className="mb-4">
              <div className="font-bold text-sm mb-1">API gönderim denemeleri</div>
              <div className="max-h-56 overflow-auto border rounded-lg">
                <table className="w-full text-[12px]">
                  <thead><tr className="bg-slate-50 text-left"><th className="p-2">Zaman</th><th className="p-2">Numara</th><th className="p-2">Deneme</th><th className="p-2">Sonuç</th><th className="p-2">HTTP</th><th className="p-2">Hata</th></tr></thead>
                  <tbody>
                    {detail.attempts.map((a) => (
                      <tr key={a.id} className="border-t" title={pretty(a.response)}>
                        <td className="p-2 whitespace-nowrap">{fmtLocal(a.createdAt)}</td>
                        <td className="p-2">{a.recipient}</td>
                        <td className="p-2">{a.attempt}</td>
                        <td className={`p-2 font-semibold ${a.ok ? "text-green-700" : a.outcome === "retry" ? "text-amber-700" : a.outcome === "ignored" ? "text-slate-500" : "text-red-700"}`}>{OUTCOME[a.outcome] || a.outcome}</td>
                        <td className="p-2">{a.httpStatus ?? "-"}</td>
                        <td className="p-2 break-all">{a.errorCode || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="max-h-80 overflow-auto border rounded-lg">
            <table className="w-full text-[13px]">
              <thead><tr className="bg-slate-50 text-left"><th className="p-2">Numara</th><th className="p-2">Durum</th><th className="p-2">Deneme</th><th className="p-2">Segment</th><th className="p-2">Tutar</th><th className="p-2">Hata</th></tr></thead>
              <tbody>
                {detail.messages.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="p-2">{m.recipient}</td><td className="p-2"><StatusBadge status={m.status} /></td>
                    <td className="p-2">{m.attempts}</td><td className="p-2">{m.segments}</td><td className="p-2">₺{m.cost}</td>
                    <td className="p-2 text-[11px] text-red-700 break-all">{m.errorCode || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {editing && (
        <CampaignEditModal
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); if (detail) open(detail.order.id); load(page, perPage, status); }}
        />
      )}
    </div>
  );
}
