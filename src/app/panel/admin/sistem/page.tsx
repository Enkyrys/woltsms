"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card, Field, Pagination } from "@/components/ui";

export default function SistemPage() {
  const [tab, setTab] = useState<"provider" | "announce" | "system" | "audit" | "health">("provider");
  const [providers, setProviders] = useState<{ provider: string; isActive: boolean; balance: string; lowBalanceThreshold: string }[]>([]);
  const [active, setActive] = useState("mock");
  const [creds, setCreds] = useState({ baseUrl: "", apiKey: "", secret: "", sender: "WOLTSMS", sendEndpoint: "/sms/send", balanceEndpoint: "/sms/balance" });
  const [threshold, setThreshold] = useState("1000");
  const [anns, setAnns] = useState<{ id: number; text: string; isActive: boolean }[]>([]);
  const [annText, setAnnText] = useState("");
  const [sys, setSys] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<{ id: number; action: string; username: string; payload: string; created_at: string }[]>([]);
  const [apage, setApage] = useState(1);
  const [atotal, setAtotal] = useState(0);
  const [health, setHealth] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    fetch("/api/panel/admin/settings?scope=provider").then(async (r) => { const j = await r.json(); if (j.success) { setProviders(j.data); const a = j.data.find((x: { isActive: boolean }) => x.isActive); if (a) setActive(a.provider); } });
    fetch("/api/panel/admin/settings?scope=announcements").then(async (r) => { const j = await r.json(); if (j.success) setAnns(j.data); });
    fetch("/api/panel/admin/settings?scope=system").then(async (r) => { const j = await r.json(); if (j.success) setSys(j.data); });
    fetch("/api/panel/admin/settings?scope=audit").then(async (r) => { const j = await r.json(); if (j.success) { setAudit(j.data); setAtotal(j.meta.total); } });
    fetch("/api/panel/admin/settings?scope=health").then(async (r) => { const j = await r.json(); if (j.success) setHealth(j.data); });
  }, []);

  const saveProvider = async () => {
    const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "provider", provider: "generic", credentials: creds, lowBalanceThreshold: threshold, activeProvider: active }) });
    alert((await r.json()).message);
  };
  const saveAnn = async () => {
    if (!annText.trim()) return;
    await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "announcement", text: annText }) });
    setAnnText("");
    fetch("/api/panel/admin/settings?scope=announcements").then(async (r) => { const j = await r.json(); if (j.success) setAnns(j.data); });
  };
  const saveSys = async () => {
    const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "system", values: sys }) });
    alert((await r.json()).message);
  };

  return (
    <div>
      <PageTitle>Sistem & Sağlayıcı</PageTitle>
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["provider", "announce", "system", "audit", "health"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-5 py-2 rounded-lg text-sm font-bold ${tab === t ? "tab-active" : "bg-white border"}`}>
            {t === "provider" ? "Sağlayıcı" : t === "announce" ? "Duyuru Bandı" : t === "system" ? "Gönderim Kuralları" : t === "audit" ? "Denetim Logu" : "Sistem Sağlığı"}
          </button>
        ))}
      </div>

      {tab === "provider" && (
        <Card>
          <h3 className="font-bold mb-2">Aktif Sağlayıcı</h3>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setActive("mock")} className={`px-5 py-2 rounded-lg text-sm font-bold ${active === "mock" ? "tab-active" : "bg-slate-100"}`}>MockProvider (test)</button>
            <button onClick={() => setActive("generic")} className={`px-5 py-2 rounded-lg text-sm font-bold ${active === "generic" ? "tab-active" : "bg-slate-100"}`}>Generic HTTP (canlı)</button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Base URL"><input className="input" value={creds.baseUrl} onChange={(e) => setCreds({ ...creds, baseUrl: e.target.value })} placeholder="https://api.saglayici.com" /></Field>
            <Field label="Gönderici (Sender)"><input className="input" value={creds.sender} onChange={(e) => setCreds({ ...creds, sender: e.target.value })} /></Field>
            <Field label="API Key"><input className="input" value={creds.apiKey} onChange={(e) => setCreds({ ...creds, apiKey: e.target.value })} /></Field>
            <Field label="Secret"><input className="input" type="password" value={creds.secret} onChange={(e) => setCreds({ ...creds, secret: e.target.value })} /></Field>
            <Field label="Düşük Bakiye Eşiği"><input className="input" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
          </div>
          <p className="text-[12px] text-slate-500 mb-3">Bilgiler şifreli saklanır (AES-256-GCM). Backend: Next.js · Provider Adapter: Mock + Generic HTTP.</p>
          <button onClick={saveProvider} className="btn-primary px-6 py-2.5 text-sm">Kaydet</button>
          <div className="mt-4 text-[13px]">
            {providers.map((p) => (<div key={p.provider} className="border rounded-lg p-2 mb-1 flex justify-between"><span><b>{p.provider}</b> {p.isActive ? "(aktif)" : ""}</span><span>Bakiye: {p.balance} · Eşik: {p.lowBalanceThreshold}</span></div>))}
          </div>
        </Card>
      )}

      {tab === "announce" && (
        <Card>
          <Field label="Yeni Duyuru (üst bant)"><textarea className="input" rows={2} value={annText} onChange={(e) => setAnnText(e.target.value)} placeholder="Gönderimler 10:00–22:00..." /></Field>
          <button onClick={saveAnn} className="btn-primary px-6 py-2.5 text-sm mb-4">Ekle</button>
          {anns.map((a) => (
            <div key={a.id} className="border rounded-lg p-3 mb-2 flex justify-between gap-3 text-[13px]">
              <span>{a.text} {!a.isActive && "(pasif)"}</span>
              <span className="flex gap-2 shrink-0">
                <button onClick={async () => { await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "announcement", id: a.id, text: a.text, isActive: !a.isActive }) }); location.reload(); }} className="text-[#0FB5A0] text-[12px] font-bold">{a.isActive ? "Pasifleştir" : "Aktifleştir"}</button>
                <button onClick={async () => { if (confirm("Silinsin mi?")) { await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "announcement-delete", id: a.id }) }); location.reload(); } }} className="text-red-500 text-[12px]">Sil</button>
              </span>
            </div>
          ))}
        </Card>
      )}

      {tab === "system" && (
        <Card>
          <div className="grid md:grid-cols-2 gap-3 max-w-2xl">
            <Field label="Gönderim Başlangıç (saat)"><input className="input" value={sys.sending_start_hour || "10"} onChange={(e) => setSys({ ...sys, sending_start_hour: e.target.value })} /></Field>
            <Field label="Gönderim Bitiş (saat)"><input className="input" value={sys.sending_end_hour || "22"} onChange={(e) => setSys({ ...sys, sending_end_hour: e.target.value })} /></Field>
            <Field label="Kural Aktif (1/0)"><input className="input" value={sys.sending_rule_enabled || "1"} onChange={(e) => setSys({ ...sys, sending_rule_enabled: e.target.value })} /></Field>
            <Field label="Varsayılan Birim Fiyat"><input className="input" value={sys.default_unit_price || "1"} onChange={(e) => setSys({ ...sys, default_unit_price: e.target.value })} /></Field>
            <Field label="Mesaj Saklama (gün, KVKK)"><input className="input" value={sys.message_retention_days || "365"} onChange={(e) => setSys({ ...sys, message_retention_days: e.target.value })} /></Field>
          </div>
          <button onClick={saveSys} className="btn-primary px-6 py-2.5 text-sm mt-2">Kaydet</button>
          <p className="text-[12px] text-slate-500 mt-3">22:00 sonrası gönderimler iptal edilir. Zamanlı gönderimler cron ile işlenir: <span className="font-mono">GET /api/cron/process</span></p>
        </Card>
      )}

      {tab === "audit" && (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full table-head text-[13px]">
            <thead><tr className="text-left border-b"><th>ID</th><th>Aktör</th><th>İşlem</th><th>Detay</th><th>Tarih</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="table-row"><td>{a.id}</td><td>{a.username || "-"}</td><td className="font-mono text-[12px]">{a.action}</td><td className="max-w-[300px] truncate text-[12px]">{a.payload}</td><td className="text-[12px]">{new Date(a.created_at).toLocaleString("tr-TR")}</td></tr>
              ))}
            </tbody>
          </table>
          <Pagination page={apage} perPage={15} total={atotal} onChange={(p) => { setApage(p); fetch(`/api/panel/admin/settings?scope=audit&page=${p}`).then(async (r) => { const j = await r.json(); if (j.success) setAudit(j.data); }); }} />
        </div>
      )}

      {tab === "health" && (
        <div className="grid md:grid-cols-4 gap-4">
          {(health ? Object.entries(health) : [["yükleniyor", "..."]]).map(([k, v]) => (
            <Card key={k}><div className="text-[12px] text-slate-500 uppercase font-bold">{k}</div><div className="text-2xl font-extrabold">{String(v)}</div></Card>
          ))}
          <Card className="md:col-span-4 text-[13px]">
            <b>Kuyruk:</b> Senkron işleme + zamanlı sipariş cron&apos;u. <b>DLR:</b> <span className="font-mono">POST /api/v1/webhooks/dlr/{"{provider}"}</span> · <b>Cron:</b> <span className="font-mono">GET /api/cron/process?secret=...</span>
          </Card>
        </div>
      )}
    </div>
  );
}
