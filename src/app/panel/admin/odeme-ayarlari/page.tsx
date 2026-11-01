"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card, Modal, Field } from "@/components/ui";

export default function OdemeAyarlariPage() {
  const [settings, setSettings] = useState({ minTopupTry: "100", maxTopupTry: "500000", requestTtlMinutes: 1440, bankNote: "", maxOpenRequests: 3 });
  const [banks, setBanks] = useState<{ id: string; bankName: string; accountHolder: string; iban: string; isActive: boolean; sortOrder: number }[]>([]);
  const [crypto, setCrypto] = useState<{ id: string; asset: string; network: string; walletAddress: string; memoTag: string; explorerTxUrlTemplate: string; rateTry: string; minAmountTry: string; isActive: boolean; sortOrder: number; rateUpdatedAt: string }[]>([]);
  const [bankForm, setBankForm] = useState<{ id?: string; bankName: string; accountHolder: string; iban: string; isActive: boolean; sortOrder: number } | null>(null);
  const [cryptoForm, setCryptoForm] = useState<{ id?: string; asset: string; network: string; walletAddress: string; memoTag: string; explorerTxUrlTemplate: string; rateTry: string; minAmountTry: string; isActive: boolean; sortOrder: number } | null>(null);

  const load = () => {
    fetch("/api/panel/admin/settings?scope=payment").then(async (r) => {
      const j = await r.json();
      if (j.success) {
        if (j.data.settings) setSettings({ minTopupTry: j.data.settings.minTopupTry, maxTopupTry: j.data.settings.maxTopupTry, requestTtlMinutes: j.data.settings.requestTtlMinutes, bankNote: j.data.settings.bankNote || "", maxOpenRequests: j.data.settings.maxOpenRequests });
        setBanks(j.data.banks); setCrypto(j.data.assets ?? []);
      }
    });
  };
  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-payment", ...settings }) });
    alert((await r.json()).message);
  };
  const saveBank = async () => {
    if (!bankForm) return;
    const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bank-upsert", ...bankForm }) });
    alert((await r.json()).message); setBankForm(null); load();
  };
  const saveCrypto = async () => {
    if (!cryptoForm) return;
    const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "crypto-upsert", ...cryptoForm }) });
    alert((await r.json()).message); setCryptoForm(null); load();
  };

  return (
    <div>
      <PageTitle>Ödeme Ayarları</PageTitle>
      <Card className="mb-4">
        <h3 className="font-bold mb-3">Genel Limitler</h3>
        <div className="grid md:grid-cols-5 gap-3">
          <div><label className="label">Min Tutar (₺)</label><input className="input" value={settings.minTopupTry} onChange={(e) => setSettings({ ...settings, minTopupTry: e.target.value })} /></div>
          <div><label className="label">Maks Tutar (₺)</label><input className="input" value={settings.maxTopupTry} onChange={(e) => setSettings({ ...settings, maxTopupTry: e.target.value })} /></div>
          <div><label className="label">Talep Süresi (dk)</label><input className="input" type="number" value={settings.requestTtlMinutes} onChange={(e) => setSettings({ ...settings, requestTtlMinutes: Number(e.target.value) })} /></div>
          <div><label className="label">Maks Açık Talep</label><input className="input" type="number" value={settings.maxOpenRequests} onChange={(e) => setSettings({ ...settings, maxOpenRequests: Number(e.target.value) })} /></div>
          <div className="flex items-end"><button onClick={saveSettings} className="btn-primary px-6 py-2.5 text-sm">Kaydet</button></div>
        </div>
        <div className="mt-3"><label className="label">Banka Notu</label><textarea className="input" rows={2} value={settings.bankNote} onChange={(e) => setSettings({ ...settings, bankNote: e.target.value })} /></div>
      </Card>

      <div className="flex justify-between items-center mb-2 mt-6">
        <h3 className="font-bold">Banka Hesapları</h3>
        <button onClick={() => setBankForm({ bankName: "", accountHolder: "", iban: "", isActive: true, sortOrder: 0 })} className="btn-primary text-[13px] px-4 py-2">+ Ekle</button>
      </div>
      <div className="card !p-0 overflow-hidden mb-6">
        <table className="w-full table-head text-[13px]">
          <thead><tr className="text-left border-b"><th>Banka</th><th>Hesap Sahibi</th><th>IBAN</th><th>Aktif</th><th>Sıra</th><th></th></tr></thead>
          <tbody>
            {banks.map((b) => (
              <tr key={b.id} className="table-row">
                <td className="font-semibold">{b.bankName}</td><td>{b.accountHolder}</td><td className="font-mono text-[12px]">{b.iban}</td>
                <td>{b.isActive ? "✓" : "✕"}</td><td>{b.sortOrder}</td>
                <td className="flex gap-2"><button onClick={() => setBankForm(b)} className="text-[#0FB5A0] text-[12px] font-bold">Düzenle</button><button onClick={async () => { if (confirm("Silinsin mi?")) { await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bank-delete", id: b.id }) }); load(); } }} className="text-red-500 text-[12px]">Sil</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold">Kripto Varlıklar (manuel — gateway yok)</h3>
        <button onClick={() => setCryptoForm({ asset: "USDT", network: "TRC20", walletAddress: "", memoTag: "", explorerTxUrlTemplate: "https://tronscan.org/#/transaction/{txid}", rateTry: "34.5", minAmountTry: "100", isActive: true, sortOrder: 0 })} className="btn-primary text-[13px] px-4 py-2">+ Coin/Ağ Ekle</button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head text-[13px]">
          <thead><tr className="text-left border-b"><th>Coin</th><th>Ağ</th><th>Cüzdan</th><th>Kur (₺)</th><th>Min (₺)</th><th>Aktif</th><th>Güncelleme</th><th></th></tr></thead>
          <tbody>
            {crypto.map((c) => (
              <tr key={c.id} className="table-row">
                <td className="font-bold">{c.asset}</td><td>{c.network}</td><td className="font-mono text-[11px] max-w-[220px] truncate">{c.walletAddress}</td>
                <td>{c.rateTry}</td><td>{c.minAmountTry}</td><td>{c.isActive ? "✓" : "✕"}</td>
                <td className="text-[11px]">{c.rateUpdatedAt ? new Date(c.rateUpdatedAt).toLocaleString("tr-TR") : "-"}</td>
                <td className="flex gap-2"><button onClick={() => setCryptoForm(c)} className="text-[#0FB5A0] text-[12px] font-bold">Düzenle</button><button onClick={async () => { if (confirm("Silinsin mi?")) { await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "crypto-delete", id: c.id }) }); load(); } }} className="text-red-500 text-[12px]">Sil</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-slate-500 mt-2">Private key panelde asla saklanmaz. Kur elle güncellenir. Adres değişikliği eski talepleri bozmaz (snapshot).</p>

      {bankForm && (
        <Modal title="Banka Hesabı" onClose={() => setBankForm(null)}>
          <Field label="Banka Adı"><input className="input" value={bankForm.bankName} onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })} /></Field>
          <Field label="Hesap Sahibi"><input className="input" value={bankForm.accountHolder} onChange={(e) => setBankForm({ ...bankForm, accountHolder: e.target.value })} /></Field>
          <Field label="IBAN"><input className="input font-mono" value={bankForm.iban} onChange={(e) => setBankForm({ ...bankForm, iban: e.target.value })} /></Field>
          <div className="flex gap-3 items-center mb-3">
            <label className="text-sm flex gap-2"><input type="checkbox" checked={bankForm.isActive} onChange={(e) => setBankForm({ ...bankForm, isActive: e.target.checked })} /> Aktif</label>
            <input className="input !w-24" type="number" value={bankForm.sortOrder} onChange={(e) => setBankForm({ ...bankForm, sortOrder: Number(e.target.value) })} placeholder="Sıra" />
          </div>
          <button onClick={saveBank} className="btn-primary w-full py-2.5 text-sm">Kaydet</button>
        </Modal>
      )}
      {cryptoForm && (
        <Modal title="Coin / Ağ" wide onClose={() => setCryptoForm(null)}>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Coin (USDT, BTC...)"><input className="input" value={cryptoForm.asset} onChange={(e) => setCryptoForm({ ...cryptoForm, asset: e.target.value })} /></Field>
            <Field label="Ağ (TRC20, BEP20...)"><input className="input" value={cryptoForm.network} onChange={(e) => setCryptoForm({ ...cryptoForm, network: e.target.value })} /></Field>
          </div>
          <Field label="Cüzdan Adresi"><input className="input font-mono" value={cryptoForm.walletAddress} onChange={(e) => setCryptoForm({ ...cryptoForm, walletAddress: e.target.value })} /></Field>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Memo/Tag (opsiyonel)"><input className="input" value={cryptoForm.memoTag} onChange={(e) => setCryptoForm({ ...cryptoForm, memoTag: e.target.value })} /></Field>
            <Field label="Explorer Şablonu"><input className="input font-mono text-[12px]" value={cryptoForm.explorerTxUrlTemplate} onChange={(e) => setCryptoForm({ ...cryptoForm, explorerTxUrlTemplate: e.target.value })} placeholder="https://.../{txid}" /></Field>
            <Field label="Referans TL Kuru"><input className="input" value={cryptoForm.rateTry} onChange={(e) => setCryptoForm({ ...cryptoForm, rateTry: e.target.value })} /></Field>
            <Field label="Min Tutar (₺)"><input className="input" value={cryptoForm.minAmountTry} onChange={(e) => setCryptoForm({ ...cryptoForm, minAmountTry: e.target.value })} /></Field>
          </div>
          <label className="text-sm flex gap-2 mb-3"><input type="checkbox" checked={cryptoForm.isActive} onChange={(e) => setCryptoForm({ ...cryptoForm, isActive: e.target.checked })} /> Aktif</label>
          <button onClick={saveCrypto} className="btn-primary w-full py-2.5 text-sm">Kaydet</button>
        </Modal>
      )}
    </div>
  );
}
