"use client";
import { useEffect, useState } from "react";
import { rsi } from "@/indicators";
import type { Candle, MarketType, Timeframe } from "@/types/market";

export const MTF: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

/** RSI(14) across timeframes, refreshed every 30s from REST (higher timeframes barely move intra-minute). */
export function useMtfRsi(symbol: string, market: MarketType): Partial<Record<Timeframe, number>> {
  const key = `${symbol}:${market}`;
  const [state, setState] = useState<{ key: string; v: Partial<Record<Timeframe, number>> }>({ key: "", v: {} });
  useEffect(() => {
    let dead = false;
    const run = async () => {
      const res = await Promise.all(
        MTF.map(async (tf) => {
          try {
            const r = await fetch(`/api/candles?symbol=${symbol}&market=${market}&tf=${tf}&limit=150`);
            if (!r.ok) return [tf, null] as const;
            const c: Candle[] = await r.json();
            const v = rsi(
              c.map((x) => x.close),
              14,
            ).at(-1);
            return [tf, v ?? null] as const;
          } catch {
            return [tf, null] as const;
          }
        }),
      );
      if (!dead) setState({ key, v: Object.fromEntries(res.filter((x) => x[1] !== null)) });
    };
    run();
    const i = setInterval(run, 30_000);
    return () => {
      dead = true;
      clearInterval(i);
    };
  }, [symbol, market, key]);
  return state.key === key ? state.v : {};
}
