"use client";
import { useEffect, useState } from "react";
import { PageTitle, StatusBadge, Modal, Field, CopyBtn } from "@/components/ui";

export default function ApiKeysPage() {
  const [rows, setRows] = useState<{ id: string; name: string; keyPrefix: string; revealable: boolean; status: string; ipWhitelist: string; callbackUrl: string; createdAt: string }[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "Web Sitem", ipWhitelist: "", callbackUrl: "" });
  const [created, setCreated] = useState<{ key: string; secret: string } | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; key: string; secret: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string; ipWhitelist: string; callbackUrl: string } | null>(null);

  const load = () => {
    fetch("/api/panel/apikeys").then(async (r) => { const j = await r.json(); if (j.success) setRows(j.data); });
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const r = await fetch("/api/panel/apikeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    if (!j.success) { alert(j.message); return; }
    // sunucu hem key/secret hem apiKey/apiSecret döner; hangisi varsa onu al
    setCreated({ key: j.data.key ?? j.data.apiKey ?? "", secret: j.data.secret ?? j.data.apiSecret ?? "" });
    setShow(false); load();
  };

  const reveal = async (id: string, name: string) => {
    const r = await fetch(`/api/panel/apikeys/reveal?id=${id}`);
    const j = await r.json();
    if (!j.success) { alert(j.message); return; }
    setRevealed({ name, key: j.data.key ?? "", secret: j.data.secret ?? "" });
  };

  const saveEdit = async () => {
    if (!edit) return;
    await fetch("/api/panel/apikeys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) });
    setEdit(null); load();
  };

  return (
    <div>
      <PageTitle>API Anahtarları</PageTitle>
      <button onClick={() => setShow(true)} className="btn-primary text-[13px] px-4 py-2.5 mb-3">+ Yeni Anahtar Üret</button>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>Ad</th><th>Ön Ek</th><th>Durum</th><th>IP Beyaz Liste</th><th>Callback URL</th><th>Oluşturulma</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="table-row">
                <td className="font-semibold">{r.name}</td><td className="font-mono">{r.keyPrefix}***</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-[12px] max-w-[200px] truncate">{r.ipWhitelist || "-"}</td>
                <td className="text-[12px] max-w-[200px] truncate">{r.callbackUrl || "-"}</td>
                <td className="text-[12px]">{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                <td className="flex gap-2">
                  {r.revealable
                    ? <button onClick={() => reveal(r.id, r.name)} className="text-[#0FB5A0] text-[12px] font-bold">Göster</button>
                    : <span className="text-slate-400 text-[11px]" title="Bu anahtar eski sürümde üretildi; tam değeri saklanmıyor. Yeni anahtar üretin.">Gizli</span>}
                  <button onClick={() => setEdit({ id: r.id, name: r.name, ipWhitelist: r.ipWhitelist || "", callbackUrl: r.callbackUrl || "" })} className="text-[#0FB5A0] text-[12px] font-bold">Düzenle</button>
                  <button onClick={async () => { if (confirm("İptal edilsin mi?")) { await fetch(`/api/panel/apikeys?id=${r.id}`, { method: "DELETE" }); load(); } }} className="text-red-500 text-[12px]">İptal</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-sm text-slate-500">API anahtarı bulunamadı.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card mt-4 text-[13px]">
        <b>Entegrasyon:</b> <span className="font-mono">Authorization: Bearer wsk_live_...</span> header&apos;ı ile istek atın. Anahtarı yalnızca kendi sunucunuzda kullanın. Detay: <a href="/panel/api-docs" className="text-[#0FB5A0] font-bold">API Dokümantasyonu</a>
      </div>

      <div className="text-[10px] text-slate-400 mt-2">Sayfa sürümü: 2026-11-04.v4 · uç nokta: /api/v1/connection</div>
      {show && (
        <Modal title="Yeni API Anahtarı" onClose={() => setShow(false)}>
          <Field label="Ad"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="IP Beyaz Liste (virgülle, boş = tümü)" hint="örn. 1.2.3.4, 5.6.7.8"><input className="input" value={form.ipWhitelist} onChange={(e) => setForm({ ...form, ipWhitelist: e.target.value })} /></Field>
          <Field label="Callback URL (DLR iletimi)"><input className="input" value={form.callbackUrl} onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })} placeholder="https://siteniz.com/sms-callback" /></Field>
          <button onClick={create} className="btn-primary w-full py-2.5 text-sm">Üret</button>
        </Modal>
      )}
      {created && (
        <Modal title="Anahtar Oluşturuldu" onClose={() => setCreated(null)}>
          <div className="space-y-3 text-sm">
            {!created.key && <p className="text-red-600 text-[12px]">Anahtar alınamadı. Sayfayı sert yenileyip (Ctrl+Shift+R) yeniden deneyin.</p>}
            <div><div className="label">API Key</div><div className="font-mono break-all bg-slate-50 p-2 rounded">{created.key || "—"}</div>{created.key && <CopyBtn text={created.key} />}</div>
            <div><div className="label">API Secret (isteğe bağlı X-Signature imzası için)</div><div className="font-mono break-all bg-slate-50 p-2 rounded">{created.secret || "—"}</div>{created.secret && <CopyBtn text={created.secret} />}</div>
            <p className="text-slate-600 text-[12px]">İkisi de şifreli saklanır; listeden <b>Göster</b> ile tekrar görebilirsiniz. Yalnızca kendi sunucunuzda kullanın, tarayıcı kodu veya mobil uygulamaya koymayın.</p>
          </div>
        </Modal>
      )}
      {revealed && (
        <Modal title={`API Anahtarı — ${revealed.name}`} onClose={() => setRevealed(null)}>
          <div className="space-y-3 text-sm">
            <div><div className="label">API Key</div><div className="font-mono break-all bg-slate-50 p-2 rounded">{revealed.key || "—"}</div>{revealed.key && <CopyBtn text={revealed.key} />}</div>
            <div><div className="label">API Secret</div><div className="font-mono break-all bg-slate-50 p-2 rounded">{revealed.secret || "Bu anahtarda secret tanımlı değil."}</div>{revealed.secret && <CopyBtn text={revealed.secret} />}</div>
            <p className="text-red-600 text-[12px]">Bu bilgileri kimseyle paylaşmayın.</p>
          </div>
        </Modal>
      )}
      {edit && (
        <Modal title="Anahtarı Düzenle" onClose={() => setEdit(null)}>
          <Field label="Ad"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="IP Beyaz Liste"><input className="input" value={edit.ipWhitelist} onChange={(e) => setEdit({ ...edit, ipWhitelist: e.target.value })} /></Field>
          <Field label="Callback URL"><input className="input" value={edit.callbackUrl} onChange={(e) => setEdit({ ...edit, callbackUrl: e.target.value })} /></Field>
          <button onClick={saveEdit} className="btn-primary w-full py-2.5 text-sm">Kaydet</button>
        </Modal>
      )}
    </div>
  );
}
