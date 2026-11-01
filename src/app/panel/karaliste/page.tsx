"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination } from "@/components/ui";

export default function KaralistePage() {
  const [numbers, setNumbers] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; phone: string; createdAt: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [total, setTotal] = useState(0);

  const load = (p = 1, pp = perPage, query = q) => {
    fetch(`/api/panel/blacklist?page=${p}&perPage=${pp}&q=${encodeURIComponent(query)}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const r = await fetch("/api/panel/blacklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", phones: numbers }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setNumbers(""); load(1, perPage, q); }
  };
  const remove = async () => {
    if (!numbers.trim()) return;
    const phones = numbers.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
    const r = await fetch("/api/panel/blacklist", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", phones }) });
    const j = await r.json();
    alert(j.message);
    setNumbers(""); load(1, perPage, q);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setNumbers((p) => (p ? p + "\n" : "") + t.split(/\r?\n/).map((l) => l.split(/[;,]/)[0].trim()).filter(Boolean).join("\n"));
  };

  return (
    <div>
      <PageTitle>Karaliste</PageTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <label className="label">Telefon numaraları</label>
          <textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={5} className="input" />
          <p className="text-[11px] text-slate-500 mt-1">Girmiş olduğunuz telefon numaraları virgül, noktalı virgül ve yeni satıra göre ayrıştırılır.</p>
          <div className="card mt-3 !p-4">
            <div className="flex gap-2 mb-3">
              <label className="btn-primary text-[13px] px-4 py-2 cursor-pointer">+ Seç<input type="file" className="hidden" accept=".txt,.csv" onChange={onFile} /></label>
              <button onClick={() => setNumbers("")} className="text-[13px] px-4 py-2 rounded-lg text-white font-semibold" style={{ background: "#5ECDC0" }}>✕ Vazgeç</button>
            </div>
            <div className="border-t pt-4 text-[13px]">Yüklemek için dosyaları buraya sürükleyip bırakın.</div>
          </div>
          <div className="flex justify-between mt-4 max-w-md">
            <button onClick={add} className="btn-green px-8 py-2.5 text-sm">+ &nbsp; Ekle</button>
            <button onClick={remove} className="btn-red px-8 py-2.5 text-sm">🗑 &nbsp; Sil</button>
          </div>
        </div>
        <div>
          <label className="label">Telefon numarası ara</label>
          <div className="flex">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(1, perPage, q)} className="input !rounded-r-none" placeholder="Ara" />
            <button onClick={() => load(1, perPage, q)} className="px-5 rounded-r-lg text-white" style={{ background: "#0FB5A0" }}>🔍</button>
          </div>
          <div className="card !p-0 mt-4 overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                {rows.length === 0 && <tr><td className="p-3 text-slate-500">Kayıt bulunamadı.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-3 font-mono">{r.phone}</td>
                    <td className="p-3 text-right"><button onClick={async () => { await fetch("/api/panel/blacklist", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", ids: [r.id] }) }); load(page, perPage, q); }} className="text-red-500 text-[12px]">Sil</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > 0 && <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp, q)} />}
          </div>
        </div>
      </div>
    </div>
  );
}
