"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, StatusBadge, Empty, Modal, Field } from "@/components/ui";

export default function DestekPage() {
  const [rows, setRows] = useState<{ id: string; status: string; subject: string; lastMessage: string; createdAt: string; updatedAt: string; username: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [show, setShow] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<{ ticket: { id: string; status: string; subject: string }; messages: { id: string; userId: string; message: string; createdAt: string }[] } | null>(null);
  const [reply, setReply] = useState("");

  const load = (p = 1, pp = perPage) => {
    fetch(`/api/panel/support?page=${p}&perPage=${pp}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(); }, []);

  const open = async (id: string) => {
    const r = await fetch(`/api/panel/support?id=${id}`);
    const j = await r.json();
    if (j.success) setDetail(j.data);
  };

  const create = async () => {
    const r = await fetch("/api/panel/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, message }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setShow(false); setSubject(""); setMessage(""); load(page, perPage); }
  };

  const sendReply = async () => {
    if (!detail || !reply.trim()) return;
    const r = await fetch("/api/panel/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: detail.ticket.id, message: reply }) });
    const j = await r.json();
    if (j.success) { setReply(""); open(detail.ticket.id); load(page, perPage); }
  };

  return (
    <div>
      <PageTitle>Destek Talepleri</PageTitle>
      <div className="flex justify-between items-center mb-3">
        <button onClick={() => setShow(true)} className="btn-primary text-[13px] px-4 py-2.5">+ Yeni Destek Talebi</button>
        <button className="btn-outline w-10 h-10 grid place-items-center">⧩</button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>Durum ⧩</th><th>Mesaj</th><th>Oluşturulma Tarihi ↕ ⧩</th><th className="sorted-col">Güncellenme Tarihi ⤓</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4}><Empty text="Veri bulunamadı!" /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row cursor-pointer" onClick={() => open(r.id)}>
                <td><StatusBadge status={r.status} /></td>
                <td><b>#{r.id} {r.subject}</b><div className="text-[12px] text-slate-500 truncate max-w-[400px]">{r.lastMessage}</div></td>
                <td className="text-[12px]">{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                <td className="text-[12px]">{new Date(r.updatedAt).toLocaleString("tr-TR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp)} />
      </div>

      {show && (
        <Modal title="Yeni Destek Talebi" onClose={() => setShow(false)}>
          <Field label="Konu"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Mesaj"><textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          <div className="flex justify-end gap-3"><button onClick={() => setShow(false)} className="text-[#0FB5A0] text-sm font-semibold">İptal</button><button onClick={create} className="btn-green text-sm px-5 py-2">+ Oluştur</button></div>
        </Modal>
      )}

      {detail && (
        <Modal title={`#${detail.ticket.id} ${detail.ticket.subject}`} wide onClose={() => setDetail(null)}>
          <div className="space-y-2 max-h-80 overflow-auto mb-4">
            {detail.messages.map((m) => (
              <div key={m.id} className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-[13px]">
                <div>{m.message}</div>
                <div className="text-[11px] text-slate-400 mt-1">{new Date(m.createdAt).toLocaleString("tr-TR")}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Yanıt yazın..." />
            <button onClick={sendReply} className="btn-primary px-5 text-sm">Gönder</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
