"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card, Field, Pagination, Loading } from "@/components/ui";

type Provider = {
  id: string;
  provider: string;
  baseUrl: string;
  senderId: string;
  isActive: boolean;
  lowBalanceThreshold: string;
  balance: string | null;
  balanceCurrency: string | null;
  lastBalanceAt: string | null;
  lastError: string | null;
  config: Record<string, unknown>;
};

const PROVIDER_META: Record<string, { label: string; hint: string; fields: { key: string; label: string; placeholder?: string; type?: string }[] }> = {
  mock: {
    label: "MockProvider (test)",
    hint: "Dışarıya istek atmaz; sahte gönderim/teslimat üretir. Geliştirme için.",
    fields: [],
  },
  gatum: {
    label: "Gatum SMS (sempico.solutions)",
    hint: "GET /send API'si. DLR callback_url ile gelir; güvenlik anahtarı API_KEY header'ı ile doğrulanır.",
    fields: [
      { key: "token", label: "Token (Dashboard'da oluşturulan)", placeholder: "gbBX8dB7kDvBeo0H-..." },
      { key: "securityKey", label: "Güvenlik Anahtarı (opsiyonel, DLR API_KEY)", placeholder: "Hesapta tanımlıysa" },
    ],
  },
  http: {
    label: "Generic HTTP",
    hint: "Herhangi bir JSON SMS API'si. Uçlar ve şablonlar config üzerinden tanımlanır.",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Bearer token" },
      { key: "secret", label: "Secret (opsiyonel)", placeholder: "HMAC/ek anahtar" },
    ],
  },
};

export default function SistemPage() {
  const [tab, setTab] = useState<"provider" | "announce" | "system" | "audit" | "health">("provider");
  const [loading, setLoading] = useState(true);

  // provider
  const [providers, setProviders] = useState<Provider[]>([]);
  const [active, setActive] = useState("mock");
  const [kind, setKind] = useState<"mock" | "gatum" | "http">("mock");
  const [baseUrl, setBaseUrl] = useState("https://api.sempico.solutions");
  const [senderId, setSenderId] = useState("WOLTSMS");
  const [threshold, setThreshold] = useState("1000");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [sendEndpoint, setSendEndpoint] = useState("/send");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; level: string; message: string; latencyMs?: number } | null>(null);
  const [testPhone, setTestPhone] = useState("");

  // announce
  const [anns, setAnns] = useState<{ id: string; text: string; isActive: boolean }[]>([]);
  const [annText, setAnnText] = useState("");

  // system
  const [sys, setSys] = useState<Record<string, string>>({});
  const [sysSaving, setSysSaving] = useState(false);

  // audit
  const [audit, setAudit] = useState<{ id: string; action: string; username: string; payload: string; createdAt: string }[]>([]);
  const [apage, setApage] = useState(1);
  const [atotal, setAtotal] = useState(0);

  // health
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);

  const loadProviders = () =>
    fetch("/api/panel/admin/settings?scope=provider").then(async (r) => {
      const j = await r.json();
      if (j.success) {
        setProviders(j.data);
        const a = j.data.find((x: Provider) => x.isActive);
        if (a) {
          setActive(a.provider);
          setKind((a.provider as "mock" | "gatum" | "http") || "mock");
          setBaseUrl(a.baseUrl || "");
          setSenderId(a.senderId || "WOLTSMS");
          setThreshold(String(a.lowBalanceThreshold ?? "1000"));
          setSendEndpoint(String(a.config?.send_endpoint ?? "/send"));
        }
      }
    });

  useEffect(() => {
    setLoading(true);
    loadProviders().finally(() => setLoading(false));
    fetch("/api/panel/admin/settings?scope=announce").then(async (r) => { const j = await r.json(); if (j.success) setAnns(j.data); });
    fetch("/api/panel/admin/settings?scope=system").then(async (r) => { const j = await r.json(); if (j.success) setSys(j.data); });
    fetch("/api/panel/admin/settings?scope=audit").then(async (r) => { const j = await r.json(); if (j.success) { setAudit(j.data); setAtotal(j.meta?.total ?? j.data.length); } });
    fetch("/api/panel/admin/settings?scope=health").then(async (r) => { const j = await r.json(); if (j.success) setHealth(j.data); }).catch(() => setHealth(null));
  }, []);

  const meta = PROVIDER_META[kind];

  const saveProvider = async () => {
    const body: Record<string, unknown> = {
      action: "save-provider",
      provider: kind,
      baseUrl,
      senderId,
      isActive: true,
      lowBalanceThreshold: threshold,
      config: { send_endpoint: sendEndpoint },
    };
    // yalnız girilen kimlik bilgileri şifrelenir
    const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => String(v).trim() !== ""));
    if (Object.keys(filled).length) body.credentials = filled;
    const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    alert(j.message);
    if (j.success) loadProviders();
  };

  const activate = async (provider: string) => {
    const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-active-provider", provider }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) loadProviders();
  };

  // Kaydetmeden, yazılan (yoksa kayıtlı) bilgilerle bağlantıyı dener.
  // mode "connection": ücretsiz doğrulama; mode "sms": gerçek (ücretli) tek test SMS'i
  const testProvider = async (mode: "connection" | "sms" = "connection") => {
    if (mode === "sms") {
      if (!testPhone.trim()) { alert("Test SMS'i için telefon numarası girin (ülke koduyla)."); return; }
      if (!confirm(`${testPhone} numarasına GERÇEK bir test SMS'i gönderilecek ve sağlayıcıda ücretlendirilecek. Devam edilsin mi?`)) return;
    }
    setTesting(true); setTestResult(null);
    try {
      const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => String(v).trim() !== ""));
      const r = await fetch("/api/panel/admin/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test-provider", provider: kind, mode, baseUrl, senderId, phone: testPhone, credentials: filled }),
      });
      const j = await r.json();
      setTestResult(j.success ? j.data : { ok: false, level: "error", message: j.message || "Test başarısız." });
    } catch (e) {
      setTestResult({ ok: false, level: "error", message: "Test başarısız: " + (e instanceof Error ? e.message : "hata") });
    } finally { setTesting(false); }
  };

  const saveAnn = async () => {
    if (!annText.trim()) return;
    await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "announcement-upsert", text: annText }) });
    setAnnText("");
    fetch("/api/panel/admin/settings?scope=announce").then(async (r) => { const j = await r.json(); if (j.success) setAnns(j.data); });
  };

  const saveSys = async () => {
    setSysSaving(true);
    for (const [key, value] of Object.entries(sys)) {
      await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "system-upsert", key, value }) });
    }
    setSysSaving(false);
    alert("Gönderim kuralları kaydedildi.");
  };

  if (loading) return <Loading />;

  return (
    <div>
      <PageTitle>Sistem &amp; Sağlayıcı</PageTitle>
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["provider", "announce", "system", "audit", "health"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-5 py-2 rounded-lg text-sm font-bold ${tab === t ? "tab-active" : "bg-white border"}`}>
            {t === "provider" ? "Entegrasyonlar" : t === "announce" ? "Duyuru Bandı" : t === "system" ? "Gönderim Kuralları" : t === "audit" ? "Denetim Logu" : "Sistem Sağlığı"}
          </button>
        ))}
      </div>

      {tab === "provider" && (
        <div className="grid gap-4">
          <Card>
            <h3 className="font-bold mb-2">Aktif Sağlayıcı</h3>
            <div className="flex gap-2 mb-4 flex-wrap">
              {(Object.keys(PROVIDER_META) as (keyof typeof PROVIDER_META)[]).map((k) => (
                <button key={k} onClick={() => setKind(k as "mock" | "gatum" | "http")} className={`px-5 py-2 rounded-lg text-sm font-bold ${kind === k ? "tab-active" : "bg-slate-100"}`}>
                  {PROVIDER_META[k].label}
                </button>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Base URL">
                <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.sempico.solutions" />
              </Field>
              <Field label="Gönderen (senderID)">
                <input className="input" value={senderId} onChange={(e) => setSenderId(e.target.value)} />
              </Field>
              {kind !== "mock" && (
                <Field label="Gönderim Ucu">
                  <input className="input" value={sendEndpoint} onChange={(e) => setSendEndpoint(e.target.value)} placeholder="/send" />
                </Field>
              )}
              <Field label="Düşük Bakiye Eşiği">
                <input className="input" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              </Field>
            </div>

            {meta.fields.length > 0 && (
              <div className="grid md:grid-cols-2 gap-3 mt-1">
                {meta.fields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <input
                      className="input"
                      type={f.type || (f.key.toLowerCase().includes("secret") || f.key === "token" ? "password" : "text")}
                      value={creds[f.key] || ""}
                      onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      autoComplete="off"
                    />
                  </Field>
                ))}
              </div>
            )}

            <p className="text-[12px] text-slate-500 mb-3">{meta.hint} Kimlik bilgileri AES-256-GCM ile şifrelenir; düz metin saklanmaz ve hiçbir yere geri dönmez.</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={saveProvider} className="btn-primary px-6 py-2.5 text-sm">Kaydet</button>
              <button onClick={() => testProvider("connection")} disabled={testing} className="px-6 py-2.5 text-sm font-bold rounded-lg bg-orange-500 text-white disabled:opacity-50">
                {testing ? "Test ediliyor..." : "Bağlantıyı Test Et"}
              </button>
            </div>
            {kind !== "mock" && (
              <div className="flex gap-2 flex-wrap items-center mt-3">
                <input className="input !w-56" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Test numarası: 90555..." />
                <button onClick={() => testProvider("sms")} disabled={testing} className="btn-outline px-4 py-2 text-sm disabled:opacity-50">Test SMS Gönder (ücretli)</button>
              </div>
            )}
            {testResult && (
              <div className={`mt-3 text-[13px] rounded-lg p-3 border ${testResult.level === "success" ? "bg-green-50 border-green-200 text-green-800" : testResult.level === "warning" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                {testResult.level === "success" ? "✓ " : testResult.level === "warning" ? "⚠ " : "✕ "}{testResult.message}
                {testResult.latencyMs ? <span className="opacity-70"> · {testResult.latencyMs} ms</span> : null}
              </div>
            )}

            <div className="mt-4 text-[13px]">
              {providers.map((p) => (
                <div key={p.provider} className="border rounded-lg p-2 mb-1 flex justify-between gap-2 flex-wrap">
                  <span><b>{PROVIDER_META[p.provider]?.label || p.provider}</b> {p.isActive ? "(aktif)" : ""}</span>
                  <span className="flex items-center gap-3">
                    <span>Bakiye: {p.balance ?? "-"} {p.balanceCurrency ?? ""} · Eşik: {p.lowBalanceThreshold}</span>
                    {!p.isActive && (
                      <button onClick={() => activate(p.provider)} className="text-[#0FB5A0] font-bold text-[12px]">Aktif Yap</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "announce" && (
        <Card>
          <Field label="Yeni Duyuru (üst bant)">
            <textarea className="input" rows={2} value={annText} onChange={(e) => setAnnText(e.target.value)} placeholder="Gönderimler 10:00–22:00..." />
          </Field>
          <button onClick={saveAnn} className="btn-primary px-6 py-2.5 text-sm mb-4">Ekle</button>
          {anns.map((a) => (
            <div key={a.id} className="border rounded-lg p-3 mb-2 flex justify-between gap-3 text-[13px]">
              <span>{a.text} {!a.isActive && "(pasif)"}</span>
              <span className="flex gap-2 shrink-0">
                <button
                  onClick={async () => { await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "announcement-upsert", id: a.id, text: a.text, isActive: !a.isActive }) }); location.reload(); }}
                  className="text-[#0FB5A0] text-[12px] font-bold"
                >
                  {a.isActive ? "Pasifleştir" : "Aktifleştir"}
                </button>
                <button
                  onClick={async () => { if (confirm("Silinsin mi?")) { await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "announcement-delete", id: a.id }) }); location.reload(); } }}
                  className="text-red-500 text-[12px]"
                >
                  Sil
                </button>
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
            <Field label="Varsayılan Birim Fiyat"><input className="input" value={sys.default_unit_price || "1"} onChange={(e) => setSys({ ...sys, default_unit_price: e.target.value })} /></Field>
            <Field label="Mesaj Saklama (gün, KVKK)"><input className="input" value={sys.message_retention_days || "180"} onChange={(e) => setSys({ ...sys, message_retention_days: e.target.value })} /></Field>
            <Field label="Sipariş başına azami alıcı"><input className="input" value={sys.max_recipients_per_order || "5000"} onChange={(e) => setSys({ ...sys, max_recipients_per_order: e.target.value })} /></Field>
            <Field label="Worker parti boyutu"><input className="input" value={sys.worker_batch_size || "250"} onChange={(e) => setSys({ ...sys, worker_batch_size: e.target.value })} /></Field>
            <Field label="Azami deneme (sağlayıcı)"><input className="input" value={sys.send_max_attempts || "3"} onChange={(e) => setSys({ ...sys, send_max_attempts: e.target.value })} /></Field>
          </div>
          <button onClick={saveSys} disabled={sysSaving} className="btn-primary px-6 py-2.5 text-sm mt-2 disabled:opacity-50">{sysSaving ? "Kaydediliyor..." : "Kaydet"}</button>
          <p className="text-[12px] text-slate-500 mt-3">
            22:00 sonrası gönderimler iptal edilir ve rezerv iade edilir. Worker pg_cron ile her dakika
            <span className="font-mono"> POST /api/internal/worker</span> ucunu CRON_SECRET ile çağırır.
          </p>
        </Card>
      )}

      {tab === "audit" && (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full table-head text-[13px]">
            <thead><tr className="text-left border-b"><th>Aktör</th><th>İşlem</th><th>Detay</th><th>Tarih</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="table-row">
                  <td>{a.username || "-"}</td>
                  <td className="font-mono text-[12px]">{a.action}</td>
                  <td className="max-w-[300px] truncate text-[12px]">{a.payload}</td>
                  <td className="text-[12px]">{new Date(a.createdAt).toLocaleString("tr-TR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={apage} perPage={15} total={atotal} onChange={(p) => { setApage(p); fetch(`/api/panel/admin/settings?scope=audit&page=${p}`).then(async (r) => { const j = await r.json(); if (j.success) setAudit(j.data); }); }} />
        </div>
      )}

      {tab === "health" && (
        <div className="grid md:grid-cols-4 gap-4">
          {health ? Object.entries(health).map(([k, v]) => (
            <Card key={k}><div className="text-[12px] text-slate-500 uppercase font-bold">{k}</div><div className="text-2xl font-extrabold">{typeof v === "object" ? JSON.stringify(v) : String(v)}</div></Card>
          )) : (
            <Card className="md:col-span-4 text-[13px] text-slate-500">Sağlık verisi yüklenemedi (scope=health ucu tanımlı değil).</Card>
          )}
          <Card className="md:col-span-4 text-[13px]">
            <b>Kuyruk:</b> jobs tablosu + pg_cron → <span className="font-mono">POST /api/internal/worker</span>.
            <b> DLR:</b> <span className="font-mono">/api/v1/webhooks/dlr/{"{provider}"}</span>.
            <b> İçe aktarma:</b> Storage → import_job → worker.
          </Card>
        </div>
      )}
    </div>
  );
}
