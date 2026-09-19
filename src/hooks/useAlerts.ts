"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SIGNAL_INFO, emptyState, evaluateLevels, evaluateSignals, type AlertEvent, type EngineState, type LevelRule, type SignalKind, type Snapshot } from "@/alerts/engine";
import type { MarketType } from "@/types/market";

const KEY = "cryptolens.alerts.v1";
const MAX_HISTORY = 50;
const MAX_LEVELS = 20;
export type NotifPermission = NotificationPermission | "unsupported";

interface Persisted { enabled: Partial<Record<SignalKind, boolean>>; levels: LevelRule[]; history: AlertEvent[]; sound: boolean }

// Evidence-backed and descriptive alerts start on; the untested funding heuristic starts off.
const DEFAULT_ENABLED: Record<SignalKind, boolean> = { "vol-extreme": true, "range-spike": true, "liq-burst": true, "funding-extreme": false };
const DEFAULTS: Persisted = { enabled: DEFAULT_ENABLED, levels: [], history: [], sound: false };

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      enabled: { ...DEFAULT_ENABLED, ...(p.enabled ?? {}) },
      levels: Array.isArray(p.levels) ? p.levels.slice(0, MAX_LEVELS) : [],
      history: Array.isArray(p.history) ? p.history.slice(0, MAX_HISTORY) : [],
      sound: !!p.sound,
    };
  } catch { return DEFAULTS; }
}
function save(p: Persisted) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode or quota: alerts still work, just not remembered */ } }

export interface AlertsApi {
  enabled: Partial<Record<SignalKind, boolean>>;
  setEnabled: (k: SignalKind, on: boolean) => void;
  levels: LevelRule[];
  addLevel: (r: Omit<LevelRule, "id" | "createdAt">) => boolean;
  removeLevel: (id: string) => void;
  history: AlertEvent[];
  clearHistory: () => void;
  unread: number;
  markRead: () => void;
  permission: NotifPermission;
  requestPermission: () => void;
  sound: boolean;
  setSound: (on: boolean) => void;
  prices: Record<string, number>; // latest known price per "SYMBOL:market", for showing distance to each level
}

/**
 * Alerts for the coin on screen (signal rules) plus price levels for any coin. Everything runs in this page:
 * alerts only fire while it is open. `snap` is null while there is no data, which pauses evaluation.
 */
export function useAlerts(snap: Snapshot | null, viewed: { symbol: string; market: MarketType; price: number | null }): AlertsApi {
  const [p, setP] = useState<Persisted>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [unread, setUnread] = useState(0);
  const [permission, setPermission] = useState<NotifPermission>("default");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const engine = useRef<EngineState>(emptyState());
  const lastPrices = useRef<Record<string, number>>({});
  const polled = useRef<Record<string, number>>({});
  const audio = useRef<AudioContext | null>(null);
  const pRef = useRef(p);

  useEffect(() => { pRef.current = p; }, [p]);

  // Hydrate from localStorage after mount (never during render, so server and client markup agree).
  useEffect(() => {
    const t = setTimeout(() => {
      setP(load());
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (hydrated) save(p); }, [p, hydrated]);

  const deliver = useCallback((events: AlertEvent[]) => {
    if (!events.length) return;
    setP((cur) => ({ ...cur, history: [...events, ...cur.history].slice(0, MAX_HISTORY) }));
    setUnread((n) => n + events.length);
    for (const e of events) {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(e.title, { body: e.detail, tag: e.id });
      } catch { /* some browsers throw when notifying from a non-secure context */ }
    }
    if (pRef.current.sound && audio.current) {
      try {
        const ctx = audio.current, o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; g.gain.value = 0.08;
        o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.18);
      } catch { /* audio blocked: the visual alert still shows */ }
    }
  }, []);

  // Poll prices for level alerts on coins that are not on screen (5s is plenty for a level alert).
  const levelKeys = [...new Set(p.levels.map((l) => `${l.symbol}:${l.market}`))].join(",");
  useEffect(() => {
    if (!levelKeys) return;
    let dead = false;
    const poll = async () => {
      await Promise.all(levelKeys.split(",").map(async (k) => {
        const [symbol, market] = k.split(":");
        try {
          const r = await fetch(`/api/ticker?symbol=${symbol}&market=${market}`);
          if (!r.ok) return;
          const t = await r.json();
          if (!dead && typeof t.price === "number") polled.current[k] = t.price;
        } catch { /* keep the last price; try again next poll */ }
      }));
    };
    poll();
    const i = setInterval(poll, 5000);
    return () => { dead = true; clearInterval(i); };
  }, [levelKeys]);

  // Evaluate on every new snapshot (about once a second).
  const viewedKey = `${viewed.symbol}:${viewed.market}`;
  const viewedPrice = viewed.price;
  const ts = snap?.ts ?? 0;
  useEffect(() => {
    if (!hydrated) return;
    const now = ts || Date.now();
    const events: AlertEvent[] = [];
    if (snap) {
      const r = evaluateSignals(pRef.current.enabled, snap, engine.current);
      engine.current = r.state;
      events.push(...r.events);
    }
    const cur = pRef.current.levels;
    if (cur.length) {
      const priceMap = { ...polled.current, ...(viewedPrice !== null ? { [viewedKey]: viewedPrice } : {}) };
      const lv = evaluateLevels(cur, priceMap, lastPrices.current, now);
      lastPrices.current = lv.lastPrices;
      setPrices((old) => (Object.keys(priceMap).some((k) => old[k] !== priceMap[k]) ? { ...old, ...priceMap } : old));
      if (lv.firedIds.length) setP((c) => ({ ...c, levels: c.levels.filter((l) => !lv.firedIds.includes(l.id)) }));
      events.push(...lv.events);
    }
    deliver(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snap is intentionally tracked through its timestamp
  }, [ts, hydrated, viewedKey, viewedPrice, deliver]);

  // Unread count in the tab title while the page is in the background.
  useEffect(() => {
    const base = "CryptoLens";
    const upd = () => { document.title = unread > 0 && document.hidden ? `(${unread}) ${base}` : base; };
    upd();
    document.addEventListener("visibilitychange", upd);
    return () => document.removeEventListener("visibilitychange", upd);
  }, [unread]);

  return {
    enabled: p.enabled,
    setEnabled: (k, on) => setP((c) => ({ ...c, enabled: { ...c.enabled, [k]: on } })),
    levels: p.levels,
    addLevel: (r) => {
      if (!(r.level > 0) || !isFinite(r.level) || pRef.current.levels.length >= MAX_LEVELS) return false;
      setP((c) => ({ ...c, levels: [...c.levels, { ...r, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() }] }));
      return true;
    },
    removeLevel: (id) => setP((c) => ({ ...c, levels: c.levels.filter((l) => l.id !== id) })),
    history: p.history,
    clearHistory: () => { setP((c) => ({ ...c, history: [] })); setUnread(0); },
    unread,
    markRead: () => setUnread(0),
    permission,
    requestPermission: () => {
      if (typeof Notification === "undefined") return;
      Notification.requestPermission().then((r) => setPermission(r)).catch(() => {});
    },
    sound: p.sound,
    setSound: (on) => {
      if (on && !audio.current) { try { audio.current = new AudioContext(); } catch { /* unsupported */ } } // created inside the click so the browser allows it
      if (on) audio.current?.resume().catch(() => {});
      setP((c) => ({ ...c, sound: on }));
    },
    prices,
  };
}

export { SIGNAL_INFO };
