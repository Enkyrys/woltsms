"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Admin paneli sesli bildirimleri:
//  1) Bayilerden yeni sipariş → 5 saniyelik güçlü siren   (/api/panel/admin/orders/new)
//  2) Bir kullanıcı sisteme girdiğinde → kapı zili "ding-dong" (/api/panel/admin/activity?since=)
// - Her ikisi de düzenli aralıkla yoklanır; panelin açık olduğu her sayfada çalışır.
// - Ses Web Audio API ile üretilir (dosya gerekmez): iki tonlu siren, sıkıştırıcı ile yüksek seviye.
// - Tarayıcılar sesi ancak kullanıcı sayfayla etkileşime girdikten sonra çalar;
//   ilk tıklama/tuş ile ses motoru açılır. Açılamazsa ekranda "Sesi aç" uyarısı görünür.

const POLL_MS = 8000;
const ALARM_MS = 5000;
const LS_SEEN = "woltsms.admin.lastOrderSeen";
const LS_MUTED = "woltsms.admin.orderAlertMuted";
const STALE_MS = 10 * 60_000; // daha eski başlangıç noktası: eski siparişler için alarm çalınmaz
const LS_LOGIN_SEEN = "woltsms.admin.lastLoginSeen";
export const LS_LOGIN_BELL_OFF = "woltsms.admin.loginBellOff"; // "1" → giriş zili kapalı
export const EVT_TEST_BELL = "woltsms:test-bell";
const LOGIN_TOAST_MS = 20_000;

type NewOrder = { id: string; dealer: string; totalCount: number; totalCost: string; source: string; createdAt: string };
type SignupEvent = { userId: string; username: string; name: string; at: string };
type LoginEvent = { sessionId: string; userId: string; username: string; name: string; reason: "login" | "resume"; at: string };

function lsGet(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string) {
  try { window.localStorage.setItem(k, v); } catch { /* yok say */ }
}

type AudioCtor = typeof AudioContext;
function getAudioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext || w.webkitAudioContext || null;
}

// 5 saniyelik güçlü siren: 960 Hz / 1440 Hz arasında 0,25 sn'de bir geçiş.
function playAlarm(ctx: AudioContext, durationMs = ALARM_MS): () => void {
  const t0 = ctx.currentTime + 0.02;
  const dur = durationMs / 1000;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 0;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(1, t0 + 0.03);
  master.gain.setValueAtTime(1, t0 + dur - 0.08);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  master.connect(comp);
  comp.connect(ctx.destination);

  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  oscA.type = "square";
  oscB.type = "sawtooth";
  const gA = ctx.createGain();
  const gB = ctx.createGain();
  gA.gain.value = 0.6;
  gB.gain.value = 0.35;
  oscA.connect(gA).connect(master);
  oscB.connect(gB).connect(master);

  const step = 0.25;
  for (let t = 0, i = 0; t < dur; t += step, i++) {
    const f = i % 2 === 0 ? 960 : 1440;
    oscA.frequency.setValueAtTime(f, t0 + t);
    oscB.frequency.setValueAtTime(f * 1.005, t0 + t); // hafif detune → daha dolgun ses
  }

  oscA.start(t0);
  oscB.start(t0);
  oscA.stop(t0 + dur + 0.02);
  oscB.stop(t0 + dur + 0.02);

  return () => {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      oscA.stop();
      oscB.stop();
    } catch { /* zaten durdu */ }
  };
}

// Kapı zili: iki vuruşlu "ding-dong" (E5 → C5), çan benzeri kısmi tonlar, ~3 sn (2 kez).
export function playBell(ctx: AudioContext, repeats = 2): () => void {
  const t0 = ctx.currentTime + 0.02;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 8;
  comp.attack.value = 0.002;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);
  comp.connect(ctx.destination);

  const nodes: OscillatorNode[] = [];
  const strike = (freq: number, at: number, len = 1.3) => {
    // çan: temel + uyumsuz kısmi tonlar (gerçek zil tınısı)
    for (const [mult, amp] of [[1, 0.7], [2.0, 0.25], [2.76, 0.18], [5.4, 0.08]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq * mult, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(amp, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len / mult ** 0.3);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + len + 0.05);
      nodes.push(o);
    }
  };
  for (let r = 0; r < repeats; r++) {
    const base = t0 + r * 1.5;
    strike(659.25, base); // ding (E5)
    strike(523.25, base + 0.55); // dong (C5)
  }
  return () => {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      nodes.forEach((n) => { try { n.stop(); } catch { /* */ } });
    } catch { /* zaten durdu */ }
  };
}

export default function AdminOrderAlert() {
  const [muted, setMuted] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [toast, setToast] = useState<NewOrder[]>([]);
  const [logins, setLogins] = useState<LoginEvent[]>([]);
  const [signups, setSignups] = useState<SignupEvent[]>([]);
  const loginSinceRef = useRef<string | null>(null);
  const bellStopRef = useRef<(() => void) | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const sinceRef = useRef<string | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    const m = lsGet(LS_MUTED) === "1";
    setMuted(m);
    mutedRef.current = m;
  }, []);

  const ensureCtx = useCallback(async (): Promise<AudioContext | null> => {
    const Ctor = getAudioCtor();
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    if (ctxRef.current.state === "suspended") {
      try { await ctxRef.current.resume(); } catch { /* kullanıcı etkileşimi gerekli */ }
    }
    return ctxRef.current;
  }, []);

  // ilk kullanıcı etkileşiminde ses motorunu aç
  useEffect(() => {
    const unlock = async () => {
      const ctx = await ensureCtx();
      if (ctx && ctx.state === "running") {
        setNeedsUnlock(false);
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ensureCtx]);

  const ring = useCallback(async () => {
    if (mutedRef.current) return;
    const ctx = await ensureCtx();
    if (!ctx || ctx.state !== "running") {
      setNeedsUnlock(true);
      return;
    }
    stopRef.current?.();
    stopRef.current = playAlarm(ctx, ALARM_MS);
    try { navigator.vibrate?.([400, 150, 400, 150, 400, 150, 400, 150, 400]); } catch { /* yok */ }
  }, [ensureCtx]);

  // giriş zili (sipariş sireninden ayrı açılıp kapatılabilir: Kullanıcı Aktivitesi sayfası)
  const bell = useCallback(async (force = false) => {
    if (!force && (mutedRef.current || lsGet(LS_LOGIN_BELL_OFF) === "1")) return;
    const ctx = await ensureCtx();
    if (!ctx || ctx.state !== "running") {
      setNeedsUnlock(true);
      return;
    }
    bellStopRef.current?.();
    bellStopRef.current = playBell(ctx, 2);
  }, [ensureCtx]);

  // aktivite sayfasındaki "Zili dene" düğmesi
  useEffect(() => {
    const onTest = () => { void bell(true); };
    window.addEventListener(EVT_TEST_BELL, onTest);
    return () => window.removeEventListener(EVT_TEST_BELL, onTest);
  }, [bell]);

  // kullanıcı girişlerini yokla
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stored = lsGet(LS_LOGIN_SEEN);
    const storedMs = stored ? Date.parse(stored) : NaN;
    loginSinceRef.current = Number.isFinite(storedMs) && Date.now() - storedMs < STALE_MS ? stored : null;

    const poll = async () => {
      try {
        const r = await fetch(`/api/panel/admin/activity?since=${encodeURIComponent(loginSinceRef.current ?? "")}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { data?: { latest: string | null; serverTime: string; events: LoginEvent[]; signups?: SignupEvent[] } };
          const d = j.data;
          if (d && !cancelled) {
            const hadBaseline = Boolean(loginSinceRef.current);
            const next = d.latest || d.serverTime;
            if (next) { loginSinceRef.current = next; lsSet(LS_LOGIN_SEEN, next); }
            const newSignups = d.signups ?? [];
            if (hadBaseline && newSignups.length > 0) setSignups((prev) => [...newSignups, ...prev].slice(0, 5));
            if (hadBaseline && d.events.length > 0) setLogins((prev) => [...d.events, ...prev].slice(0, 5));
            if (hadBaseline && (d.events.length > 0 || newSignups.length > 0)) void bell();
          }
        }
      } catch { /* bir sonraki turda tekrar dener */ }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [bell]);

  // giriş bildirimleri kendiliğinden kaybolur
  useEffect(() => {
    if (logins.length === 0) return;
    const t = setTimeout(() => setLogins([]), LOGIN_TOAST_MS);
    return () => clearTimeout(t);
  }, [logins]);

  // yoklama
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stored = lsGet(LS_SEEN);
    const storedMs = stored ? Date.parse(stored) : NaN;
    sinceRef.current = Number.isFinite(storedMs) && Date.now() - storedMs < STALE_MS ? stored : null;

    const poll = async () => {
      try {
        const qs = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : "";
        const r = await fetch(`/api/panel/admin/orders/new${qs}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { data?: { latest: string | null; serverTime: string; orders: NewOrder[] } };
          const d = j.data;
          if (d && !cancelled) {
            const hadBaseline = Boolean(sinceRef.current);
            const next = d.latest || d.serverTime;
            if (next) {
              sinceRef.current = next;
              lsSet(LS_SEEN, next);
            }
            if (hadBaseline && d.orders.length > 0) {
              setToast((prev) => [...d.orders, ...prev].slice(0, 5));
              void ring();
            }
          }
        }
      } catch { /* ağ hatası: bir sonraki turda tekrar dener */ }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ring]);

  const toggleMute = async () => {
    const m = !muted;
    setMuted(m);
    mutedRef.current = m;
    lsSet(LS_MUTED, m ? "1" : "0");
    if (m) {
      stopRef.current?.();
      bellStopRef.current?.();
      return;
    }
    // açarken kısa bir deneme: ses motorunu da kullanıcı etkileşimiyle açar
    const ctx = await ensureCtx();
    if (ctx && ctx.state === "running") {
      setNeedsUnlock(false);
      stopRef.current?.();
      stopRef.current = playAlarm(ctx, 600);
    }
  };

  const dismiss = () => {
    stopRef.current?.();
    setToast([]);
  };

  return (
    <>
      <button
        onClick={toggleMute}
        title={muted ? "Sesli bildirimler kapalı (sipariş + giriş zili)" : "Sesli bildirimler açık: sipariş sireni + giriş zili (tıklayınca test eder)"}
        aria-label={muted ? "Sesli bildirimleri aç" : "Sesli bildirimleri kapat"}
        className="w-9 h-9 grid place-items-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm relative"
      >
        {muted ? "🔇" : "🔊"}
        {!muted && needsUnlock && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500" />}
      </button>

      {(toast.length > 0 || logins.length > 0 || signups.length > 0 || (!muted && needsUnlock)) && (
        <div className="fixed top-4 right-4 z-[100] w-[min(360px,calc(100vw-32px))] space-y-2" role="alert" aria-live="assertive">
          {!muted && needsUnlock && (
            <div className="card p-3 text-[13px] border border-amber-300 bg-amber-50 text-amber-900 flex items-center justify-between gap-3">
              <span>Sesli bildirimler (sipariş sireni, giriş zili) için sesi etkinleştirin.</span>
              <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={async () => { const c = await ensureCtx(); if (c?.state === "running") { setNeedsUnlock(false); if (toast.length) void ring(); else if (logins.length) void bell(); } }}>Sesi aç</button>
            </div>
          )}
          {signups.length > 0 && (
            <div className="card p-0 overflow-hidden border-2 border-amber-400 shadow-2xl">
              <div className="px-4 py-2 bg-amber-500 text-white font-bold text-sm flex items-center justify-between">
                <span>🆕 Yeni üyelik başvurusu ({signups.length})</span>
                <button onClick={() => { bellStopRef.current?.(); setSignups([]); }} className="text-white/90 hover:text-white text-[13px]" aria-label="Kapat">✕</button>
              </div>
              {signups.map((e) => (
                <a key={e.userId} href="/panel/admin/uyelikler" onClick={() => setSignups([])} className="flex items-center gap-2 px-4 py-2 border-b text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="font-semibold truncate">{e.name}</span>
                  <span className="text-slate-500 truncate">@{e.username} · onay bekliyor</span>
                  <span className="ml-auto text-slate-400 text-[11px]">{new Date(e.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                </a>
              ))}
            </div>
          )}
          {logins.length > 0 && (
            <div className="card p-0 overflow-hidden border-2 border-indigo-400 shadow-2xl">
              <div className="px-4 py-2 bg-indigo-500 text-white font-bold text-sm flex items-center justify-between">
                <span>🔔 Kullanıcı girişi ({logins.length})</span>
                <button onClick={() => { bellStopRef.current?.(); setLogins([]); }} className="text-white/90 hover:text-white text-[13px]" aria-label="Kapat">✕</button>
              </div>
              {logins.map((e) => (
                <a key={e.sessionId} href="/panel/admin/kullanici-aktivitesi" className="flex items-center gap-2 px-4 py-2 border-b text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
                  <span className="font-semibold truncate">{e.name || e.username}</span>
                  <span className="text-slate-500 truncate">@{e.username} · {e.reason === "login" ? "giriş yaptı" : "yeniden aktif"}</span>
                  <span className="ml-auto text-slate-400 text-[11px]">{new Date(e.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                </a>
              ))}
            </div>
          )}
          {toast.length > 0 && (
            <div className="card p-0 overflow-hidden border-2 border-[#0FB5A0] shadow-2xl">
              <div className="px-4 py-2.5 bg-[#0FB5A0] text-white font-bold text-sm flex items-center justify-between">
                <span>🔔 Yeni bayi siparişi ({toast.length})</span>
                <button onClick={dismiss} className="text-white/90 hover:text-white text-[13px]" aria-label="Kapat">✕</button>
              </div>
              <div className="max-h-64 overflow-auto">
                {toast.map((o) => (
                  <a key={o.id} href="/panel/siparisler" onClick={dismiss} className="block px-4 py-2.5 border-b text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="font-semibold">{o.dealer || "Bayi"} · {o.totalCount.toLocaleString("tr-TR")} alıcı</div>
                    <div className="text-slate-500 text-[12px]">
                      {new Date(o.createdAt).toLocaleString("tr-TR")} · {o.source === "api" ? "API" : "Panel"}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
