"use client";
import { useEffect, useState } from "react";
import { WS } from "@/exchanges/binance";
import { FlowStore, type FlowSnapshot } from "@/tradeflow/flow";
import type { MarketType } from "@/types/market";

export type FlowStatus = "connecting" | "live" | "reconnecting";

export interface TradeFlowState {
  key: string;
  status: FlowStatus;
  snap: FlowSnapshot | null;
  lastTradeAt: number;
}

const EMPTY = (key: string): TradeFlowState => ({ key, status: "connecting", snap: null, lastTradeAt: 0 });

/** Live taker flow from Binance aggTrade. History starts at connect: there is no REST backfill, so windows report how much they cover. */
export function useTradeFlow(symbol: string, market: MarketType): TradeFlowState {
  const key = `${symbol}:${market}`;
  const [st, setSt] = useState<TradeFlowState>(() => EMPTY(key));

  useEffect(() => {
    let dead = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let status: FlowStatus = "connecting";
    let lastTradeAt = 0;
    const store = new FlowStore();

    const connect = () => {
      ws = new WebSocket(`${WS[market]}?streams=${symbol.toLowerCase()}@aggTrade`);
      ws.onopen = () => { retry = 0; status = "live"; };
      ws.onmessage = (ev) => {
        const d = JSON.parse(ev.data).data;
        if (!d || d.e !== "aggTrade") return;
        const price = +d.p;
        // m = buyer is the maker, so the taker (aggressor) sold.
        store.add({ t: d.T, price, usd: price * +d.q, buy: !d.m });
        lastTradeAt = Date.now();
      };
      ws.onclose = () => {
        if (dead) return;
        status = "reconnecting"; // trades during the gap are lost; the store keeps what it has and says so via lastTradeAt
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
      };
      ws.onerror = () => ws?.close();
    };

    const flush = setInterval(() => {
      if (dead) return;
      setSt({ key, status, snap: store.snapshot(Date.now()), lastTradeAt });
    }, 500);

    connect();
    return () => { dead = true; clearInterval(flush); clearTimeout(timer); ws?.close(); };
  }, [symbol, market, key]);

  return st.key === key ? st : EMPTY(key);
}
