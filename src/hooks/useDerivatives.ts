"use client";
import { useEffect, useState } from "react";
import type { DerivativesSnapshot, FundingPoint, LongShortPoint, OiPeriod, OiPoint, Timeframe } from "@/types/market";

export interface DerivativesData {
  snapshot: DerivativesSnapshot;
  funding: FundingPoint[];
  oi5m: OiPoint[];
  ls: LongShortPoint[];
}
export interface DerivativesState { data: DerivativesData | null; fetchedAt: number; error?: string }

/** Polls the derivatives bundle every 5s (server caches, so many tabs don't multiply exchange calls). */
export function useDerivatives(perpSymbol: string | null): DerivativesState {
  const [s, setS] = useState<{ key: string; st: DerivativesState }>({ key: "", st: { data: null, fetchedAt: 0 } });
  useEffect(() => {
    if (!perpSymbol) return;
    let dead = false;
    const run = async () => {
      try {
        const r = await fetch(`/api/derivatives?symbol=${perpSymbol}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (!dead) setS({ key: perpSymbol, st: { data: j, fetchedAt: Date.now() } });
      } catch (e) {
        if (!dead) setS((p) => ({ key: perpSymbol, st: { data: p.key === perpSymbol ? p.st.data : null, fetchedAt: p.key === perpSymbol ? p.st.fetchedAt : 0, error: e instanceof Error ? e.message : "failed" } }));
      }
    };
    run();
    const i = setInterval(run, 5_000);
    return () => { dead = true; clearInterval(i); };
  }, [perpSymbol]);
  return s.key === perpSymbol ? s.st : { data: null, fetchedAt: 0 };
}

const PERIOD: Record<Timeframe, OiPeriod> = { "1m": "5m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d" };

/** OI history at (roughly) the chart timeframe, for the OI pane. */
export function useOiSeries(perpSymbol: string | null, tf: Timeframe): OiPoint[] {
  const key = `${perpSymbol}:${tf}`;
  const [s, setS] = useState<{ key: string; pts: OiPoint[] }>({ key: "", pts: [] });
  useEffect(() => {
    if (!perpSymbol) return;
    let dead = false;
    const run = async () => {
      try {
        const r = await fetch(`/api/oi?symbol=${perpSymbol}&period=${PERIOD[tf]}`);
        if (r.ok && !dead) setS({ key, pts: await r.json() });
      } catch { /* keep previous */ }
    };
    run();
    const i = setInterval(run, 30_000);
    return () => { dead = true; clearInterval(i); };
  }, [perpSymbol, tf, key]);
  return s.key === key ? s.pts : [];
}
