"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, StatusBadge, Empty, Modal, Field } from "@/components/ui";

export default function KrediTalepleriPage() {
  const [rows, setRows] = useState<{
    id: number; reference_code: string; method: string; amount_try: string; asset: string; network: string;
    status: string; created_at: string; updated_at: string; username: string; sender_name: string; note: string;
    receipt_path: string; txid: string; sentAmount: string; fromAddress: string; userNote: string; rateApplied: string;
    explorerTemplate: string; wallet_address_snapshot: string; currentWallet: string; credited_amount_try: string;
  }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<(typeof rows)[0] | null>(null);
  const [creditAmt, setCreditAmt] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const load = (p = 1, pp = perPage) => {
    fetch(`/api/panel/admin/topup?page=${p}&perPage=${pp}&method=${method}&status=${status}&q=${encodeURIComponent(q)}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(); }, []);

  const open = (r: (typeof rows)[0]) => { setDetail(r); setCreditAmt(r.amount_try); setAdminNote(""); setRejectReason(""); };

  const approve = async () => {
    if (!detail) return;
    if (!confirm(`${creditAmt} TL onaylansın mı? Tek seferlik işlem.`)) return;
    const r = await fetch("/api/panel/admin/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: detail.id, action: "approve", creditedAmountTry: Number(creditAmt), adminNote }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setDetail(null); load(page, perPage); }
  };
  const reject = async () => {
    if (!detail || !rejectReason) { alert("Gerekçe zorunlu."); return; }
    const r = await fetch("/api/panel/admin/topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: detail.id, action: "reject", reason: rejectReason }) });
    const j = await r.json();
    alert(j.message);
    if (j.success) { setDetail(null); load(page, perPage); }
  };

  const explorerUrl = (r: (typeof rows)[0]) => {
    if (r.explorerTemplate && r.txid) return r.explorerTemplate.replace("{txid}", r.txid).replace("{tx}", r.txid);
    return null;
  };

  return (
    <div>
      <PageTitle>Kredi Talepleri</PageTitle>
      <div className="card mb-3 flex gap-2 flex-wrap items-end">
        <div><label className="label">Yöntem</label><select value={method} onChange={(e) => setMethod(e.target.value)} className="input !w-36"><option value="">Tümü</option><option value="bank">Havale</option><option value="crypto">Kripto</option></select></div>
        <div><label className="label">Durum</label><select value={status} onChange={(e) => setStatus(e.target.value)} className="input !w-40"><option value="">Tümü</option><option value="pending">Bekliyor</option><option value="reported">Bildirim Yapıldı</option><option value="approved">Onaylandı</option><option value="rejected">Reddedildi</option><option value="expired">Süresi Doldu</option></select></div>
        <div><label className="label">Kullanıcı / Referans</label><input value={q} onChange={(e) => setQ(e.target.value)} className="input !w-52" placeholder="Ara" /></div>
        <button onClick={() => load(1, perPage)} className="btn-primary px-5 py-2.5 text-sm">Filtrele</button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>Referans</th><th>Kullanıcı</th><th>Yöntem</th><th>Tutar</th><th>Coin/Ağ</th><th>Durum</th><th>Oluşturulma</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7}><Empty text="Veri bulunamadı!" /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row cursor-pointer" onClick={() => open(r)}>
                <td className="font-mono font-bold">{r.reference_code}</td><td>{r.username}</td>
                <td>{r.method === "bank" ? "Havale" : "Kripto"}</td><td>₺{r.amount_try}</td>
                <td>{r.asset ? `${r.asset}/${r.network}` : "-"}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-[12px]">{new Date(r.created_at).toLocaleString("tr-TR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp)} />
      </div>

      {detail && (
        <Modal title={`${detail.reference_code} — ${detail.username}`} wide onClose={() => setDetail(null)}>
          <div className="grid md:grid-cols-2 gap-4 text-[13px]">
            <div className="space-y-1">
              <div><b>Yöntem:</b> {detail.method} · <b>Tutar:</b> ₺{detail.amount_try} · <b>Durum:</b> <StatusBadge status={detail.status} /></div>
              {detail.method === "bank" && (<><div><b>Gönderen:</b> {detail.sender_name || "-"}</div><div><b>Not:</b> {detail.note || "-"}</div></>)}
              {detail.method === "crypto" && (<>
                <div><b>Coin/Ağ:</b> {detail.asset}/{detail.network} · <b>Kur:</b> {detail.rateApplied}</div>
                <div className="break-all"><b>TXID:</b> <span className="font-mono">{detail.txid || "-"}</span></div>
                <div><b>Miktar:</b> {detail.sentAmount} · <b>Gönderen:</b> <span className="font-mono text-[11px]">{detail.fromAddress || "-"}</span></div>
                <div><b>Not:</b> {detail.userNote || "-"}</div>
                <div className="break-all"><b>Talep adresi (snapshot):</b> <span className="font-mono text-[11px]">{detail.wallet_address_snapshot}</span></div>
                <div className="break-all"><b>Güncel cüzdan:</b> <span className="font-mono text-[11px]">{detail.currentWallet}</span></div>
                {explorerUrl(detail) && <a href={explorerUrl(detail)!} target="_blank" className="btn-outline inline-block px-3 py-1.5 text-[12px]">Explorer&apos;da Aç ↗</a>}
              </>)}
              {detail.receipt_path && detail.receipt_path.startsWith("data:image") && <img src={detail.receipt_path} alt="dekont" className="max-h-64 border rounded-lg mt-2" />}
              {detail.receipt_path && detail.receipt_path.startsWith("data:application/pdf") && <a href={detail.receipt_path} target="_blank" className="text-[#0FB5A0] font-bold">PDF Dekontu Aç ↗</a>}
            </div>
            <div>
              {(detail.status === "pending" || detail.status === "reported") ? (
                <>
                  <Field label="Kredilendirilecek TL Tutarı"><input className="input" type="number" value={creditAmt} onChange={(e) => setCreditAmt(e.target.value)} /></Field>
                  <Field label="Admin Notu"><input className="input" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Eksik/fazla gönderim notu" /></Field>
                  <button onClick={approve} className="btn-green w-full py-2.5 text-sm mb-4">✓ Onayla ve Kredilendir</button>
                  <Field label="Red Gerekçesi (zorunlu)"><input className="input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></Field>
                  <button onClick={reject} className="btn-red w-full py-2.5 text-sm">Reddet</button>
                  <p className="text-[11px] text-slate-400 mt-2">Toplu onay yoktur. Her talep tek tek incelenir.</p>
                </>
              ) : (
                <div className="bg-slate-50 rounded-lg p-3">Bu talep <b>{detail.status}</b> durumunda. Kredilendirilen: ₺{detail.credited_amount_try || "-"}</div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
