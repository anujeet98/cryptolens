"use client";
import { useEffect, useState } from "react";
import { volumeWindows, type VolumeWindow } from "@/analysis/volume";
import type { Candle, MarketType } from "@/types/market";

/** Rolling 5m/15m/1h/4h quote volume from 1m candles, refreshed every 15s. */
export function useVolumeWindows(symbol: string, market: MarketType): VolumeWindow[] {
  const key = `${symbol}:${market}`;
  const [state, setState] = useState<{ key: string; w: VolumeWindow[] }>({ key: "", w: [] });
  useEffect(() => {
    let dead = false;
    const run = async () => {
      try {
        const r = await fetch(`/api/candles?symbol=${symbol}&market=${market}&tf=1m&limit=500`);
        if (!r.ok) return;
        const c: Candle[] = await r.json();
        if (!dead) setState({ key, w: volumeWindows(c) });
      } catch {
        /* keep previous */
      }
    };
    run();
    const i = setInterval(run, 15_000);
    return () => {
      dead = true;
      clearInterval(i);
    };
  }, [symbol, market, key]);
  return state.key === key ? state.w : [];
}
