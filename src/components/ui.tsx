"use client";
import { ReactNode, useState } from "react";

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-[22px] font-extrabold text-slate-900 dark:text-white mb-4"># {children}</h1>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

export function Pagination({ page, perPage, total, onChange }: { page: number; perPage: number; total: number; onChange: (p: number, pp: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500 flex-wrap">
      <button className="px-2 hover:text-[#0FB5A0]" onClick={() => onChange(1, perPage)}>«</button>
      <button className="px-2 hover:text-[#0FB5A0]" onClick={() => onChange(Math.max(1, page - 1), perPage)}>‹</button>
      <span className="w-8 h-8 grid place-items-center rounded-full bg-[#E6FAF7] text-[#0FB5A0] font-bold">{page}</span>
      <button className="px-2 hover:text-[#0FB5A0]" onClick={() => onChange(Math.min(totalPages, page + 1), perPage)}>›</button>
      <button className="px-2 hover:text-[#0FB5A0]" onClick={() => onChange(totalPages, perPage)}>»</button>
      <span className="ml-2">{from} - {to} / {total} kayıt</span>
      <select value={perPage} onChange={(e) => onChange(1, Number(e.target.value))} className="input !w-[76px] !py-1.5 ml-1">
        <option value={10}>10</option>
        <option value={25}>25</option>
        <option value={50}>50</option>
      </select>
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 modal-backdrop grid place-items-center p-4" onClick={onClose}>
      <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[90vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-bold text-slate-800 dark:text-white">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-red-500">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "red" | "yellow" | "teal" | "gray" | "orange"; children: ReactNode }) {
  const map: Record<string, string> = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    yellow: "bg-yellow-100 text-yellow-800",
    teal: "bg-[#E6FAF7] text-[#0A8F7E]",
    gray: "bg-slate-100 text-slate-600",
    orange: "bg-orange-100 text-orange-700",
  };
  return <span className={`badge ${map[tone]}`}>{children}</span>;
}

export function Empty({ text }: { text: string }) {
  return <div className="px-4 py-3 text-[13px] text-slate-500">{text}</div>;
}

export function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}
      className="text-[12px] font-semibold px-2.5 py-1 rounded-md border border-[#0FB5A0] text-[#0FB5A0] hover:bg-[#E6FAF7]"
    >
      {ok ? "Kopyalandı ✓" : "Kopyala"}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { t: "green" | "red" | "yellow" | "teal" | "gray" | "orange"; label: string }> = {
    pending: { t: "yellow", label: "Bekliyor" },
    reported: { t: "teal", label: "Bildirim Yapıldı" },
    approved: { t: "green", label: "Onaylandı" },
    rejected: { t: "red", label: "Reddedildi" },
    expired: { t: "gray", label: "Süresi Doldu" },
    scheduled: { t: "teal", label: "Zamanlı" },
    processing: { t: "yellow", label: "İşleniyor" },
    completed: { t: "green", label: "Tamamlandı" },
    failed: { t: "red", label: "Başarısız" },
    cancelled: { t: "gray", label: "İptal" },
    sent: { t: "teal", label: "Gönderildi" },
    delivered: { t: "green", label: "İletildi" },
    open: { t: "yellow", label: "Açık" },
    answered: { t: "green", label: "Yanıtlandı" },
    closed: { t: "gray", label: "Kapalı" },
    active: { t: "green", label: "Aktif" },
    revoked: { t: "red", label: "İptal" },
  };
  const v = map[status] || { t: "gray" as const, label: status };
  return <Badge tone={v.t}>{v.label}</Badge>;
}
