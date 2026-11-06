"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Empty } from "@/components/ui";
import UserDeleteModal from "@/components/UserDeleteModal";

export default function KullanicilarPage() {
  const [rows, setRows] = useState<{ id: string; username: string; name: string; email: string; phone: string; quotaType: string; quota: string; unitPrice: string; isActive: boolean; twoFactor: boolean; createdAt: string; updatedAt: string; roleName: string; roleId: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [edit, setEdit] = useState<Record<string, string | number | boolean> | null>(null);
  const emptyForm = { name: "", username: "", quotaType: "variable", quota: "0", email: "", phone: "", password: "", roleId: "", unitPrice: "1", isActive: true };
  const [form, setForm] = useState(emptyForm);
  const [adjust, setAdjust] = useState({ amount: "", desc: "" });
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const pwRules = [
    { ok: form.password.length >= 8, t: "8+ karakter" },
    { ok: /[A-ZÇĞİÖŞÜ]/.test(form.password), t: "büyük harf" },
    { ok: /[a-zçğıöşü]/.test(form.password), t: "küçük harf" },
    { ok: /[0-9]/.test(form.password), t: "rakam" },
    { ok: /[^A-Za-z0-9çÇğĞıIİöÖşŞüÜ]/.test(form.password), t: "özel karakter" },
  ];

  const load = (p = page, pp = perPage, q = search) => {
    fetch(`/api/panel/users?page=${p}&perPage=${pp}&search=${encodeURIComponent(q)}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(1, 10, ""); fetch("/api/panel/roles?perPage=50").then(async (r) => { const j = await r.json(); if (j.success) setRoles(j.data); }); }, []);

  const genPw = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    const rnd = (n: number) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map((x) => chars[x % chars.length]).join(""); };
    // her kural için en az bir karakter, sonra karıştır
    const arr = [..."Aa1!" + rnd(8)];
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    setForm({ ...form, password: arr.join("") });
    setShowPw(true);
  };

  const openNew = () => { setEdit(null); setForm(emptyForm); setAdjust({ amount: "", desc: "" }); setFormErr(""); setShowPw(false); setDrawer(true); };
  const openEdit = (r: (typeof rows)[0]) => {
    setEdit({ id: r.id });
    // otomatik üretilmiş dahili e-posta (kullaniciadi@woltsms.local) formda boş gösterilir
    const email = r.email.endsWith("@woltsms.local") ? "" : r.email;
    setForm({ name: r.name, username: r.username, quotaType: r.quotaType, quota: r.quota, email, phone: r.phone || "", password: "", roleId: String(r.roleId || ""), unitPrice: r.unitPrice || "", isActive: r.isActive });
    setAdjust({ amount: "", desc: "" });
    setFormErr(""); setShowPw(false);
    setDrawer(true);
  };

  const save = async () => {
    setFormErr("");
    if (!form.name.trim()) { setFormErr("İsim boş olamaz."); return; }
    if (!edit && form.username.trim().length < 3) { setFormErr("Kullanıcı adı en az 3 karakter olmalı."); return; }
    if (form.unitPrice.trim() && !(Number(form.unitPrice.replace(",", ".")) > 0)) { setFormErr("Birim fiyat 0'dan büyük bir sayı olmalı."); return; }
    if (form.password && pwRules.some((x) => !x.ok)) { setFormErr("Şifre kurallarını karşılamıyor: " + pwRules.filter((x) => !x.ok).map((x) => x.t).join(", ") + "."); return; }
    if (adjust.amount.trim() && !Number.isFinite(Number(adjust.amount.replace(",", ".")))) { setFormErr("Kredi tutarı sayı olmalı."); return; }

    const method = edit ? "PATCH" : "POST";
    const { quota: _quota, username, ...editable } = form;
    void _quota;
    const body = edit
      ? { id: edit.id, ...editable, unitPrice: form.unitPrice.trim() || undefined, password: form.password || undefined, adjustAmount: adjust.amount.trim() || undefined, adjustDesc: adjust.desc }
      : { ...form, username, unitPrice: form.unitPrice.trim() || undefined };
    setSaving(true);
    const r = await fetch("/api/panel/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ success: false, message: "Sunucu yanıtı okunamadı." }));
    setSaving(false);
    if (!j.success) { setFormErr(j.message || "Kaydedilemedi."); return; }
    setDrawer(false);
    setNotice(j.data?.generatedPassword ? `${j.message} Üretilen şifre: ${j.data.generatedPassword}` : j.message);
    load(page, perPage, search);
  };

  return (
    <div className="relative">
      <PageTitle>Kullanıcılar</PageTitle>
      {notice && <div className="card mb-3 text-sm flex justify-between gap-3"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Kapat">✕</button></div>}
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
            {edit && (
              <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 mb-4 cursor-pointer">
                <span className="text-sm font-semibold">Hesap durumu: {form.isActive ? <span className="text-green-700">Aktif</span> : <span className="text-red-600">Askıya alındı (giriş yapamaz)</span>}</span>
                <input type="checkbox" className="w-5 h-5 accent-[#0FB5A0]" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              </label>
            )}
            <label className="label">İsim</label><input className="input mb-4" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="İsim" />
            <label className="label">Kullanıcı adı</label><input className="input mb-4" value={form.username} disabled={!!edit} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Kullanıcı adı" />
            <label className="label">Kota tipi</label>
            <select className="input mb-4" value={form.quotaType} onChange={(e) => setForm({ ...form, quotaType: e.target.value })}>
              <option value="variable">Değişken Kota</option><option value="fixed">Sabit Kota</option>
            </select>
            <label className="label">Kota</label><input className="input mb-4" value={form.quota} disabled={!!edit} onChange={(e) => setForm({ ...form, quota: e.target.value })} placeholder="0" />
            <label className="label">E-posta (opsiyonel)</label><input className="input mb-4" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="E-posta" />
            <label className="label">Telefon</label><input className="input mb-4" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(5__) ___-____" />
            <label className="label">Rol</label>
            <select className="input mb-4" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">Rol seçin</option>{roles.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
            </select>
            <label className="label">Birim Fiyat (₺/segment)</label><input className="input mb-4" inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder={edit ? "Boş: varsayılan fiyat" : "1"} />
            <label className="label">{edit ? "Yeni şifre (boş bırakılırsa değişmez)" : "Şifre (boş bırakılırsa otomatik üretilir)"}</label>
            <div className="flex">
              <button type="button" onClick={genPw} className="btn-green px-3 rounded-r-none" title="Güçlü şifre üret">⟳</button>
              <input className="input !rounded-none" type={showPw ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={edit ? "Şifreyi sıfırlamak için yazın" : "Şifre"} />
              <button type="button" onClick={() => setShowPw(!showPw)} className="btn-outline px-3 rounded-l-none" aria-label={showPw ? "Şifreyi gizle" : "Şifreyi göster"}>{showPw ? "🙈" : "👁"}</button>
            </div>
            {form.password ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] mt-1 mb-4">{pwRules.map((x) => <span key={x.t} className={x.ok ? "text-green-700" : "text-slate-400"}>{x.ok ? "✓" : "○"} {x.t}</span>)}</div>
            ) : (
              <p className="text-[11px] mt-1 mb-4 text-slate-500">En az 8 karakter; büyük harf, küçük harf, rakam ve özel karakter içermeli.</p>
            )}
            {edit && (
              <>
                <label className="label">Manuel Kredi Ekle/Çıkar (₺, örn. 500 veya -100)</label>
                <div className="flex gap-2 mb-4">
                  <input className="input" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} placeholder="Tutar" />
                  <input className="input" value={adjust.desc} onChange={(e) => setAdjust({ ...adjust, desc: e.target.value })} placeholder="Açıklama" />
                </div>
              </>
            )}
            {formErr && <div className="text-[13px] text-red-700 bg-red-50 rounded-lg p-2.5 mt-2" role="alert">{formErr}</div>}
            <div className="flex gap-3 mt-6">
              <button onClick={save} disabled={saving} className="btn-primary px-8 py-2.5 text-sm disabled:opacity-50">{saving ? "Kaydediliyor…" : edit ? "Kaydet" : "Oluştur"}</button>
              <button onClick={() => setDrawer(false)} className="px-4 py-2.5 text-sm text-slate-500">Vazgeç</button>
            </div>
            {edit && (
              <div className="mt-8 rounded-lg border border-red-200 p-4">
                <div className="font-bold text-sm text-red-700">Tehlikeli bölge</div>
                <p className="text-[12px] text-slate-500 mt-1 mb-3">Üyelik ve kullanıcıya ait tüm veriler kalıcı olarak silinir.</p>
                <button className="btn-red px-4 py-2 text-[13px]" onClick={() => setDeleting(String(edit.id))}>Üyeliği sil</button>
              </div>
            )}
          </div>
        </div>
      )}
      {deleting && (
        <UserDeleteModal
          userId={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(msg) => { setDeleting(null); setDrawer(false); setNotice(msg); load(page, perPage, search); }}
          onSuspend={() => { setDeleting(null); setForm((f) => ({ ...f, isActive: false })); setFormErr("Hesap durumu 'askıya alındı' olarak ayarlandı; kaydetmek için Kaydet'e basın."); }}
        />
      )}
    </div>
  );
}
