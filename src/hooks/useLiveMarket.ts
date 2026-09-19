"use client";
import { useEffect, useRef, useState } from "react";
import { WS } from "@/exchanges/binance";
import type { Candle, MarketType, Ticker24h, Timeframe } from "@/types/market";

export type ConnState = "loading" | "live" | "reconnecting" | "error";

export interface LiveMarket {
  /** `symbol:market:tf` that `candles` and `ticker` belong to. Empty while loading. After a switch, the previous coin's data lingers for one render, so consumers must compare this to what they asked for. */
  key: string;
  candles: Candle[];
  ticker: Ticker24h | null;
  state: ConnState;
  lastMsgAt: number;
  error?: string;
}

/** Loads REST history, then keeps it current with Binance WebSocket kline + ticker streams. */
export function useLiveMarket(symbol: string, market: MarketType, tf: Timeframe): LiveMarket {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataKey, setDataKey] = useState("");
  const [ticker, setTicker] = useState<Ticker24h | null>(null);
  const [state, setState] = useState<ConnState>("loading");
  const [lastMsgAt, setLast] = useState(0);
  const [error, setError] = useState<string>();
  const pending = useRef<{ c?: Candle; t?: Partial<Ticker24h> }>({});

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout>;
    queueMicrotask(() => {
      if (disposed) return;
      setState("loading");
      setError(undefined);
      setCandles([]);
      setTicker(null);
      setDataKey("");
    });

    const q = `symbol=${symbol}&market=${market}`;

    const connect = () => {
      const s = symbol.toLowerCase();
      ws = new WebSocket(`${WS[market]}?streams=${s}@kline_${tf}/${s}@ticker`);
      ws.onopen = () => {
        retry = 0;
        setState("live");
      };
      ws.onmessage = (ev) => {
        const { stream, data } = JSON.parse(ev.data);
        if (stream.includes("@kline")) {
          const k = data.k;
          pending.current.c = {
            time: Math.floor(k.t / 1000),
            open: +k.o, high: +k.h, low: +k.l, close: +k.c,
            volume: +k.v, quoteVolume: +k.q, closed: k.x,
          };
        } else if (stream.includes("@ticker")) {
          pending.current.t = {
            price: +data.c, changePct: +data.P, high: +data.h, low: +data.l,
            quoteVolume: +data.q, timestamp: data.E,
          };
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setState("reconnecting");
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
      };
      ws.onerror = () => ws?.close();
    };

    // Batch WS updates to ~4 renders/sec so the UI updates smoothly without flashing.
    const flush = setInterval(() => {
      const { c, t } = pending.current;
      if (!c && !t) return;
      pending.current = {};
      setLast(Date.now());
      if (c)
        setCandles((prev) => {
          if (!prev.length) return prev;
          const last = prev[prev.length - 1];
          if (c.time === last.time) return [...prev.slice(0, -1), c];
          if (c.time > last.time) return [...prev.slice(-1999), c];
          return prev;
        });
      if (t) setTicker((prev) => (prev ? { ...prev, ...t } : prev));
    }, 250);

    (async () => {
      try {
        const [cRes, tRes] = await Promise.all([
          fetch(`/api/candles?${q}&tf=${tf}&limit=1000`),
          fetch(`/api/ticker?${q}`),
        ]);
        if (!cRes.ok || !tRes.ok) throw new Error((await (cRes.ok ? tRes : cRes).json()).error);
        const [cs, tk] = await Promise.all([cRes.json(), tRes.json()]);
        if (disposed) return;
        setCandles(cs);
        setTicker(tk);
        setDataKey(`${symbol}:${market}:${tf}`);
        setLast(Date.now());
        connect();
      } catch (e) {
        if (disposed) return;
        setError(e instanceof Error ? e.message : "failed to load");
        setState("error");
      }
    })();

    return () => {
      disposed = true;
      clearInterval(flush);
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [symbol, market, tf]);

  return { key: dataKey, candles, ticker, state, lastMsgAt, error };
}
