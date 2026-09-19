import type { ExchangeConnector } from "../types";
import type { Candle, CoinListing, DerivativesSnapshot, FundingPoint, LongShortPoint, MarketRef, MarketType, OiPeriod, OiPoint, Ticker24h, Timeframe } from "@/types/market";

const REST = {
  spot: "https://api.binance.com/api/v3",
  perp: "https://fapi.binance.com/fapi/v1",
} as const;

// Futures split its streams by path: /market (ticker, kline, markPrice, liquidations) and /public (bookTicker, depth).
// The legacy unrouted /stream endpoint connects but delivers nothing.
const FUT_DATA = "https://fapi.binance.com/futures/data";

// Depth streams follow the same split: futures depth lives under /public.
export const DEPTH_WS = {
  spot: "wss://stream.binance.com:9443/stream",
  perp: "wss://fstream.binance.com/public/stream",
} as const;

export const WS = {
  spot: "wss://stream.binance.com:9443/stream",
  perp: "wss://fstream.binance.com/market/stream",
} as const;

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Binance ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

interface SpotInfo { symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] }
interface PerpInfo { symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string; contractType: string }[] }

let listCache: { at: number; data: CoinListing[] } | null = null;

export const binance: ExchangeConnector = {
  id: "binance",

  async listMarkets() {
    if (listCache && Date.now() - listCache.at < 3_600_000) return listCache.data;
    const [spot, perp] = await Promise.all([
      get<SpotInfo>(`${REST.spot}/exchangeInfo?permissions=SPOT`),
      get<PerpInfo>(`${REST.perp}/exchangeInfo`),
    ]);
    const map = new Map<string, MarketRef[]>();
    const add = (base: string, m: MarketRef) => {
      const arr = map.get(base) ?? [];
      arr.push(m);
      map.set(base, arr);
    };
    for (const s of spot.symbols)
      if (s.status === "TRADING" && ["USDT", "USDC"].includes(s.quoteAsset))
        add(s.baseAsset, { exchange: "binance", marketType: "spot", quote: s.quoteAsset, symbol: s.symbol });
    for (const s of perp.symbols)
      if (s.status === "TRADING" && s.contractType === "PERPETUAL")
        add(s.baseAsset, { exchange: "binance", marketType: "perp", quote: s.quoteAsset, symbol: s.symbol });
    const data = [...map].map(([base, markets]) => ({ base, markets }));
    listCache = { at: Date.now(), data };
    return data;
  },

  async getCandles(symbol, marketType, tf: Timeframe, limit) {
    const rows = await get<unknown[][]>(`${REST[marketType]}/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`);
    const now = Date.now();
    return rows.map((r): Candle => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: +(r[1] as string),
      high: +(r[2] as string),
      low: +(r[3] as string),
      close: +(r[4] as string),
      volume: +(r[5] as string),
      quoteVolume: +(r[7] as string),
      closed: Number(r[6]) < now,
    }));
  },

  async getOrderBookSnapshot(symbol, marketType, limit) {
    const d = await get<{ lastUpdateId: number; bids: string[][]; asks: string[][] }>(`${REST[marketType]}/depth?symbol=${symbol}&limit=${limit}`);
    const conv = (rows: string[][]) => rows.map((r) => [+r[0], +r[1]] as [number, number]);
    return { lastUpdateId: d.lastUpdateId, bids: conv(d.bids), asks: conv(d.asks) };
  },

  derivatives: {
    async getSnapshot(symbol): Promise<DerivativesSnapshot> {
      const [p, oi] = await Promise.all([
        get<Record<string, string | number>>(`${REST.perp}/premiumIndex?symbol=${symbol}`),
        get<Record<string, string>>(`${REST.perp}/openInterest?symbol=${symbol}`),
      ]);
      const mark = +p.markPrice;
      return {
        exchange: "binance", symbol, timestamp: Date.now(),
        markPrice: mark, indexPrice: +p.indexPrice, fundingRate: +p.lastFundingRate,
        nextFundingTime: Number(p.nextFundingTime),
        openInterest: +oi.openInterest, openInterestUsd: +oi.openInterest * mark,
      };
    },
    async getFundingHistory(symbol, limit): Promise<FundingPoint[]> {
      const rows = await get<{ fundingTime: number; fundingRate: string }[]>(`${REST.perp}/fundingRate?symbol=${symbol}&limit=${limit}`);
      return rows.map((r) => ({ time: Math.floor(r.fundingTime / 1000), rate: +r.fundingRate }));
    },
    async getOpenInterestHistory(symbol, period: OiPeriod, limit): Promise<OiPoint[]> {
      const rows = await get<{ sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }[]>(
        `${FUT_DATA}/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`);
      return rows.map((r) => ({ time: Math.floor(r.timestamp / 1000), oi: +r.sumOpenInterest, oiUsd: +r.sumOpenInterestValue }));
    },
    async getLongShortRatio(symbol, period: OiPeriod, limit): Promise<LongShortPoint[]> {
      const rows = await get<{ longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }[]>(
        `${FUT_DATA}/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`);
      return rows.map((r) => ({ time: Math.floor(r.timestamp / 1000), ratio: +r.longShortRatio, longPct: +r.longAccount, shortPct: +r.shortAccount }));
    },
  },

  async getTicker24h(symbol, marketType: MarketType): Promise<Ticker24h> {
    const t = await get<Record<string, string>>(`${REST[marketType]}/ticker/24hr?symbol=${symbol}`);
    return {
      exchange: "binance",
      symbol,
      marketType,
      timestamp: Date.now(),
      price: +t.lastPrice,
      changePct: +t.priceChangePercent,
      high: +t.highPrice,
      low: +t.lowPrice,
      quoteVolume: +t.quoteVolume,
    };
  },
};
