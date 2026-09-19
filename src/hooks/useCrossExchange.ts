"use client";
import { useEffect, useState } from "react";
import type { ExchangeRow } from "@/crossexchange/compare";
import type { ExchangeId } from "@/types/market";

export interface CrossExchangeState {
  base: string;
  rows: ExchangeRow[];
  errors: { exchange: ExchangeId; message: string }[];
  loading: boolean;
  error?: string;
  updatedAt: number;
}

const EMPTY = (base: string): CrossExchangeState => ({ base, rows: [], errors: [], loading: true, updatedAt: 0 });

/** Polls the aggregated per-venue perp snapshot every 5s. Keeps the last good data if a poll fails. */
export function useCrossExchange(base: string): CrossExchangeState {
  const [st, setSt] = useState<CrossExchangeState>(() => EMPTY(base));

  useEffect(() => {
    let dead = false;
    const ctl = new AbortController();
    const poll = async () => {
      try {
        const r = await fetch(`/api/xchange?base=${encodeURIComponent(base)}`, { signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "request failed");
        if (!dead) setSt({ base, rows: j.rows, errors: j.errors, loading: false, updatedAt: Date.now() });
      } catch (e) {
        if (dead || (e instanceof DOMException && e.name === "AbortError")) return;
        setSt((p) => ({ ...(p.base === base ? p : EMPTY(base)), loading: false, error: e instanceof Error ? e.message : "failed" }));
      }
    };
    poll();
    const i = setInterval(poll, 5000);
    return () => { dead = true; ctl.abort(); clearInterval(i); };
  }, [base]);

  return st.base === base ? st : EMPTY(base);
}
