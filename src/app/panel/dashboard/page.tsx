"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card, Badge } from "@/components/ui";
// Sunucu (rpc_create_order) ile aynı segment kuralları
import { calcSegments, parseRecipients, validateAndNormalizeList } from "@/lib/sms-segments";


export default function DashboardPage() {
  const [lists, setLists] = useState<{ id: string; title: string; count: number }[]>([]);
  const [listId, setListId] = useState("");
  const [numbers, setNumbers] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [history, setHistory] = useState<{ id: string; body: string }[]>([]);
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState("0");
  const [unitPrice, setUnitPrice] = useState("0");
  const [recent, setRecent] = useState<{ id: string; status: string; totalCount: number; processedCount: number; createdAt: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");
  const [showShort, setShowShort] = useState(false);
  const [shortUrl, setShortUrl] = useState("");
  const [shortBiz, setShortBiz] = useState("");
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    fetch("/api/panel/contacts?perPage=100").then(async (r) => { if (r.ok) { const j = await r.json(); setLists(j.data); } });
    fetch("/api/panel/history").then(async (r) => { if (r.ok) { const j = await r.json(); setHistory(j.data); } });
    fetch("/api/panel/transactions?action=balance").then(async (r) => { if (r.ok) { const j = await r.json(); setBalance(j.data.balance); } });
    fetch("/api/panel/balance").then(async (r) => { if (r.ok) { const j = await r.json(); setBalance(j.data.balance); setUnitPrice(j.data.unitPrice); } });
    fetch("/api/panel/orders?perPage=5").then(async (r) => { if (r.ok) { const j = await r.json(); setRecent(j.data); } });
  }, []);

  const c = calcSegments(message);
  const seg = { enc: c.encoding, len: c.length, seg: c.segments, per: c.perSegment };
  // geçerli + tekil numaralar (sunucu da aynı şekilde normalize eder) + seçili rehberdeki kişiler
  const typedCount = validateAndNormalizeList(parseRecipients(numbers)).valid.length;
  const numCount = typedCount + (listId ? (lists.find((l) => String(l.id) === listId)?.count || 0) : 0);
  // Tutar = (segment × birim fiyat, 4 hane yuvarlı) × alıcı sayısı — sunucudaki hesapla aynı
  const unit = Number(unitPrice) || 0;
  const perMsg = Math.round(seg.seg * unit * 10000) / 10000;
  const estCost = (perMsg * numCount).toFixed(2);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { alert("Maksimum dosya boyutu 25 MB."); return; }
    setFileName(f.name);
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const XLSX = await import("xlsx");
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      const phones = rows.map((r) => String(r[0] || "").trim()).filter((v) => v && v.toLowerCase() !== "telefon");
      setNumbers((prev) => (prev ? prev + "\n" : "") + phones.join("\n"));
    } else {
      const text = await f.text();
      // txt/csv: A kolonu = ilk sütun
      const lines = text.split(/\r?\n/).map((l) => l.split(/[;,	]/)[0].trim()).filter(Boolean);
      setNumbers((prev) => (prev ? prev + "\n" : "") + lines.join("\n"));
    }
  };

  // datetime-local değeri ("2026-11-05T10:02") kullanıcının KENDİ saatidir.
  // Tarayıcı bunu kendi saat dilimine göre yorumlar; sunucuya saat dilimli (UTC ISO) gönderilir.
  // Böylece sunucu/sağlayıcı saati farklı olsa da SMS kullanıcının seçtiği anda gider.
  const scheduleIso = (() => {
    if (!scheduledAt) return undefined;
    const d = new Date(scheduledAt);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  })();
  const providerTimeHint = (() => {
    if (!scheduleIso) return "";
    const d = new Date(scheduleIso);
    const f = (tz: string) => d.toLocaleString("tr-TR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return `Seçilen: ${f(Intl.DateTimeFormat().resolvedOptions().timeZone)} (sizin saatiniz) → sağlayıcıya iletilecek: ${f("UTC")} (UTC)`;
  })();

  const submit = async () => {
    if (!message.trim()) { alert("Mesaj yazın."); return; }
    if (scheduledAt && !scheduleIso) { alert("Geçersiz gönderim tarihi."); return; }
    setSending(true); setResult("");
    const r = await fetch("/api/panel/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "order-" + Date.now() },
      body: JSON.stringify({ message, numbers, contactListId: listId || undefined, scheduleAt: scheduleIso }),
    });
    const j = await r.json();
    setSending(false);
    setResult(j.success ? `✓ ${j.message} (Sipariş #${j.data.orderId}, ${j.data.totalCount} numara, ${j.data.segments} segment, ₺${j.data.totalCost})` : `✗ ${j.message}`);
    if (j.success) {
      setMessage(""); setNumbers(""); setListId(""); setScheduledAt("");
      fetch("/api/panel/balance").then(async (r2) => { if (r2.ok) { const jj = await r2.json(); setBalance(jj.data.balance); } });
      fetch("/api/panel/orders?perPage=5").then(async (r2) => { if (r2.ok) { const jj = await r2.json(); setRecent(jj.data); } });
    }
  };

  const createShort = async () => {
    if (!shortUrl) return;
    const r = await fetch("/api/panel/shorturls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalUrl: shortUrl, businessName: shortBiz }) });
    const j = await r.json();
    if (j.success) {
      setMessage((m) => (m ? m + " " : "") + j.data.shortUrl);
      setShowShort(false); setShortUrl(""); setShortBiz("");
    } else alert(j.message);
  };

  const counter = !message ? "0/155" : `${seg.len - (seg.seg - 1) * seg.per}/${seg.per}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <a href="/panel/siparisler" className="text-[#0FB5A0] font-semibold text-[14px]">← Tüm Siparişler</a>
        <button onClick={submit} disabled={sending} className="btn-primary text-[13px] px-5 py-2.5 disabled:opacity-50">📄 {sending ? "Gönderiliyor..." : "Oluştur"}</button>
      </div>
      <PageTitle>Yeni Sipariş</PageTitle>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">KALAN KREDİ</div><div className="text-2xl font-extrabold text-[#0A8F7E]">₺ {Number(balance).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</div>{Number(unitPrice) > 0 && <div className="text-[13px] font-bold text-slate-700 mt-0.5">≈ {Math.max(0, Math.floor(Number(balance) / Number(unitPrice) + 1e-9)).toLocaleString("tr-TR")} SMS</div>}<a href="/panel/kredi-yukle" className="text-[12px] text-[#0FB5A0] font-semibold">+ Kredi Yükle</a></Card>
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">ALICI / SEGMENT</div><div className="text-2xl font-extrabold">{numCount} <span className="text-sm text-slate-400">numara</span> · {seg.seg} <span className="text-sm text-slate-400">segment ({seg.enc})</span></div><div className="text-[12px] text-slate-500">Tahmini tutar: <b>₺{Number(estCost).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</b>{unit > 0 && seg.seg > 0 && <span className="text-slate-400"> ({numCount} × {seg.seg} segment × ₺{unit.toLocaleString("tr-TR", { maximumFractionDigits: 4 })})</span>}</div></Card>
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">SON SİPARİŞLER</div>{recent.length === 0 ? <div className="text-sm text-slate-400 mt-1">Sipariş bulunamadı.</div> : recent.slice(0, 3).map((o) => (<div key={o.id} className="flex justify-between text-[13px] py-1 border-b last:border-0"><span>#{o.id} · {o.totalCount} adet</span><span className="text-slate-500">{o.status}</span></div>))}</Card>
      </div>

      {result && <div className={`mb-4 text-[14px] p-3 rounded-lg ${result.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{result}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <label className="label">Rehber</label>
          <div className="relative mb-5">
            <select value={listId} onChange={(e) => setListId(e.target.value)} className="input pr-16">
              <option value="">Rehber</option>
              {lists.map((l) => (<option key={l.id} value={l.id}>{l.title} ({l.count})</option>))}
            </select>
            {listId && <button onClick={() => setListId("")} className="absolute right-9 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500">✕</button>}
          </div>

          <label className="label">Numaralar</label>
          <textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={5} className="input resize-y" placeholder="Numaralar" />
          <p className="text-[11px] text-slate-500 mt-1 mb-4">Girmiş olduğunuz datalar virgül, noktalı virgül ve yeni satıra göre ayrıştırılır.</p>

          <label className="label">Dosya</label>
          <label className="btn-primary inline-flex items-center gap-2 text-[13px] px-5 py-2.5 cursor-pointer">
            ⬆ Seç
            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={onFile} />
          </label>
          {fileName && <span className="ml-2 text-[12px] text-slate-500">{fileName}</span>}
          <p className="text-[11px] text-slate-600 mt-3">Maksimum dosya boyutu 25 MB. (excel, csv, txt)<br />Excel ve csv dosyalarınızda telefon numaraları &apos;A&apos; kolonunda bulunmak zorundadır.</p>
        </div>

        <div>
          <label className="label">Gönderileceği tarihi (ileri tarihli sipariş · kendi saatiniz)</label>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={`input ${providerTimeHint ? "mb-1" : "mb-5"}`} placeholder="Gönderileceği Tarihi" />
          {providerTimeHint && <p className="text-[11px] text-slate-500 mb-5">{providerTimeHint}</p>}

          <label className="label">Geçmiş mesajlar</label>
          <select onChange={(e) => { if (e.target.value) setMessage(history.find((h) => String(h.id) === e.target.value)?.body || ""); }} className="input mb-5" defaultValue="">
            <option value="">Geçmiş mesajlar</option>
            {history.map((h) => (<option key={h.id} value={h.id}>{h.body.slice(0, 80)}</option>))}
          </select>

          <label className="label">Mesaj</label>
          <div className="relative">
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="input resize-y" placeholder="Mesaj" maxLength={2000} />
          </div>
          <div className="flex items-center justify-between mt-1 mb-3">
            <span className="text-[11px] text-slate-500">Özel karakterler 2 karakter sayılmaktadır.</span>
            <span className="counter-badge">{counter}</span>
          </div>
          <button onClick={() => setShowShort(true)} className="w-full py-3 rounded-lg text-white font-semibold text-[14px] flex items-center justify-center gap-2" style={{ background: "#0FB5A0" }}>
            <span className="mr-auto ml-4">🔗</span> short link <span className="ml-auto mr-4"></span>
          </button>
          <div className="text-[12px] text-slate-500 mt-2">{seg.enc} · {seg.len} karakter · {seg.seg} segment</div>
        </div>
      </div>

      {showShort && (
        <div className="fixed inset-0 z-50 modal-backdrop grid place-items-center p-4" onClick={() => setShowShort(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg p-8 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowShort(false)} className="absolute top-4 right-4 w-8 h-8 grid place-items-center rounded-full bg-slate-100">✕</button>
            <h2 className="text-2xl font-bold mb-5">Generate_Your <span className="text-green-500">ShortURL</span></h2>
            <label className="label">Link</label>
            <input value={shortUrl} onChange={(e) => setShortUrl(e.target.value)} className="input mb-4" placeholder="https://example.com" />
            <label className="label">İşletme Adı</label>
            <p className="text-[12px] text-slate-500 mb-2">This will be used in your branded short link</p>
            <div className="flex mb-5">
              <span className="px-5 grid place-items-center bg-slate-100 rounded-l-lg text-slate-400 text-sm border">Alan Adı/</span>
              <input value={shortBiz} onChange={(e) => setShortBiz(e.target.value)} className="input !rounded-l-none" placeholder="YourBusinessName" />
            </div>
            <button onClick={createShort} className="w-full py-3 rounded-lg bg-blue-400 hover:bg-blue-500 text-white font-semibold">Generate ShortURL</button>
          </div>
        </div>
      )}
    </div>
  );
}
