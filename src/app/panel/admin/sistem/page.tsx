"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card, Field, Pagination, Loading } from "@/components/ui";
import { normalizeHourSetting, displayHourSetting } from "@/lib/sms-segments";
import { PROVIDER_DEFAULT_BASE_URL } from "@/config/provider";

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
  hasCredentials?: boolean;
};

const PROVIDER_META: Record<string, { label: string; hint: string; fields: { key: string; label: string; placeholder?: string; type?: string }[] }> = {
  mock: {
    label: "MockProvider (test)",
    hint: "Dışarıya istek atmaz; sahte gönderim/teslimat üretir. Geliştirme için.",
    fields: [],
  },
  gatum: {
    label: "ENKYRYS SMS (REST API)",
    hint:
      "REST API v1: kullanıcı adı/şifre ile /authorize → /access-token alınır, isteklerde X-Access-Token kullanılır. " +
      "Gönderim POST /send (istek başına en fazla 100 numara), bakiye GET /me (IP başına 15 dk'da 1 istek), " +
      "bağlantı testi ücretsiz POST /replacement ile yapılır.",
    fields: [
      { key: "username", label: "Kullanıcı Adı (hesap girişi)", placeholder: "Gatum/ENKYRYS panel girişi" },
      { key: "password", label: "Şifre", placeholder: "Hesap şifresi", type: "password" },
      { key: "accessToken", label: "Access Token (opsiyonel — şifre yerine)", placeholder: "Şifre yerine doğrudan token", type: "password" },
      { key: "securityKey", label: "Güvenlik Anahtarı (opsiyonel, DLR API_KEY)", placeholder: "Hesapta tanımlıysa", type: "password" },
    ],
  },
  http: {
    label: "Generic HTTP",
    hint: "Herhangi bir JSON SMS API'si. Uçlar ve şablonlar config üzerinden tanımlanır.",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Bearer token" },
      { key: "secret", label: "Secret (opsiyonel)", placeholder: "HMAC/ek anahtar", type: "password" },
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
  const [baseUrl, setBaseUrl] = useState(PROVIDER_DEFAULT_BASE_URL);
  const [senderId, setSenderId] = useState("WOLTSMS");
  const [threshold, setThreshold] = useState("1000");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [sendEndpoint, setSendEndpoint] = useState("/send");
  const [campaign, setCampaign] = useState("WOLTSMS");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; level: string; message: string; latencyMs?: number } | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [manBal, setManBal] = useState("");
  const [manCur, setManCur] = useState("EUR");
  const [balRefreshing, setBalRefreshing] = useState(false);
  const [balMsg, setBalMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
          setCampaign(String(a.config?.campaign ?? "WOLTSMS"));
        }
      }
    });

  useEffect(() => {
    loadProviders().finally(() => setLoading(false));
    fetch("/api/panel/admin/settings?scope=announce").then(async (r) => { const j = await r.json(); if (j.success) setAnns(j.data); });
    fetch("/api/panel/admin/settings?scope=system").then(async (r) => {
      const j = await r.json();
      if (j.success) {
        const d = { ...(j.data as Record<string, string>) };
        // veritabanındaki tam saat → "24:00" / "23:59" gösterimi
        if (d.sending_start_hour !== undefined) d.sending_start_hour = displayHourSetting("start", d.sending_start_hour);
        if (d.sending_end_hour !== undefined) d.sending_end_hour = displayHourSetting("end", d.sending_end_hour);
        setSys(d);
      }
    });
    fetch("/api/panel/admin/settings?scope=audit").then(async (r) => { const j = await r.json(); if (j.success) { setAudit(j.data); setAtotal(j.meta?.total ?? j.data.length); } });
    fetch("/api/panel/admin/settings?scope=health").then(async (r) => { const j = await r.json(); if (j.success) setHealth(j.data); }).catch(() => setHealth(null));
  }, []);

  const meta = PROVIDER_META[kind];

  // Sekme değiştirince o sağlayıcının kayıtlı satırı yüklenir (kaydedilmemiş girişler temizlenir)
  const pickProvider = (k: "mock" | "gatum" | "http") => {
    setKind(k);
    setTestResult(null);
    setBalMsg(null);
    setCreds({});
    const row = providers.find((x) => x.provider === k);
    const fallbackUrl = k === "gatum" ? PROVIDER_DEFAULT_BASE_URL : "";
    setBaseUrl(row?.baseUrl || fallbackUrl);
    setSenderId(row?.senderId || "WOLTSMS");
    setThreshold(String(row?.lowBalanceThreshold ?? "1000"));
    setSendEndpoint(String(row?.config?.send_endpoint ?? "/send"));
    setCampaign(String(row?.config?.campaign ?? "WOLTSMS"));
  };

  const saveProvider = async () => {
    const body: Record<string, unknown> = {
      action: "save-provider",
      provider: kind,
      baseUrl,
      senderId,
      isActive: true,
      lowBalanceThreshold: threshold,
      config: kind === "gatum" ? { send_endpoint: sendEndpoint, campaign } : { send_endpoint: sendEndpoint },
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

  // Sağlayıcıdan bakiye çek (Gatum REST API: GET /me). 15 dakikada 1 istek sınırı
  // sunucuda uygulanır; pencere dolmadan istek gelirse kayıtlı değer döner.
  const refreshBalance = async () => {
    setBalRefreshing(true);
    setBalMsg(null);
    try {
      const r = await fetch("/api/panel/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh-provider-balance", provider: kind }),
      });
      const j = await r.json();
      setBalMsg({ ok: !!j.success, text: j.message || (j.success ? "Bakiye güncellendi." : "Bakiye sorgulanamadı.") });
      if (j.success) loadProviders();
    } catch (e) {
      setBalMsg({ ok: false, text: "Bakiye sorgulanamadı: " + (e instanceof Error ? e.message : "hata") });
    } finally {
      setBalRefreshing(false);
    }
  };

  // API'den dönemeyen durumlar için: sağlayıcı panelindeki bakiyeyi elle kaydet
  const saveManualBalance = async () => {
    const r = await fetch("/api/panel/admin/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-provider-balance", provider: kind, balance: manBal, currency: manCur }),
    });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setManBal(""); loadProviders(); }
  };

  const saveAnn = async () => {
    if (!annText.trim()) return;
    await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "announcement-upsert", text: annText }) });
    setAnnText("");
    fetch("/api/panel/admin/settings?scope=announce").then(async (r) => { const j = await r.json(); if (j.success) setAnns(j.data); });
  };

  const saveSys = async () => {
    for (const [k, kind] of [["sending_start_hour", "start"], ["sending_end_hour", "end"]] as const) {
      if (sys[k] !== undefined && normalizeHourSetting(kind, sys[k]) === null) {
        alert("Saat biçimi geçersiz. Örnek: başlangıç 24:00, bitiş 23:59");
        return;
      }
    }
    setSysSaving(true);
    const errors: string[] = [];
    for (const [key, value] of Object.entries(sys)) {
      const r = await fetch("/api/panel/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "system-upsert", key, value }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); errors.push(`${key}: ${j.message || r.status}`); }
    }
    setSysSaving(false);
    alert(errors.length ? `Bazı ayarlar kaydedilemedi:\n${errors.join("\n")}` : "Gönderim kuralları kaydedildi.");
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
                <button key={k} onClick={() => pickProvider(k as "mock" | "gatum" | "http")} className={`px-5 py-2 rounded-lg text-sm font-bold ${kind === k ? "tab-active" : "bg-slate-100"}`}>
                  {PROVIDER_META[k].label}
                </button>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <Field label={kind === "gatum" ? "Base URL (REST API)" : "Base URL"}>
                <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={PROVIDER_DEFAULT_BASE_URL} />
              </Field>
              <Field label="Gönderen (senderID)">
                <input className="input" value={senderId} onChange={(e) => setSenderId(e.target.value)} />
              </Field>
              {kind !== "mock" && (
                <Field label="Gönderim Ucu">
                  <input className="input" value={sendEndpoint} onChange={(e) => setSendEndpoint(e.target.value)} placeholder="/send" />
                </Field>
              )}
              {kind === "gatum" && (
                <Field label="Kampanya adı (campaign, istatistik grubu)">
                  <input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="WOLTSMS" />
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
                      type={f.type || "text"}
                      value={creds[f.key] || ""}
                      onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                      placeholder={providers.find((x) => x.provider === kind)?.hasCredentials ? "•••••••••••• (şifreli kayıtlı — değiştirmek için yeni değer girin)" : f.placeholder}
                      autoComplete="off"
                    />
                  </Field>
                ))}
              </div>
            )}

            {kind === "gatum" && (
              <div className="text-[12px] bg-slate-50 border rounded-lg p-3 mb-3">
                <div className="font-bold mb-1">İleti durumları (DLR) için ENKYRYS/Gatum paneline girilecek adres</div>
                <div className="font-mono break-all select-all">{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/webhooks/dlr/gatum</div>
                <div className="text-slate-500 mt-1">
                  REST API, teslimat raporlarını bu adrese <b>JSON dizisi</b> olarak POST eder; hesapta onay modu açıksa sistem
                  onaylanan id_state listesini JSON dizisi olarak yanıtlar. Hesapta güvenlik anahtarı tanımlıysa istekler
                  <span className="font-mono"> API_KEY</span> başlığıyla gelir ve aynı anahtarla eşleştirilir. Ek katman için
                  <span className="font-mono"> WEBHOOK_SECRET</span> tanımlıysa adresin sonuna
                  <span className="font-mono"> ?secret=DEĞER</span> ekleyin.
                </div>
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

            {kind === "gatum" && (
              <div className="mt-3 text-[13px]">
                <div className="flex gap-3 flex-wrap items-center">
                  <button onClick={refreshBalance} disabled={balRefreshing} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                    {balRefreshing ? "Sorgulanıyor..." : "Bakiyeyi Sorgula (GET /me)"}
                  </button>
                  <span className="text-slate-500 text-[12px]">
                    Son sorgu:{" "}
                    {providers.find((p) => p.provider === "gatum")?.lastBalanceAt
                      ? new Date(String(providers.find((p) => p.provider === "gatum")?.lastBalanceAt)).toLocaleString("tr-TR")
                      : "-"}
                    {" · "}Sağlayıcı sınırı 15 dakikada 1 istek
                  </span>
                </div>
                {balMsg && (
                  <div className={`mt-2 rounded-lg p-2 border text-[13px] ${balMsg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                    {balMsg.ok ? "✓ " : "⚠ "}
                    {balMsg.text}
                  </div>
                )}
                <div className="text-slate-500 mt-3 mb-1">API&apos;den dönemiyorsa sağlayıcı panelindeki bakiyeyi elle girebilirsiniz:</div>
                <div className="flex gap-2 flex-wrap items-center">
                  <input className="input !w-40" value={manBal} onChange={(e) => setManBal(e.target.value)} placeholder="Bakiye (örn. 25.50)" inputMode="decimal" />
                  <select className="input !w-24" value={manCur} onChange={(e) => setManCur(e.target.value)}><option>EUR</option><option>USD</option><option>TRY</option></select>
                  <button onClick={saveManualBalance} className="btn-outline px-4 py-2 text-sm">Bakiyeyi Kaydet</button>
                </div>
              </div>
            )}

            <div className="mt-4 text-[13px]">
              {providers.map((p) => (
                <div key={p.provider} className="border rounded-lg p-2 mb-1 flex justify-between gap-2 flex-wrap">
                  <span><b>{PROVIDER_META[p.provider]?.label || p.provider}</b> {p.isActive ? "(aktif)" : ""}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span>Bakiye: {p.balance ?? "-"} {p.balanceCurrency ?? ""} · Eşik: {p.lowBalanceThreshold}</span>
                      {p.lastError && <span className="block text-red-600 text-[11px]">{p.lastError}</span>}
                    </span>
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
            <textarea className="input" rows={2} value={annText} onChange={(e) => setAnnText(e.target.value)} placeholder="Gönderimler 24 saat aktiftir..." />
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
            <Field label="Gönderim Başlangıç (SS:DD)"><input className="input" placeholder="24:00" value={sys.sending_start_hour ?? "24:00"} onChange={(e) => setSys({ ...sys, sending_start_hour: e.target.value })} /></Field>
            <Field label="Gönderim Bitiş (SS:DD)"><input className="input" placeholder="23:59" value={sys.sending_end_hour ?? "23:59"} onChange={(e) => setSys({ ...sys, sending_end_hour: e.target.value })} /></Field>
            <Field label="Varsayılan Birim Fiyat"><input className="input" value={sys.default_unit_price || "1"} onChange={(e) => setSys({ ...sys, default_unit_price: e.target.value })} /></Field>
            <Field label="Mesaj Saklama (gün, KVKK)"><input className="input" value={sys.message_retention_days || "180"} onChange={(e) => setSys({ ...sys, message_retention_days: e.target.value })} /></Field>
            <Field label="Sipariş başına azami alıcı"><input className="input" value={sys.max_recipients_per_order || "5000"} onChange={(e) => setSys({ ...sys, max_recipients_per_order: e.target.value })} /></Field>
            <Field label="Worker parti boyutu"><input className="input" value={sys.worker_batch_size || "250"} onChange={(e) => setSys({ ...sys, worker_batch_size: e.target.value })} /></Field>
            <Field label="Azami deneme (sağlayıcı)"><input className="input" value={sys.send_max_attempts || "3"} onChange={(e) => setSys({ ...sys, send_max_attempts: e.target.value })} /></Field>
          </div>
          <button onClick={saveSys} disabled={sysSaving} className="btn-primary px-6 py-2.5 text-sm mt-2 disabled:opacity-50">{sysSaving ? "Kaydediliyor..." : "Kaydet"}</button>
          <p className="text-[12px] text-slate-500 mt-3">
            Varsayılan çalışma saati 24 saattir: başlangıç 24:00, bitiş 23:59 (Türkiye saati). Başlangıç ve bitiş
            aynı (ya da 0/24) ise gönderim gün boyu açıktır; pencere dışında kalan gönderimler iptal edilir ve rezerv iade edilir.
            Kullanıcının kendi saatiyle seçtiği gönderim zamanı sağlayıcıya UTC (ENKYRYS saati) olarak iletilir; ör. UTC+4'te 10:02 → 06:02. Worker pg_cron ile her dakika
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
