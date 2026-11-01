"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Modal, Field, Empty } from "@/components/ui";

export default function RehberPage() {
  const [rows, setRows] = useState<{ id: string; title: string; count: number; createdAt: string; updatedAt: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [numbers, setNumbers] = useState("");
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const INLINE_MAX = 1024 * 1024; // 1 MB üstü dosya tarayıcıya yapıştırılmaz, Storage üzerinden işlenir

  const load = (p = page, pp = perPage) => {
    fetch(`/api/panel/contacts?page=${p}&perPage=${pp}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(1, 10); }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);

    if (f.size > INLINE_MAX) {
      // büyük dosya: imzalı Storage yükleme + kuyruk (sayfa boyutu aşmaz)
      setFile(f);
      return;
    }
    setFile(null);

    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const XLSX = await import("xlsx");
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf);
      const rows2 = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      const phones = rows2.map((r) => String(r[0] || "").trim()).filter(Boolean);
      setNumbers((p) => (p ? p + "\n" : "") + phones.join("\n"));
    } else {
      const t = await f.text();
      setNumbers((p) => (p ? p + "\n" : "") + t.split(/\r?\n/).map((l) => l.split(/[;,	]/)[0].trim()).filter(Boolean).join("\n"));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      // 1) metin varsa doğrudan rehber oluştur
      if (numbers.trim()) {
        const r = await fetch("/api/panel/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, numbers }) });
        const j = await r.json();
        alert(j.message);
        if (j.success) { setShow(false); setTitle(""); setNumbers(""); setFile(null); setFileName(""); load(1, perPage); }
        return;
      }

      // 2) büyük dosya: Storage'a imzalı yükle → içe aktarma kuyruğu
      if (file) {
        const upReq = await fetch("/api/panel/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket: "imports", filename: file.name, contentType: file.type || "text/csv" }),
        });
        const upJ = await upReq.json();
        if (!upJ.success) { alert(upJ.message); return; }

        const put = await fetch(upJ.data.uploadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${upJ.data.token}`, "x-upsert": "true" },
          body: file,
        });
        if (!put.ok) { alert("Dosya yüklenemedi."); return; }

        const impReq = await fetch("/api/panel/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "contact_list", storagePath: upJ.data.path, filename: file.name, listTitle: title || file.name }),
        });
        const impJ = await impReq.json();
        alert(impJ.success ? `${impJ.message} (${impJ.data?.pollUrl ?? ""})` : impJ.message);
        if (impJ.success) { setShow(false); setTitle(""); setNumbers(""); setFile(null); setFileName(""); load(1, perPage); }
        return;
      }

      alert("Numara girin ya da dosya seçin.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm("Rehber silinsin mi?")) return;
    await fetch(`/api/panel/contacts?id=${id}`, { method: "DELETE" });
    load(page, perPage);
  };

  return (
    <div>
      <PageTitle>Rehber</PageTitle>
      <div className="flex justify-between items-center mb-3">
        <button onClick={() => setShow(true)} className="btn-primary text-[13px] px-4 py-2.5">+ Yeni Rehber Ekle</button>
        <button className="btn-outline w-10 h-10 grid place-items-center">⧩</button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b border-slate-100">
            <th>Başlık ↕</th><th>Adet ↕</th><th className="sorted-col">Oluşturulma Tarihi ⤓</th><th>Güncellenme Tarihi ↕</th><th></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5}><Empty text="Rehber bulunamadı!" /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row">
                <td className="font-semibold">{r.title}</td><td>{r.count}</td>
                <td>{new Date(r.createdAt).toLocaleString("tr-TR")}</td><td>{new Date(r.updatedAt).toLocaleString("tr-TR")}</td>
                <td><button onClick={() => del(r.id)} className="text-red-500 text-[12px]">Sil</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp)} />
      </div>

      {show && (
        <Modal title="Rehber Ekle" onClose={() => setShow(false)}>
          <Field label="Başlık"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık" /></Field>
          <Field label="Numaralar"><textarea className="input" rows={4} value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="Numaralar" /></Field>
          <Field label="Dosya">
            <label className="btn-primary inline-flex text-[13px] px-4 py-2 cursor-pointer">⬆ Seç<input type="file" className="hidden" accept=".xlsx,.xls,.csv,.txt" onChange={onFile} /></label>
            {fileName && <span className="ml-2 text-[12px]">{fileName}</span>}
            <p className="text-[11px] mt-2">Maksimum dosya boyutu 25 MB. (excel, csv, txt)<br />Excel ve csv dosyalarınızda telefon numaraları &apos;A&apos; kolonunda bulunmak zorundadır.</p>
          </Field>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShow(false)} className="text-[#0FB5A0] font-semibold text-sm">İptal</button>
            <button onClick={save} disabled={saving} className="btn-green text-sm px-5 py-2 disabled:opacity-50">{saving ? "Kaydediliyor..." : "+ Ekle"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
