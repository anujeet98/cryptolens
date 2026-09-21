import type { ExchangeConnector } from "../types";
import type {
  Candle,
  CoinListing,
  DerivativesSnapshot,
  FundingPoint,
  LongShortPoint,
  MarketRef,
  MarketType,
  OiPeriod,
  OiPoint,
  Ticker24h,
  Timeframe,
} from "@/types/market";

const REST = "https://api.bitget.com/api/v2";
const PRODUCT = "USDT-FUTURES"; // USDT-margined linear perps. USDC-margined contracts are not included.

/** Granularity strings are case-sensitive and differ between spot and futures. */
const GRAN = {
  perp: { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1D" },
  spot: { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1day" },
} as const satisfies Record<MarketType, Record<Timeframe, string>>;
const TF_SEC: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
/** Long/short account ratio periods offered by Bitget. */
const LS_PERIODS: Partial<Record<OiPeriod, string>> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "24h",
};

interface Envelope<T> {
  code: string;
  msg: string;
  data: T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${REST}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Bitget ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as Envelope<T>;
  if (j.code !== "00000") throw new Error(`Bitget ${j.code}: ${j.msg}`);
  return j.data;
}

let listCache: { at: number; data: CoinListing[] } | null = null;

export const bitget: ExchangeConnector = {
  id: "bitget",

  async listMarkets() {
    if (listCache && Date.now() - listCache.at < 3_600_000) return listCache.data;
    const [spot, perp] = await Promise.all([
      get<{ symbol: string; baseCoin: string; quoteCoin: string; status: string }[]>("spot/public/symbols"),
      get<{ symbol: string; baseCoin: string; quoteCoin: string; symbolStatus: string; symbolType: string }[]>(
        `mix/market/contracts?productType=${PRODUCT}`,
      ),
    ]);
    const map = new Map<string, MarketRef[]>();
    const add = (base: string, m: MarketRef) => {
      const a = map.get(base) ?? [];
      a.push(m);
      map.set(base, a);
    };
    for (const s of spot)
      if (s.status === "online" && ["USDT", "USDC"].includes(s.quoteCoin))
        add(s.baseCoin, { exchange: "bitget", marketType: "spot", quote: s.quoteCoin, symbol: s.symbol });
    for (const s of perp)
      if (s.symbolStatus === "normal" && s.symbolType === "perpetual")
        add(s.baseCoin, { exchange: "bitget", marketType: "perp", quote: s.quoteCoin, symbol: s.symbol });
    const data = [...map].map(([base, markets]) => ({ base, markets }));
    listCache = { at: Date.now(), data };
    return data;
  },

  async getCandles(symbol, marketType, tf: Timeframe, limit) {
    const gran = GRAN[marketType][tf];
    const path =
      marketType === "perp"
        ? `mix/market/candles?productType=${PRODUCT}&symbol=${symbol}&granularity=${gran}&limit=${Math.min(limit, 1000)}`
        : `spot/market/candles?symbol=${symbol}&granularity=${gran}&limit=${Math.min(limit, 1000)}`;
    const rows = await get<string[][]>(path);
    const now = Date.now();
    // Oldest-first: [startMs, open, high, low, close, baseVolume, quoteVolume, ...]. No close time, so derive it.
    return rows
      .map((k): Candle => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        quoteVolume: +k[6],
        closed: Number(k[0]) + TF_SEC[tf] * 1000 <= now,
      }))
      .sort((a, b) => a.time - b.time);
  },

  async getTicker24h(symbol, marketType: MarketType): Promise<Ticker24h> {
    const path =
      marketType === "perp"
        ? `mix/market/ticker?productType=${PRODUCT}&symbol=${symbol}`
        : `spot/market/tickers?symbol=${symbol}`;
    const t = (await get<Record<string, string>[]>(path))[0];
    if (!t) throw new Error(`Bitget: no ticker for ${symbol}`);
    return {
      exchange: "bitget",
      symbol,
      marketType,
      timestamp: Date.now(),
      price: +t.lastPr,
      changePct: +t.change24h * 100, // change24h is a fraction
      high: +t.high24h,
      low: +t.low24h,
      quoteVolume: +t.quoteVolume,
    };
  },

  derivatives: {
    async getSnapshot(symbol): Promise<DerivativesSnapshot> {
      const [tick, fund, oi] = await Promise.all([
        get<Record<string, string>[]>(`mix/market/ticker?productType=${PRODUCT}&symbol=${symbol}`),
        get<{ fundingRate: string; nextUpdate: string }[]>(
          `mix/market/current-fund-rate?productType=${PRODUCT}&symbol=${symbol}`,
        ),
        get<{ openInterestList: { size: string }[] }>(
          `mix/market/open-interest?productType=${PRODUCT}&symbol=${symbol}`,
        ),
      ]);
      const t = tick[0],
        f = fund[0],
        size = oi.openInterestList[0]?.size;
      if (!t || !f || size === undefined) throw new Error(`Bitget: incomplete derivatives data for ${symbol}`);
      const mark = +t.markPrice;
      return {
        exchange: "bitget",
        symbol,
        timestamp: Date.now(),
        markPrice: mark,
        indexPrice: +t.indexPrice,
        fundingRate: +f.fundingRate,
        nextFundingTime: Number(f.nextUpdate),
        openInterest: +size,
        openInterestUsd: +size * mark, // size is in base coin
      };
    },
    async getFundingHistory(symbol, limit): Promise<FundingPoint[]> {
      const rows = await get<{ fundingRate: string; fundingTime: string }[]>(
        `mix/market/history-fund-rate?productType=${PRODUCT}&symbol=${symbol}&pageSize=${Math.min(limit, 100)}`,
      );
      return rows
        .map((r) => ({ time: Math.floor(Number(r.fundingTime) / 1000), rate: +r.fundingRate }))
        .sort((a, b) => a.time - b.time);
    },
    async getOpenInterestHistory(): Promise<OiPoint[]> {
      throw new Error("Bitget does not publish open-interest history");
    },
    async getLongShortRatio(symbol, period: OiPeriod, limit): Promise<LongShortPoint[]> {
      const p = LS_PERIODS[period];
      if (!p) throw new Error(`Bitget does not offer ${period} long/short history`);
      const rows = await get<
        { longAccountRatio: string; shortAccountRatio: string; longShortAccountRatio: string; ts: string }[]
      >(`mix/market/account-long-short?symbol=${symbol}&period=${p}`);
      return rows
        .map((r) => ({
          time: Math.floor(Number(r.ts) / 1000),
          ratio: +r.longShortAccountRatio,
          longPct: +r.longAccountRatio * 100,
          shortPct: +r.shortAccountRatio * 100,
        }))
        .sort((a, b) => a.time - b.time)
        .slice(-limit);
    },
  },
};
