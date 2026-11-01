"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Empty, CopyBtn } from "@/components/ui";

export default function KisaUrlPage() {
  const [rows, setRows] = useState<{ id: string; businessName: string; originalUrl: string; slug: string; shortUrl: string; clicks: number; username: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState("");
  const [biz, setBiz] = useState("");

  const load = (p = 1, pp = perPage) => {
    fetch(`/api/panel/shorturls?page=${p}&perPage=${pp}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const r = await fetch("/api/panel/shorturls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalUrl: url, businessName: biz }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setShow(false); setUrl(""); setBiz(""); load(page, perPage); }
  };

  return (
    <div>
      <PageTitle>Kısa URL&apos;ler</PageTitle>
      <div className="flex justify-end mb-3">
        <button onClick={() => setShow(true)} className="text-white text-[13px] font-semibold px-10 py-2.5 rounded-lg flex items-center gap-6" style={{ background: "#0FB5A0" }}>
          <span>🔗</span> short link
        </button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>ID</th><th>İşletme Adı</th><th>Orijinal URL</th><th>Kısa URL</th><th>Tıklamalar</th><th>Oluşturan</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7}><Empty text="Kısa URL bulunamadı." /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row">
                <td>{r.id}</td><td>{r.businessName || "-"}</td>
                <td className="max-w-[260px] truncate text-[12px]">{r.originalUrl}</td>
                <td><a href={r.shortUrl} target="_blank" className="text-[#0FB5A0] font-mono text-[12px]">/s/{r.slug}</a> <CopyBtn text={r.shortUrl} /></td>
                <td>{r.clicks}</td><td>{r.username}</td>
                <td><button onClick={async () => { if (confirm("Silinsin mi?")) { await fetch(`/api/panel/shorturls?id=${r.id}`, { method: "DELETE" }); load(page, perPage); } }} className="text-red-500 text-[12px]">Sil</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp)} />
      </div>

      {show && (
        <div className="fixed inset-0 z-50 modal-backdrop grid place-items-center p-4" onClick={() => setShow(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg p-8 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShow(false)} className="absolute top-4 right-4 w-8 h-8 grid place-items-center rounded-full bg-slate-100">✕</button>
            <h2 className="text-2xl font-bold mb-5">Generate_Your <span className="text-green-500">ShortURL</span></h2>
            <label className="label">Link</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="input mb-4" placeholder="https://example.com" />
            <label className="label">İşletme Adı</label>
            <p className="text-[12px] text-slate-500 mb-2">This will be used in your branded short link</p>
            <div className="flex mb-5">
              <span className="px-5 grid place-items-center bg-slate-100 rounded-l-lg text-slate-400 text-sm border">Alan Adı/</span>
              <input value={biz} onChange={(e) => setBiz(e.target.value)} className="input !rounded-l-none" placeholder="YourBusinessName" />
            </div>
            <button onClick={save} className="w-full py-3 rounded-lg bg-blue-400 hover:bg-blue-500 text-white font-semibold text-sm">Generate ShortURL</button>
          </div>
        </div>
      )}
    </div>
  );
}
