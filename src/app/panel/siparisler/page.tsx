"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, StatusBadge, Empty, Modal } from "@/components/ui";

// Sağlayıcı saati veritabanında saat dilimsiz duvar saati olarak tutulur ("2026-11-05T06:02:00").
// new Date() ile çevrilmez (tarayıcı kendi saatine kaydırırdı); olduğu gibi biçimlendirilir.
function fmtProviderTime(v: unknown, tz: unknown): string {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return "-";
  return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} ${String(tz || "UTC")}`;
}
const fmtLocal = (v: unknown) => (v ? new Date(String(v)).toLocaleString("tr-TR") : "-");

export default function SiparislerPage() {
  const [rows, setRows] = useState<{ id: string; status: string; totalCount: number; processedCount: number; username: string; scheduledAt: string; providerScheduledAt: string | null; providerTimezone: string; providerTriggeredAt: string | null; createdAt: string; message: string; note: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState<{ order: Record<string, string | number>; messages: { id: string; recipient: string; status: string; segments: number; cost: string }[] } | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (p = page, pp = perPage, st = status) => {
    fetch(`/api/panel/orders?page=${p}&perPage=${pp}&status=${st}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => {
    load(1, 10, "");
    fetch("/api/auth/me").then(async (r) => { if (r.ok) { const j = await r.json(); setIsAdmin(!!j.data?.isAdmin); } });
  }, []);

  // Sağlayıcı API'si pasifken bekleyen siparişi manuel olarak "iletildi" onayla (admin)
  const deliver = async (id: string) => {
    if (!confirm("Bu sipariş iletildi olarak onaylansın mı? Mesajlar 'İletildi' işaretlenir ve bakiye kesinleşir.")) return;
    setBusy(true);
    const r = await fetch("/api/panel/admin/orders/deliver", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setNotice(j.success ? `Sipariş iletildi olarak onaylandı (${j.data?.messages ?? 0} mesaj).` : (j.message || "İşlem başarısız."));
    setDetail(null);
    load(page, perPage, status);
  };
  const canDeliver = (st: string) => isAdmin && (st === "pending" || st === "scheduled" || st === "processing");

  const open = async (id: string) => {
    const r = await fetch(`/api/panel/orders?id=${id}&perPage=50`);
    const j = await r.json();
    if (j.success) setDetail(j.data);
  };

  return (
    <div>
      <PageTitle>Siparişler</PageTitle>
      {notice && <div className="card mb-3 text-sm flex justify-between"><span>{notice}</span><button onClick={() => setNotice("")}>✕</button></div>}
      <div className="flex justify-end mb-3">
        <button onClick={() => setShowFilter(!showFilter)} className="btn-outline w-10 h-10 grid place-items-center">⧩</button>
      </div>
      {showFilter && (
        <div className="card mb-3 flex gap-3 items-center">
          <span className="text-sm">Durum:</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); load(1, perPage, e.target.value); }} className="input !w-48">
            <option value="">Tümü</option>
            <option value="pending">Bekliyor</option><option value="scheduled">Zamanlı</option>
            <option value="processing">İşleniyor</option><option value="completed">Tamamlandı</option>
            <option value="failed">Başarısız</option><option value="cancelled">İptal</option>
          </select>
        </div>
      )}
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b">
            <th>ID</th><th>Durum ↕ ⧩</th><th>İşlenen ↕ ⧩</th><th>Oluşturan</th><th title="Siparişin Sempico'ya iletilen oluşturma saati (UTC)">Sağlayıcı Saati (Sempico UTC)</th><th className="sorted-col">Oluşturulma Tarihi ⤓ ⧩</th>{isAdmin && <th>İşlem</th>}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={isAdmin ? 7 : 6}><Empty text="Sipariş bulunamadı." /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row cursor-pointer" onClick={() => open(r.id)}>
                <td className="font-bold text-[#0FB5A0]">#{r.id}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.processedCount}/{r.totalCount}</td>
                <td>{r.username}</td>
                <td>
                  <span className="font-mono text-[12px]">{fmtProviderTime(r.providerScheduledAt, r.providerTimezone)}</span>
                  {r.providerTriggeredAt && <div className="text-[11px] text-[#0A8F7E]">✓ Sempico'ya gönderildi</div>}
                </td>
                <td>{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
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

      {detail && (
        <Modal title={`Sipariş #${detail.order.id}`} wide onClose={() => setDetail(null)}>
          <div className="text-sm space-y-1 mb-3">
            <div><b>Durum:</b> <StatusBadge status={String(detail.order.status)} /> · {String(detail.order.processedCount)}/{String(detail.order.totalCount)}</div>
            <div><b>Oluşturma (gönderici) saati:</b> {fmtLocal(detail.order.createdAt)} <span className="text-slate-400">(sizin saatiniz)</span></div>
            <div><b>Sağlayıcı saati (Sempico):</b> <span className="font-mono">{fmtProviderTime(detail.order.providerScheduledAt, detail.order.providerTimezone)}</span></div>
            <div><b>Sempico'ya gönderim:</b> {detail.order.providerTriggeredAt ? fmtLocal(detail.order.providerTriggeredAt) : "Gönderiliyor…"}</div>
            <div><b>Mesaj:</b> {String(detail.order.message)}</div>
            {detail.order.note ? <div><b>Not:</b> {String(detail.order.note)}</div> : null}
          </div>
          <div className="flex gap-2 mb-3">
            <a className="btn-outline text-[12px] px-3 py-1.5" href={`/api/panel/orders?id=${detail.order.id}&export=csv`}>CSV İndir</a>
            {canDeliver(String(detail.order.status)) && (
              <button disabled={busy} className="btn-primary text-[12px] px-3 py-1.5" onClick={() => deliver(String(detail.order.id))}>İletildi Olarak Onayla</button>
            )}
            {(detail.order.status === "scheduled" || detail.order.status === "pending") && (
              <button className="btn-red text-[12px] px-3 py-1.5" onClick={async () => { if (!confirm("İptal edilsin mi? İade yapılır.")) return; await fetch(`/api/panel/orders?id=${detail.order.id}`, { method: "DELETE" }); setDetail(null); load(page, perPage, status); }}>İptal Et</button>
            )}
          </div>
          <div className="max-h-80 overflow-auto border rounded-lg">
            <table className="w-full text-[13px]">
              <thead><tr className="bg-slate-50 text-left"><th className="p-2">Numara</th><th className="p-2">Durum</th><th className="p-2">Segment</th><th className="p-2">Tutar</th></tr></thead>
              <tbody>
                {detail.messages.map((m) => (
                  <tr key={m.id} className="border-t"><td className="p-2">{m.recipient}</td><td className="p-2"><StatusBadge status={m.status} /></td><td className="p-2">{m.segments}</td><td className="p-2">₺{m.cost}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
