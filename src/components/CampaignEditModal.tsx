"use client";
import { useState } from "react";
import { Modal } from "@/components/ui";
import { calcSegments } from "@/lib/sms-segments";

// Zamanlanmış kampanyayı gönderim başlamadan önce düzenleme penceresi.
// Ad, mesaj ve gönderim zamanı değiştirilebilir; mesaj uzarsa ücret farkı bakiyeden rezerve edilir.

const pad2 = (n: number) => String(n).padStart(2, "0");
export const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
export const fmtWhen = (ms: number, tz?: string) =>
  new Date(ms).toLocaleString("tr-TR", { ...(tz ? { timeZone: tz } : {}), day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export type EditableCampaign = { id: string; name: string | null; message: string; scheduledAt: string | null };

export default function CampaignEditModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: EditableCampaign;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(campaign.name || "");
  const [message, setMessage] = useState(campaign.message || "");
  const [when, setWhen] = useState(campaign.scheduledAt ? toLocalInput(Date.parse(campaign.scheduledAt)) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const ms = when ? new Date(when).getTime() : NaN;
  const seg = calcSegments(message);

  const save = async () => {
    setErr("");
    if (!message.trim()) { setErr("Mesaj boş olamaz."); return; }
    if (!Number.isFinite(ms) || ms <= Date.now()) { setErr("Gönderim zamanı şu andan sonra olmalıdır."); return; }
    setSaving(true);
    const r = await fetch("/api/panel/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: campaign.id,
        name,
        message: message !== campaign.message ? message : undefined,
        scheduleAt: new Date(ms).toISOString(),
      }),
    });
    const j = await r.json().catch(() => ({ success: false, message: "Sunucu yanıtı okunamadı." }));
    setSaving(false);
    if (!j.success) { setErr(j.message || "Kaydedilemedi."); return; }
    onSaved(j.message || "Kampanya güncellendi.");
  };

  return (
    <Modal title="Zamanlanmış kampanyayı düzenle" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div>
          <label className="label">Kampanya adı</label>
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Gönderim zamanı (sizin saatiniz)</label>
          <input type="datetime-local" className="input" min={toLocalInput(Date.now() + 60_000)} value={when} onChange={(e) => setWhen(e.target.value)} />
          {Number.isFinite(ms) && (
            <p className="text-[11px] text-slate-500 mt-1">ENKYRYS&apos;e {fmtWhen(ms, "UTC")} UTC&apos;de gönderilir.</p>
          )}
        </div>
        <div>
          <label className="label">Mesaj</label>
          <textarea className="input resize-y" rows={4} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
          <p className="text-[11px] text-slate-500 mt-1">{seg.encoding} · {seg.length} karakter · {seg.segments} segment. Segment sayısı değişirse ücret farkı bakiyenize yansıtılır.</p>
        </div>
        {err && <div className="text-[13px] text-red-700 bg-red-50 rounded-lg p-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-outline px-4 py-2 text-[13px]" onClick={onClose}>Vazgeç</button>
          <button className="btn-primary px-5 py-2 text-[13px] disabled:opacity-50" disabled={saving} onClick={save}>{saving ? "Kaydediliyor..." : "Kaydet"}</button>
        </div>
      </div>
    </Modal>
  );
}
