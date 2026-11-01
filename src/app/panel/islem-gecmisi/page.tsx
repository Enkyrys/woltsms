"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Empty } from "@/components/ui";

const TYPE_TR: Record<string, string> = { topup: "Kredi Yükleme", debit: "SMS Gönderimi", refund: "İade", adjust: "Manuel Düzeltme" };

export default function IslemGecmisiPage() {
  const [rows, setRows] = useState<{ id: string; txType: string; credit: string; totalPrice: string; currency: string; unitPrice: string; balanceAfter: string; description: string; createdAt: string }[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const load = (p = page, pp = perPage, t = type) => {
    fetch(`/api/panel/transactions?page=${p}&perPage=${pp}&type=${t}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  useEffect(() => { load(1, 10, ""); }, []);

  const queryBalance = async () => {
    const r = await fetch("/api/panel/transactions?action=balance");
    const j = await r.json();
    if (j.success) setBalance(j.data.balance);
  };

  return (
    <div>
      <PageTitle>İşlem Geçmişi</PageTitle>
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <button onClick={queryBalance} className="btn-orange text-[13px] px-4 py-2.5">🔍 Bakiye sorgulama</button>
          {balance !== null && <span className="font-bold text-[#0A8F7E]">₺ {Number(balance).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>}
        </div>
        <button onClick={() => setShowFilter(!showFilter)} className="btn-outline w-10 h-10 grid place-items-center">⧩</button>
      </div>
      {showFilter && (
        <div className="card mb-3 flex gap-3 items-center">
          <span className="text-sm">İşlem Tipi:</span>
          <select value={type} onChange={(e) => { setType(e.target.value); load(1, perPage, e.target.value); }} className="input !w-48">
            <option value="">Tümü</option>
            <option value="topup">Kredi Yükleme</option><option value="debit">SMS Gönderimi</option>
            <option value="refund">İade</option><option value="adjust">Manuel Düzeltme</option>
          </select>
        </div>
      )}
      <div className="card !p-0 overflow-hidden">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b">
            <th>İşlem Tipi ⧩</th><th>Kredi</th><th>Toplam Fiyat</th><th>Para Birimi</th><th>Birim Fiyat</th><th className="sorted-col">İşlem Tarihi ⤓ ⧩</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6}><Empty text="Bildirim bulunamadı." /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="table-row" title={r.description}>
                <td className="font-semibold">{TYPE_TR[r.txType] || r.txType}<div className="text-[11px] font-normal text-slate-400 max-w-[280px] truncate">{r.description}</div></td>
                <td className={Number(r.credit) < 0 ? "text-red-600" : "text-green-700"}>{r.credit}</td>
                <td>₺{r.totalPrice}</td><td>{r.currency}</td><td>{r.unitPrice}</td>
                <td className="text-[12px]">{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp, type)} />
      </div>
    </div>
  );
}
