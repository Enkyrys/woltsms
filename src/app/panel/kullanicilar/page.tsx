"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Empty } from "@/components/ui";

export default function KullanicilarPage() {
  const [rows, setRows] = useState<{ id: string; username: string; name: string; email: string; phone: string; quotaType: string; quota: string; unitPrice: string; isActive: boolean; twoFactor: boolean; createdAt: string; updatedAt: string; roleName: string; roleId: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [edit, setEdit] = useState<Record<string, string | number | boolean> | null>(null);
  const [form, setForm] = useState({ name: "", username: "", quotaType: "variable", quota: "0", email: "", phone: "", password: "", roleId: "", unitPrice: "1" });
  const [adjust, setAdjust] = useState({ amount: "", desc: "" });

  const load = (p = page, pp = perPage, q = search) => {
    fetch(`/api/panel/users?page=${p}&perPage=${pp}&search=${encodeURIComponent(q)}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(1, 10, ""); fetch("/api/panel/roles?perPage=50").then(async (r) => { const j = await r.json(); if (j.success) setRoles(j.data); }); }, []);

  const genPw = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    let s = "Aa1!";
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setForm({ ...form, password: s });
  };

  const openNew = () => { setEdit(null); setForm({ name: "", username: "", quotaType: "variable", quota: "0", email: "", phone: "", password: "", roleId: "", unitPrice: "1" }); setAdjust({ amount: "", desc: "" }); setDrawer(true); };
  const openEdit = (r: (typeof rows)[0]) => {
    setEdit({ id: r.id });
    setForm({ name: r.name, username: r.username, quotaType: r.quotaType, quota: r.quota, email: r.email, phone: r.phone || "", password: "", roleId: String(r.roleId || ""), unitPrice: r.unitPrice });
    setAdjust({ amount: "", desc: "" });
    setDrawer(true);
  };

  const save = async () => {
    const url = "/api/panel/users";
    const method = edit ? "PATCH" : "POST";
    const body = edit ? { id: edit.id, ...form, adjustAmount: adjust.amount ? Number(adjust.amount) : undefined, adjustDesc: adjust.desc } : form;
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setDrawer(false); load(page, perPage, search); }
  };

  return (
    <div className="relative">
      <PageTitle>Kullanıcılar</PageTitle>
      <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <button onClick={openNew} className="btn-primary text-[13px] px-4 py-2.5">+ Yeni Kullanıcı Ekle</button>
        <div className="flex gap-2">
          <button className="btn-outline w-10 h-10 grid place-items-center">⧩</button>
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(1, perPage, search)} className="input !w-48" placeholder="🔍 Ara" />
          <button onClick={() => load(1, perPage, search)} className="btn-outline px-3 text-sm">Ara</button>
        </div>
      </div>
      <div className="card !p-0 overflow-auto">
        <table className="w-full table-head min-w-[1000px]">
          <thead><tr className="text-left border-b">
            <th>Kullanıcı Adı ↕ ⧩</th><th>Aktif mi? ↕</th><th>İsim ↕ ⧩</th><th>Kota tipi</th><th>Kota</th><th>E-posta ⧩</th><th>Telefon ⧩</th><th>2FA ⧩</th><th>Oluşturulma Tarihi ↕ ⧩</th><th>Güncellenme Tarihi ⧩</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10}><Empty text="Veri bulunamadı!" /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row cursor-pointer" onClick={() => openEdit(r)}>
                <td className="text-[#0FB5A0] font-semibold">{r.username} <span className="text-yellow-500">★</span></td>
                <td>{r.isActive ? <span className="text-green-600">✔</span> : <span className="text-red-500">✕</span>}</td>
                <td>{r.name}</td>
                <td>{Number(r.quota) === 0 && r.quotaType === "variable" ? "Kota yok" : r.quotaType === "variable" ? "Değişken Kota" : "Sabit Kota"}</td>
                <td>₺{Number(r.quota).toLocaleString("tr-TR")}</td>
                <td className="text-[12px]">{r.email}</td><td>{r.phone || "-"}</td>
                <td>{r.twoFactor ? "Açık" : "Kapalı"}</td>
                <td className="text-[12px]">{new Date(r.createdAt).toLocaleDateString("tr-TR")}</td>
                <td className="text-[12px]">{new Date(r.updatedAt).toLocaleDateString("tr-TR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp, search)} />
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 modal-backdrop" onClick={() => setDrawer(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white dark:bg-slate-900 shadow-2xl overflow-auto p-8">
            <a className="text-[#0FB5A0] text-sm font-semibold cursor-pointer" onClick={() => setDrawer(false)}>← Kullanıcılar</a>
            <h2 className="text-xl font-extrabold mt-4 mb-6"># {edit ? "Kullanıcı Düzenle" : "Yeni Kullanıcı"}</h2>
            <label className="label">İsim</label><input className="input mb-4" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="İsim" />
            <label className="label">Kullanıcı adı</label><input className="input mb-4" value={form.username} disabled={!!edit} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Kullanıcı adı" />
            <label className="label">Kota tipi</label>
            <select className="input mb-4" value={form.quotaType} onChange={(e) => setForm({ ...form, quotaType: e.target.value })}>
              <option value="variable">Değişken Kota</option><option value="fixed">Sabit Kota</option>
            </select>
            <label className="label">Kota</label><input className="input mb-4" value={form.quota} disabled={!!edit} onChange={(e) => setForm({ ...form, quota: e.target.value })} placeholder="0" />
            <label className="label">E-posta</label><input className="input mb-4" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="E-posta" />
            <label className="label">Telefon</label><input className="input mb-4" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(5__) ___-____" />
            <label className="label">Rol</label>
            <select className="input mb-4" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">Rol seçin</option>{roles.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
            </select>
            <label className="label">Birim Fiyat (₺/segment)</label><input className="input mb-4" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
            <label className="label">Şifre</label>
            <div className="flex">
              <button onClick={genPw} className="btn-green px-3 rounded-r-none">⟳</button>
              <input className="input !rounded-l-none" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Şifre" />
            </div>
            <p className="text-[11px] mt-1 mb-4">Şifre bilgisi en az 8 karakter olmalı, en az 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter barındırmalıdır.</p>
            {edit && (
              <>
                <label className="label">Manuel Kredi Ekle/Çıkar (₺, örn. 500 veya -100)</label>
                <div className="flex gap-2 mb-4">
                  <input className="input" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} placeholder="Tutar" />
                  <input className="input" value={adjust.desc} onChange={(e) => setAdjust({ ...adjust, desc: e.target.value })} placeholder="Açıklama" />
                </div>
              </>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={save} className="btn-primary px-8 py-2.5 text-sm">{edit ? "Kaydet" : "Oluştur"}</button>
              <button onClick={() => setDrawer(false)} className="px-4 py-2.5 text-sm text-slate-500">Vazgeç</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
