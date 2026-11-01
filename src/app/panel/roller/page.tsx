"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Modal, Field, Empty } from "@/components/ui";

export default function RollerPage() {
  const [rows, setRows] = useState<{ id: string; name: string; readOnly: boolean; createdAt: string; updatedAt: string; permissions: string[] }[]>([]);
  const [perms, setPerms] = useState<{ code: string; name: string; groupName: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<{ id?: string; name: string; readOnly: boolean; permissions: string[] }>({ name: "", readOnly: false, permissions: [] });

  const load = (p = 1, pp = perPage) => {
    fetch(`/api/panel/roles?page=${p}&perPage=${pp}&search=${encodeURIComponent(search)}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(); fetch("/api/panel/roles?action=permissions").then(async (r) => { const j = await r.json(); if (j.success) setPerms(j.data); }); }, []);

  const save = async () => {
    const r = await fetch("/api/panel/roles", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setShow(false); load(page, perPage); }
  };

  const toggle = (code: string) => {
    setForm({ ...form, permissions: form.permissions.includes(code) ? form.permissions.filter((p) => p !== code) : [...form.permissions, code] });
  };

  const groups = [...new Set(perms.map((p) => p.groupName || "genel"))];

  return (
    <div>
      <PageTitle>Roller</PageTitle>
      <div className="flex justify-between items-center mb-3 gap-2">
        <button onClick={() => { setForm({ name: "", readOnly: false, permissions: [] }); setShow(true); }} className="btn-primary text-[13px] px-4 py-2.5">+ Yeni Rol Ekle</button>
        <div className="flex gap-2">
          <button className="btn-outline w-10 h-10 grid place-items-center">⧩</button>
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(1, perPage)} className="input !w-48" placeholder="🔍 Ara" />
        </div>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>Rol ↕ ⧩</th><th>Salt Okunur</th><th>Oluşturulma Tarihi ↕ ⧩</th><th>Güncellenme Tarihi ↕ ⧩</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5}><Empty text="Veri bulunamadı!" /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row">
                <td className="text-[#0FB5A0] font-semibold cursor-pointer" onClick={() => { setForm({ id: r.id, name: r.name, readOnly: r.readOnly, permissions: r.permissions }); setShow(true); }}>{r.name}</td>
                <td>{r.readOnly ? "✔" : "-"}</td>
                <td>{new Date(r.createdAt).toLocaleDateString("tr-TR")}</td>
                <td>{new Date(r.updatedAt).toLocaleDateString("tr-TR")}</td>
                <td className="text-[12px] text-slate-400">{r.permissions.length} yetki</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp)} />
      </div>

      {show && (
        <Modal title={form.id ? "Rol Düzenle" : "Yeni Rol"} wide onClose={() => setShow(false)}>
          <Field label="Rol Adı"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Consumer" /></Field>
          <label className="flex items-center gap-2 text-sm mb-4"><input type="checkbox" checked={form.readOnly} onChange={(e) => setForm({ ...form, readOnly: e.target.checked })} /> Salt Okunur</label>
          <div className="text-sm font-bold mb-2">Yetki Matrisi</div>
          {groups.map((g) => (
            <div key={g} className="mb-3 border rounded-lg p-3">
              <div className="text-[12px] font-bold uppercase text-slate-400 mb-2">{g}</div>
              <div className="grid grid-cols-2 gap-2">
                {perms.filter((p) => (p.groupName || "genel") === g).map((p) => (
                  <label key={p.code} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={form.permissions.includes(p.code)} onChange={() => toggle(p.code)} />
                    {p.name} <span className="text-slate-400 text-[11px]">({p.code})</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShow(false)} className="text-[#0FB5A0] font-semibold text-sm">İptal</button>
            <button onClick={save} className="btn-green text-sm px-5 py-2">+ Kaydet</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
