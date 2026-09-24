/**
 * Live Binance fetches feeding pumpwatch.ts: klines with taker split, OI history, funding/basis, long/short
 * ratios, book depth, plus a short-lived liquidation stream for commentary watch windows.
 */
import type { FlowCandle, PumpInputs } from "@/scan/pumpwatch";

const FAPI = "https://fapi.binance.com";
const SPOT = "https://api.binance.com";
// Futures liquidations live on the routed /market path; the legacy unrouted stream delivers nothing.
const LIQ_WS = "wss://fstream.binance.com/market/stream";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Binance ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

type RawKline = [number, string, string, string, string, string, number, string, number, string, string, string];

function toFlow(k: RawKline): FlowCandle {
  return {
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    baseVolume: +k[5],
    quoteVolume: +k[7],
    takerBuyBase: +k[9],
  };
}

export interface Liquidation {
  at: number;
  side: "short" | "long"; // which side got liquidated
  usd: number;
  price: number;
}

/** Collects forced orders for one symbol until stop() is called. */
export function openLiquidationStream(symbol: string, onLiq?: (l: Liquidation) => void) {
  const liqs: Liquidation[] = [];
  let ws: WebSocket | null = null;
  try {
    ws = new WebSocket(`${LIQ_WS}?streams=${symbol.toLowerCase()}@forceOrder`);
    ws.onmessage = (ev) => {
      const o = JSON.parse(String(ev.data))?.data?.o;
      if (!o) return;
      const l: Liquidation = {
        at: Date.now(),
        side: o.S === "BUY" ? "short" : "long",
        usd: +o.ap * +o.z,
        price: +o.ap,
      };
      liqs.push(l);
      onLiq?.(l);
    };
  } catch {
    // No stream: the liquidation factor just reads zero.
  }
  return {
    liqs,
    stop: () => ws?.close(),
  };
}

export async function fetchPumpInputs(symbol: string, liqs: Liquidation[] = []): Promise<PumpInputs> {
  const s = symbol.toUpperCase();
  const [perp, oiHist, prem, ls, top, depth, spot] = await Promise.all([
    get<RawKline[]>(`${FAPI}/fapi/v1/klines?symbol=${s}&interval=1m&limit=180`),
    get<{ sumOpenInterest: string }[]>(`${FAPI}/futures/data/openInterestHist?symbol=${s}&period=5m&limit=13`),
    get<{ lastFundingRate: string; markPrice: string; indexPrice: string }>(`${FAPI}/fapi/v1/premiumIndex?symbol=${s}`),
    get<{ longShortRatio: string }[]>(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${s}&period=5m&limit=7`),
    get<{ longShortRatio: string }[]>(`${FAPI}/futures/data/topLongShortPositionRatio?symbol=${s}&period=5m&limit=7`),
    get<{ bids: [string, string][]; asks: [string, string][] }>(`${FAPI}/fapi/v1/depth?symbol=${s}&limit=500`),
    get<RawKline[]>(`${SPOT}/api/v3/klines?symbol=${s}&interval=1m&limit=15`).catch(() => null),
  ]);
  const candles = perp.map(toFlow);
  const price = candles[candles.length - 1].close;
  const notional = (side: [string, string][], inBand: (p: number) => boolean) =>
    side.reduce((acc, [p, q]) => (inBand(+p) ? acc + +p * +q : acc), 0);
  const since = Date.now() - 300_000;
  const recent = liqs.filter((l) => l.at > since);
  return {
    perp: candles,
    spot: spot?.length ? spot.map(toFlow) : null,
    oiHist5m: oiHist.map((o) => +o.sumOpenInterest),
    fundingPct: +prem.lastFundingRate * 100,
    basisPct: (+prem.markPrice / +prem.indexPrice - 1) * 100,
    retailLongShort: [+ls[0].longShortRatio, +ls[ls.length - 1].longShortRatio],
    topLongShort: [+top[0].longShortRatio, +top[top.length - 1].longShortRatio],
    bids1pctUsd: notional(depth.bids, (p) => p >= price * 0.99),
    asks1pctUsd: notional(depth.asks, (p) => p <= price * 1.01),
    shortLiqs5mUsd: recent.filter((l) => l.side === "short").reduce((a, l) => a + l.usd, 0),
    longLiqs5mUsd: recent.filter((l) => l.side === "long").reduce((a, l) => a + l.usd, 0),
  };
}
