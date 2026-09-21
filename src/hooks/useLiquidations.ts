"use client";
import { useEffect, useRef, useState } from "react";
import { WS } from "@/exchanges/binance";
import { LiqStore, parseForceOrder, type LiqSnapshot } from "@/liquidations/liqs";

export type LiqStatus = "connecting" | "live" | "reconnecting";
export interface LiquidationState {
  status: LiqStatus;
  snap: LiqSnapshot | null;
  lastEventAt: number;
}

/**
 * Market-wide Binance futures liquidation feed (!forceOrder@arr). One socket serves every symbol, so switching coins
 * keeps the collected history. There is no REST backfill: history starts at connect and restarts after any reconnect gap.
 */
export function useLiquidations(symbol: string | null): LiquidationState {
  const [st, setSt] = useState<LiquidationState>({ status: "connecting", snap: null, lastEventAt: 0 });
  const symRef = useRef(symbol);
  useEffect(() => {
    symRef.current = symbol;
  }, [symbol]);

  useEffect(() => {
    let dead = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let status: LiqStatus = "connecting";
    let since = 0;
    let lastEventAt = 0;
    const store = new LiqStore();

    const connect = () => {
      ws = new WebSocket(`${WS.perp}?streams=!forceOrder@arr`);
      ws.onopen = () => {
        retry = 0;
        status = "live";
        since = Date.now();
      };
      ws.onmessage = (ev) => {
        const e = parseForceOrder(JSON.parse(ev.data).data);
        if (!e) return;
        store.add(e);
        lastEventAt = Date.now();
      };
      ws.onclose = () => {
        if (dead) return;
        status = "reconnecting";
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
      };
      ws.onerror = () => ws?.close();
    };

    const flush = setInterval(() => {
      if (dead) return;
      setSt({ status, snap: since ? store.snapshot(Date.now(), symRef.current, since) : null, lastEventAt });
    }, 1000);

    connect();
    return () => {
      dead = true;
      clearInterval(flush);
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return st;
}
