import type { Level } from "./localBook";

export const DEPTH_BANDS = [0.1, 0.25, 0.5, 1, 2, 5] as const; // percent from mid
export const IMPACT_SIZES = [10_000, 50_000, 100_000, 500_000] as const; // USD notional

export interface DepthBand {
  pct: number;
  bidUsd: number;
  askUsd: number;
  imbalance: number; // (bid - ask) / (bid + ask), -1..+1
  complete: boolean; // false when the loaded book does not reach this far on both sides
}

export interface Impact {
  usd: number;
  buySlippageBps: number | null; // null = book too thin to fill
  sellSlippageBps: number | null;
}

export type LiquidityRating = "HIGH" | "MEDIUM" | "LOW";

export interface Wall {
  side: "bid" | "ask";
  price: number;
  usd: number;
  distancePct: number;
  multiple: number;
}

export interface BookAnalysis {
  mid: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  bands: DepthBand[];
  impacts: Impact[];
  rating: LiquidityRating;
  coveragePct: { bid: number; ask: number }; // how far from mid the loaded book extends
  walls: Wall[];
}

const usd = (l: Level) => l[0] * l[1];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Average fill price for a market order of `notional` USD walking the book; null if the book cannot absorb it. */
export function fillPrice(levels: Level[], notional: number): number | null {
  let remaining = notional,
    cost = 0,
    qty = 0;
  for (const [p, q] of levels) {
    const take = Math.min(remaining, p * q);
    cost += take;
    qty += take / p;
    remaining -= take;
    if (remaining <= 1e-9) return cost / qty;
  }
  return null;
}

export function analyzeBook(bids: Level[], asks: Level[]): BookAnalysis | null {
  if (!bids.length || !asks.length) return null;
  const bestBid = bids[0][0],
    bestAsk = asks[0][0];
  if (bestBid >= bestAsk) return null;
  const mid = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;

  const covBid = ((mid - bids[bids.length - 1][0]) / mid) * 100;
  const covAsk = ((asks[asks.length - 1][0] - mid) / mid) * 100;

  const bands: DepthBand[] = DEPTH_BANDS.map((pct) => {
    const lo = mid * (1 - pct / 100),
      hi = mid * (1 + pct / 100);
    const b = bids.filter((l) => l[0] >= lo).reduce((s, l) => s + usd(l), 0);
    const a = asks.filter((l) => l[0] <= hi).reduce((s, l) => s + usd(l), 0);
    return {
      pct,
      bidUsd: b,
      askUsd: a,
      imbalance: b + a > 0 ? (b - a) / (b + a) : 0,
      complete: covBid >= pct && covAsk >= pct,
    };
  });

  const impacts: Impact[] = IMPACT_SIZES.map((n) => {
    const buy = fillPrice(asks, n),
      sell = fillPrice(bids, n);
    return {
      usd: n,
      buySlippageBps: buy === null ? null : ((buy - mid) / mid) * 1e4,
      sellSlippageBps: sell === null ? null : ((mid - sell) / mid) * 1e4,
    };
  });

  // Rating from the $100k round-trip cost (worse side) and spread. Thin/unfillable → LOW.
  const i100 = impacts.find((i) => i.usd === 100_000)!;
  const worst =
    i100.buySlippageBps === null || i100.sellSlippageBps === null
      ? Infinity
      : Math.max(i100.buySlippageBps, i100.sellSlippageBps);
  const spreadBps = (spread / mid) * 1e4;
  const rating: LiquidityRating =
    worst <= 5 && spreadBps <= 3 ? "HIGH" : worst <= 30 && spreadBps <= 15 ? "MEDIUM" : "LOW";

  return {
    mid,
    bestBid,
    bestAsk,
    spread,
    spreadBps,
    bands,
    impacts,
    rating,
    coveragePct: { bid: covBid, ask: covAsk },
    walls: findWalls(bids, asks, mid),
  };
}

/**
 * A "wall" is a level whose notional is far above the median of the nearby book. Displayed size can be cancelled
 * at any time, so these are only ever reported as potential liquidity walls.
 */
export function findWalls(bids: Level[], asks: Level[], mid: number, multiple = 6, perSide = 3): Wall[] {
  const out: Wall[] = [];
  for (const [side, levels] of [
    ["bid", bids],
    ["ask", asks],
  ] as const) {
    const near = levels.slice(0, 200);
    const med = median(near.map(usd));
    if (med <= 0) continue;
    near
      .map((l) => ({ l, m: usd(l) / med }))
      .filter((x) => x.m >= multiple && usd(x.l) >= 5_000)
      .sort((a, b) => usd(b.l) - usd(a.l))
      .slice(0, perSide)
      .forEach(({ l, m }) =>
        out.push({ side, price: l[0], usd: usd(l), distancePct: ((l[0] - mid) / mid) * 100, multiple: m }),
      );
  }
  return out;
}

/** Nice 1/2/5 × 10^k step. */
export function niceStep(x: number): number {
  if (x <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}

export interface LadderRow {
  price: number;
  usd: number;
  cumUsd: number;
}

/** Aggregates levels into price buckets (bids round down, asks round up) for a readable ladder. */
export function ladder(levels: Level[], side: "bid" | "ask", step: number, rows: number): LadderRow[] {
  const m = new Map<number, number>();
  for (const [p, q] of levels) {
    const k = side === "bid" ? Math.floor(p / step + 1e-9) * step : Math.ceil(p / step - 1e-9) * step;
    const key = +k.toPrecision(12);
    m.set(key, (m.get(key) ?? 0) + p * q);
  }
  const sorted = [...m].sort((a, b) => (side === "bid" ? b[0] - a[0] : a[0] - b[0])).slice(0, rows);
  let cum = 0;
  return sorted.map(([price, u]) => ({ price, usd: u, cumUsd: (cum += u) }));
}
