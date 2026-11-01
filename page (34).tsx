"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, StatusBadge, CopyBtn, Empty, Modal, Field } from "@/components/ui";

export default function KrediYuklePage() {
  const [tab, setTab] = useState<"bank" | "crypto">("bank");
  const [banks, setBanks] = useState<{ id: string; bankName: string; accountHolder: string; iban: string }[]>([]);
  const [assets, setAssets] = useState<{ id: string; asset: string; network: string; walletAddress: string; memoTag: string; rateTry: string; minAmountTry: string; explorerTxUrlTemplate: string }[]>([]);
  const [settings, setSettings] = useState<{ minTopupTry: string; maxTopupTry: string; bankNote: string }>({ minTopupTry: "100", maxTopupTry: "500000", bankNote: "" });
  const [amount, setAmount] = useState("1000");
  const [assetId, setAssetId] = useState("");
  const [created, setCreated] = useState<{ request: { id: string; referenceCode: string; amountTry: string; walletAddressSnapshot: string }; banks?: typeof banks; asset?: (typeof assets)[0]; estimatedCrypto?: number; bankNote?: string } | null>(null);
  const [rows, setRows] = useState<{ id: string; referenceCode: string; method: string; amountTry: string; asset: string; network: string; status: string; createdAt: string; updatedAt: string; txid: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  // report forms
  const [reportId, setReportId] = useState<string | null>(null);
  const [senderName, setSenderName] = useState("");
  const [note, setNote] = useState("");
  const [txid, setTxid] = useState("");
  const [sentAmount, setSentAmount] = useState("");
  const [fromAddr, setFromAddr] = useState("");
  const [qr, setQr] = useState("");

  const load = (p = 1, pp = perPage) => {
    fetch(`/api/panel/topup?page=${p}&perPage=${pp}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };

  useEffect(() => {
    fetch("/api/panel/topup?action=banks").then(async (r) => { const j = await r.json(); if (j.success) setBanks(j.data); });
    fetch("/api/panel/topup?action=assets").then(async (r) => { const j = await r.json(); if (j.success) { setAssets(j.data); if (j.data[0]) setAssetId(String(j.data[0].id)); } });
    fetch("/api/panel/topup?action=settings").then(async (r) => { const j = await r.json(); if (j.success) setSettings(j.data); });
    load();
  }, []);

  useEffect(() => {
    if (created?.request?.walletAddressSnapshot) {
      import("qrcode").then((QR) => {
        QR.toDataURL(created.request.walletAddressSnapshot, { width: 180 }).then(setQr).catch(() => setQr(""));
      });
    } else setQr("");
  }, [created]);

  // Fiş doğrudan Supabase Storage'a imzalı URL ile yüklenir (Vercel gövde sınırı aşılmaz)
  const uploadReceipt = async (f: File): Promise<string | null> => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    const byExt: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
    const contentType = f.type || byExt[ext] || "application/octet-stream";
    const r = await fetch("/api/panel/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket: "receipts", filename: f.name, contentType }),
    });
    const j = await r.json().catch(() => ({ success: false, message: "Yükleme URL'i alınamadı." }));
    if (!j.success) { alert(j.message); return null; }
    const up = await fetch(j.data.uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${j.data.token}`, "x-upsert": "true" },
      body: f,
    });
    if (!up.ok) { alert("Fiş dosyası yüklenemedi."); return null; }
    return j.data.path as string;
  };

  const createBank = async () => {
    const r = await fetch("/api/panel/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-bank", amountTry: Number(amount) }) });
    const j = await r.json();
    if (!j.success) { alert(j.message); return; }
    setCreated(j.data); load();
  };

  const createCrypto = async () => {
    const r = await fetch("/api/panel/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-crypto", amountTry: Number(amount), cryptoAssetId: assetId }) });
    const j = await r.json();
    if (!j.success) { alert(j.message); return; }
    setCreated(j.data); load();
  };

  const reportBank = async (e: React.FormEvent, receiptFile?: File | null) => {
    e.preventDefault();
    let receiptPath: string | null = null;
    if (receiptFile) {
      receiptPath = await uploadReceipt(receiptFile);
      if (!receiptPath) return;
    }
    const r = await fetch("/api/panel/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "report-bank", topupId: reportId, senderName, note, receiptPath }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setReportId(null); setSenderName(""); setNote(""); load(page, perPage); }
  };

  const reportCrypto = async (e: React.FormEvent, receiptFile?: File | null) => {
    e.preventDefault();
    let receiptPath: string | null = null;
    if (receiptFile) {
      receiptPath = await uploadReceipt(receiptFile);
      if (!receiptPath) return;
    }
    const r = await fetch("/api/panel/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "report-crypto", topupId: reportId, txid, sentAmount: Number(sentAmount), fromAddress: fromAddr, userNote: note, receiptPath }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setReportId(null); setTxid(""); setSentAmount(""); setFromAddr(""); setNote(""); load(page, perPage); }
  };

  const selectedAsset = assets.find((a) => String(a.id) === assetId);
  const estimated = selectedAsset && Number(selectedAsset.rateTry) > 0 ? (Number(amount || 0) / Number(selectedAsset.rateTry)).toFixed(8) : "-";

  return (
    <div>
      <PageTitle>Kredi Yükle</PageTitle>
      <div className="flex gap-2 mb-4">
        <button onClick={() => { setTab("bank"); setCreated(null); }} className={`px-8 py-2.5 rounded-lg font-bold text-sm ${tab === "bank" ? "tab-active" : "bg-white border text-slate-600"}`}>Havale / EFT</button>
        <button onClick={() => { setTab("crypto"); setCreated(null); }} className={`px-8 py-2.5 rounded-lg font-bold text-sm ${tab === "crypto" ? "tab-active" : "bg-white border text-slate-600"}`}>Kripto</button>
      </div>

      {tab === "bank" && !created && (
        <div className="card mb-6 max-w-xl">
          <Field label={`Tutar (₺) — Min ${settings.minTopupTry} / Maks ${settings.maxTopupTry}`}>
            <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={settings.minTopupTry} />
          </Field>
          <button onClick={createBank} className="btn-primary px-8 py-2.5 text-sm">Talep Oluştur</button>
        </div>
      )}

      {tab === "crypto" && !created && (
        <div className="card mb-6 max-w-xl">
          <Field label="Coin / Ağ">
            <select className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              {assets.map((a) => (<option key={a.id} value={a.id}>{a.asset} — {a.network} (1 {a.asset} ≈ ₺{a.rateTry})</option>))}
            </select>
          </Field>
          <Field label={`Yüklenecek TL Tutarı (Min ${selectedAsset?.minAmountTry || settings.minTopupTry} ₺)`}>
            <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="text-[13px] bg-slate-50 rounded-lg p-3 mb-4">Tahmini gönderilecek kripto: <b>{estimated} {selectedAsset?.asset}</b> <span className="text-slate-400">(tahmini)</span></div>
          <button onClick={createCrypto} className="btn-primary px-8 py-2.5 text-sm">Talep Oluştur</button>
        </div>
      )}

      {created && tab === "bank" && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">Talep: {created.request.referenceCode} — ₺{created.request.amountTry}</h3>
            <button onClick={() => setCreated(null)} className="text-sm text-slate-500">✕ Kapat</button>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-[13px] mb-4">⚠️ Açıklamaya referans kodunuzu <b>{created.request.referenceCode}</b> yazmanız zorunludur.</div>
          {created.banks?.map((b) => (
            <div key={b.id} className="border rounded-lg p-3 mb-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[14px]"><b>{b.bankName}</b> · {b.accountHolder}<br /><span className="font-mono">{b.iban}</span></div>
              <CopyBtn text={b.iban} />
            </div>
          ))}
          {created.bankNote && <p className="text-[12px] text-slate-500 mb-3">{created.bankNote}</p>}
          <button onClick={() => setReportId(created.request.id)} className="btn-primary px-6 py-2.5 text-sm">Ödemeyi Yaptım, Bildir →</button>
        </div>
      )}

      {created && tab === "crypto" && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">Talep: {created.request.referenceCode} — ₺{created.request.amountTry}</h3>
            <button onClick={() => setCreated(null)} className="text-sm text-slate-500">✕ Kapat</button>
          </div>
          <div className="grid md:grid-cols-[200px_1fr] gap-4">
            <div>{qr ? <img src={qr} alt="QR" className="border rounded-lg" /> : <div className="w-[180px] h-[180px] grid place-items-center bg-slate-100 rounded-lg text-sm">QR yükleniyor...</div>}</div>
            <div className="text-[14px] space-y-2">
              <div><b>Coin/Ağ:</b> {created.asset?.asset} / {created.asset?.network}</div>
              <div className="flex items-center gap-2 flex-wrap"><b>Cüzdan:</b> <span className="font-mono text-[12px] break-all">{created.request.walletAddressSnapshot}</span> <CopyBtn text={created.request.walletAddressSnapshot} /></div>
              {created.asset?.memoTag && <div><b>Memo/Tag:</b> {created.asset.memoTag}</div>}
              <div><b>Tahmini gönderilecek:</b> {created.estimatedCrypto} {created.asset?.asset} <span className="text-slate-400">(tahmini)</span></div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px]">⚠️ Yalnızca seçtiğiniz ağı kullanın; yanlış ağa gönderilen ödemeler kaybolabilir.<br />Gönderim sonrası <b>Ödeme Bildirimi</b> yapın.</div>
              <button onClick={() => setReportId(created.request.id)} className="btn-primary px-6 py-2.5 text-sm">Ödeme Bildirimi Yap →</button>
            </div>
          </div>
        </div>
      )}

      <h3 className="font-bold text-[16px] mb-2 mt-6">Yükleme Talepleri</h3>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>Talep No</th><th>Yöntem</th><th>Tutar</th><th>Coin/Ağ</th><th>Durum</th><th>Oluşturulma</th><th>Güncellenme</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8}><Empty text="Veri bulunamadı!" /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row">
                <td className="font-mono font-bold">{r.referenceCode}</td>
                <td>{r.method === "bank" ? "Havale/EFT" : "Kripto"}</td>
                <td>₺{r.amountTry}</td>
                <td>{r.asset ? `${r.asset}/${r.network}` : "-"}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-[12px]">{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                <td className="text-[12px]">{new Date(r.updatedAt).toLocaleString("tr-TR")}</td>
                <td>{r.status === "pending" && <button onClick={() => setReportId(r.id)} className="text-[#0FB5A0] text-[12px] font-bold">Bildir →</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp)} />
      </div>

      {reportId && (
        <ReportModal
          requestId={reportId}
          rows={rows}
          onClose={() => setReportId(null)}
          senderName={senderName} setSenderName={setSenderName}
          note={note} setNote={setNote}
          txid={txid} setTxid={setTxid}
          sentAmount={sentAmount} setSentAmount={setSentAmount}
          fromAddr={fromAddr} setFromAddr={setFromAddr}
          onBank={reportBank} onCrypto={reportCrypto}
        />
      )}
    </div>
  );
}

function ReportModal(props: {
  requestId: string; rows: { id: string; method: string }[]; onClose: () => void;
  senderName: string; setSenderName: (v: string) => void; note: string; setNote: (v: string) => void;
  txid: string; setTxid: (v: string) => void; sentAmount: string; setSentAmount: (v: string) => void;
  fromAddr: string; setFromAddr: (v: string) => void;
  onBank: (e: React.FormEvent, f?: File | null) => void; onCrypto: (e: React.FormEvent, f?: File | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const isBank = props.rows.find((r) => r.id === props.requestId)?.method === "bank";
  return (
    <Modal title={isBank ? "Havale Bildirimi" : "Ödeme Bildirimi (Kripto)"} onClose={props.onClose}>
      {isBank ? (
        <form onSubmit={(e) => props.onBank(e, file)}>
          <Field label="Gönderen Adı"><input className="input" value={props.senderName} onChange={(e) => props.setSenderName(e.target.value)} placeholder="Ad Soyad" /></Field>
          <Field label="Dekont (jpg/png/pdf, maks 5MB)"><input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
          <Field label="Not / Gönderim Saati"><input className="input" value={props.note} onChange={(e) => props.setNote(e.target.value)} placeholder="örn. 14:30 Ziraat" /></Field>
          <button className="btn-primary w-full py-2.5 text-sm">Bildirimi Gönder</button>
        </form>
      ) : (
        <form onSubmit={(e) => props.onCrypto(e, file)}>
          <Field label="TXID (zorunlu)"><input className="input font-mono" value={props.txid} onChange={(e) => props.setTxid(e.target.value)} placeholder="0x..." /></Field>
          <Field label="Gönderilen Kripto Miktarı (zorunlu)"><input className="input" type="number" step="any" value={props.sentAmount} onChange={(e) => props.setSentAmount(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Gönderen Cüzdan (opsiyonel)"><input className="input font-mono" value={props.fromAddr} onChange={(e) => props.setFromAddr(e.target.value)} /></Field>
          <Field label="Ekran Görüntüsü (opsiyonel, 5MB)"><input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
          <Field label="Not"><input className="input" value={props.note} onChange={(e) => props.setNote(e.target.value)} /></Field>
          <button className="btn-primary w-full py-2.5 text-sm">Ödeme Bildirimi Gönder</button>
        </form>
      )}
    </Modal>
  );
}
