"use client";
import { useEffect, useState } from "react";
import { classifyRegime, type Regime } from "@/regime/regime";
import { MTF } from "@/hooks/useMtfRsi";
import type { Candle, MarketType, Timeframe } from "@/types/market";

export type MtfRegimes = Partial<Record<Timeframe, Regime>>;

/** Regime per timeframe, refreshed every 30s from REST. Context (funding/OI) is deliberately not applied here: notes belong to the selected timeframe. */
export function useMtfRegime(symbol: string, market: MarketType): MtfRegimes {
  const key = `${symbol}:${market}`;
  const [state, setState] = useState<{ key: string; v: MtfRegimes }>({ key: "", v: {} });
  useEffect(() => {
    let dead = false;
    const run = async () => {
      const res = await Promise.all(
        MTF.map(async (tf) => {
          try {
            const r = await fetch(`/api/candles?symbol=${symbol}&market=${market}&tf=${tf}&limit=300`);
            if (!r.ok) return [tf, null] as const;
            const c: Candle[] = await r.json();
            return [tf, classifyRegime(c, tf)] as const;
          } catch { return [tf, null] as const; }
        }),
      );
      if (!dead) setState({ key, v: Object.fromEntries(res.filter((x) => x[1] !== null)) as MtfRegimes });
    };
    run();
    const i = setInterval(run, 30_000);
    return () => { dead = true; clearInterval(i); };
  }, [symbol, market, key]);
  return state.key === key ? state.v : {};
}
