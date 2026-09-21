"use client";
import { useEffect, useState } from "react";
import { DEPTH_WS } from "@/exchanges/binance";
import { analyzeBook, type BookAnalysis } from "@/orderbook/analysis";
import { LocalOrderBook, type DepthEvent, type Level } from "@/orderbook/localBook";
import { WallTracker, type WallEvent } from "@/orderbook/wallTracker";
import type { MarketType } from "@/types/market";

export type BookStatus = "syncing" | "live" | "resyncing" | "error";

export interface OrderBookState {
  key: string;
  status: BookStatus;
  bids: Level[];
  asks: Level[];
  analysis: BookAnalysis | null;
  lastEventAt: number;
  resyncs: number;
  wallEvents: WallEvent[];
  activeWalls: { side: "bid" | "ask"; price: number; usd: number; ageSec: number }[];
  error?: string;
}

const EMPTY = (key: string): OrderBookState => ({
  key,
  status: "syncing",
  bids: [],
  asks: [],
  analysis: null,
  lastEventAt: 0,
  resyncs: 0,
  wallEvents: [],
  activeWalls: [],
});

/** Local order book: REST snapshot + WS deltas, sequence-checked, automatic resync on any gap or crossed book. */
export function useOrderBook(symbol: string, market: MarketType): OrderBookState {
  const key = `${symbol}:${market}`;
  const [st, setSt] = useState<OrderBookState>(() => EMPTY(key));

  useEffect(() => {
    let dead = false;
    let ws: WebSocket | null = null;
    let wsRetry = 0;
    let wsTimer: ReturnType<typeof setTimeout>;
    let syncing = false;
    let resyncs = 0;
    let lastEventAt = 0;
    let status: BookStatus = "syncing";
    let error: string | undefined;
    const book = new LocalOrderBook(market);
    const tracker = new WallTracker();

    const resync = async (attempt = 0) => {
      if (syncing || dead) return;
      syncing = true;
      status = attempt === 0 && resyncs === 0 ? "syncing" : "resyncing";
      book.reset(); // subsequent events are buffered until the snapshot lands
      try {
        const r = await fetch(`/api/depth?symbol=${symbol}&market=${market}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (dead) return;
        if (book.loadSnapshot(j) === "gap") {
          syncing = false;
          if (attempt < 5) return void setTimeout(() => resync(attempt + 1), 400);
          throw new Error("could not align snapshot with stream");
        }
        status = "live";
        error = undefined;
      } catch (e) {
        status = "error";
        error = e instanceof Error ? e.message : "order book failed";
        setTimeout(() => {
          syncing = false;
          resync();
        }, 3000);
        return;
      }
      syncing = false;
    };

    const connect = () => {
      const s = symbol.toLowerCase();
      ws = new WebSocket(`${DEPTH_WS[market]}?streams=${s}@depth@100ms`);
      ws.onopen = () => {
        wsRetry = 0;
        resync();
      };
      ws.onmessage = (ev) => {
        const d = JSON.parse(ev.data).data;
        const e: DepthEvent = {
          U: d.U,
          u: d.u,
          pu: d.pu,
          b: d.b.map((x: string[]) => [+x[0], +x[1]] as Level),
          a: d.a.map((x: string[]) => [+x[0], +x[1]] as Level),
        };
        lastEventAt = Date.now();
        const res = book.accept(e);
        if (res === "gap" || (res === "applied" && book.isCrossed())) {
          resyncs++;
          resync();
        }
      };
      ws.onclose = () => {
        if (dead) return;
        status = "resyncing";
        book.reset();
        wsTimer = setTimeout(connect, Math.min(1000 * 2 ** wsRetry++, 15_000));
      };
      ws.onerror = () => ws?.close();
    };

    // Recompute ~4x/sec so the UI stays smooth despite 10 deltas/sec.
    const flush = setInterval(() => {
      if (dead) return;
      const now = Date.now();
      if (!book.synced) {
        setSt((p) => ({ ...(p.key === key ? p : EMPTY(key)), status, lastEventAt, resyncs, error }));
        return;
      }
      const { bids, asks } = book.view(1000);
      const analysis = analyzeBook(bids, asks);
      if (analysis) tracker.update(analysis.walls, analysis.mid, now);
      setSt({
        key,
        status,
        bids,
        asks,
        analysis,
        lastEventAt,
        resyncs,
        wallEvents: tracker.events,
        activeWalls: tracker.active(now),
        error,
      });
    }, 250);

    connect();
    return () => {
      dead = true;
      clearInterval(flush);
      clearTimeout(wsTimer);
      ws?.close();
    };
  }, [symbol, market, key]);

  return st.key === key ? st : EMPTY(key);
}
