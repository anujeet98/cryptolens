import { TF_SECONDS } from "@/analysis/volume";
import type { FundingClass } from "@/analysis/funding";
import { RISK_TABLE, forecastRanges, windowLabel } from "@/risk/forecast";
import type { VolRegime } from "@/regime/regime";
import type { Candle, Timeframe } from "@/types/market";

export type SignalKind = "vol-extreme" | "range-spike" | "liq-burst" | "funding-extreme";

/** How much backtesting stands behind a trigger. Shown in the UI so the user can weigh each alert. */
export type Evidence = "backtested" | "descriptive" | "untested";

export const SIGNAL_INFO: Record<SignalKind, { label: string; evidence: Evidence; note: string }> = {
  "vol-extreme": {
    label: "Volatility turns EXTREME",
    evidence: "backtested",
    note: "Backtests: price ranges over the next hours were well above average after this state.",
  },
  "range-spike": {
    label: "Unusually large recent move",
    evidence: "backtested",
    note: "The last 4 bars ranged more than the historical 90th percentile for that ATR. Says nothing about direction.",
  },
  "liq-burst": {
    label: "Liquidation burst",
    evidence: "descriptive",
    note: "Liquidations in the last minute far above this coin's own average. Not backtested for what follows.",
  },
  "funding-extreme": {
    label: "Funding extreme",
    evidence: "untested",
    note: "Crowded positioning is a heuristic. Not yet backtested, so treat it as context only.",
  },
};

export const REARM_MS = 5 * 60_000; // the condition must stay false this long before the same alert can fire again
export const COOLDOWN_MS = 15 * 60_000; // and never more often than this
export const RANGE_BARS = 4;

export interface Snapshot {
  symbol: string;
  tf: Timeframe;
  ts: number; // ms
  volatility: VolRegime | null;
  atrPct: number | null;
  trailingRangePct: number | null; // range of the last RANGE_BARS bars, % of the window's first open
  liqBurst: { active: boolean; dominant: "long" | "short" | null; lastMinUsd: number; avgMinUsd: number } | null;
  fundingClass: FundingClass | null;
}

export interface AlertEvent {
  id: string;
  ts: number;
  kind: SignalKind | "price-cross";
  symbol: string;
  title: string;
  detail: string;
}

export interface SignalState {
  active: boolean;
  clearSince: number | null;
  lastFiredAt: number | null;
}
export interface EngineState {
  context: string | null;
  signals: Partial<Record<SignalKind, SignalState>>;
}
export const emptyState = (): EngineState => ({ context: null, signals: {} });

/** Range of the last n candles (highest high minus lowest low) as a percent of the first candle's open. */
export function trailingRangePct(c: Candle[], n = RANGE_BARS): number | null {
  if (c.length < n) return null;
  const w = c.slice(-n);
  let hi = -Infinity,
    lo = Infinity;
  for (const x of w) {
    hi = Math.max(hi, x.high);
    lo = Math.min(lo, x.low);
  }
  return w[0].open > 0 ? ((hi - lo) / w[0].open) * 100 : null;
}

/** null = the inputs for this rule are not available right now (no opinion: state is left alone). */
export function conditionOf(kind: SignalKind, s: Snapshot): boolean | null {
  switch (kind) {
    case "vol-extreme":
      return s.volatility === null ? null : s.volatility === "EXTREME";
    case "range-spike":
      if (s.trailingRangePct === null || s.atrPct === null || !(s.atrPct > 0)) return null;
      return s.trailingRangePct / s.atrPct >= RISK_TABLE[RANGE_BARS].p90;
    case "liq-burst":
      return s.liqBurst === null ? null : s.liqBurst.active;
    case "funding-extreme":
      return s.fundingClass === null
        ? null
        : s.fundingClass === "EXTREMELY_POSITIVE" || s.fundingClass === "EXTREMELY_NEGATIVE";
  }
}

const usd = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

export function describe(kind: SignalKind, s: Snapshot): { title: string; detail: string } {
  const sym = s.symbol;
  switch (kind) {
    case "vol-extreme": {
      const f = s.atrPct !== null ? forecastRanges(s.atrPct)[0] : null;
      const win = windowLabel(f?.h ?? RANGE_BARS, TF_SECONDS[s.tf]);
      return {
        title: `${sym} volatility is EXTREME (${s.tf})`,
        detail: f
          ? `Top 5% of recent volatility. Typical range over the next ${win}: ${f.p50.toFixed(2)}%, very wide ${f.p90.toFixed(2)}%. Direction unknown.`
          : "Top 5% of recent volatility. Direction unknown.",
      };
    }
    case "range-spike": {
      const mult = s.atrPct && s.trailingRangePct ? s.trailingRangePct / s.atrPct : null;
      return {
        title: `${sym} large move on ${s.tf}`,
        detail: `The last ${RANGE_BARS} bars ranged ${s.trailingRangePct?.toFixed(2)}%${mult ? ` (${mult.toFixed(1)}x ATR)` : ""}, above the historical 90th percentile. Direction not implied.`,
      };
    }
    case "liq-burst": {
      const b = s.liqBurst;
      return {
        title: `${sym} liquidation burst`,
        detail: b
          ? `${b.dominant === "long" ? "Longs" : b.dominant === "short" ? "Shorts" : "Positions"} being flushed: ${usd(b.lastMinUsd)} in the last minute vs ${usd(b.avgMinUsd)}/min average.`
          : "Liquidations well above average.",
      };
    }
    case "funding-extreme": {
      const pos = s.fundingClass === "EXTREMELY_POSITIVE";
      return {
        title: `${sym} funding ${pos ? "extremely positive" : "extremely negative"}`,
        detail: `${pos ? "Longs are paying heavily: positioning looks crowded long." : "Shorts are paying heavily: positioning looks crowded short."} Context only, not yet backtested.`,
      };
    }
  }
}

export interface EvalResult {
  events: AlertEvent[];
  state: EngineState;
}

/**
 * Edge-triggered evaluation for the coin and timeframe on screen. An alert fires when its condition turns true, never because
 * it was already true: the first observation in any context (new coin, new timeframe, page load) only PRIMES the state. After
 * firing, the condition must stay false for REARM_MS before it can fire again, and never more often than COOLDOWN_MS.
 */
export function evaluateSignals(
  enabled: Partial<Record<SignalKind, boolean>>,
  snap: Snapshot,
  prev: EngineState,
): EvalResult {
  const context = `${snap.symbol}:${snap.tf}`;
  const kinds = Object.keys(SIGNAL_INFO) as SignalKind[];
  const signals: EngineState["signals"] = context === prev.context ? { ...prev.signals } : {};
  const events: AlertEvent[] = [];
  const fresh = context !== prev.context;

  for (const kind of kinds) {
    const cond = conditionOf(kind, snap);
    const st = signals[kind];
    if (cond === null) continue; // no data: leave state untouched
    if (!st) {
      // first observation for this rule in this context: prime, never fire
      signals[kind] = { active: cond, clearSince: cond ? null : snap.ts, lastFiredAt: null };
      continue;
    }
    if (cond) {
      const cooled = st.lastFiredAt === null || snap.ts - st.lastFiredAt >= COOLDOWN_MS;
      if (!st.active && cooled && enabled[kind] && !fresh) {
        const d = describe(kind, snap);
        events.push({ id: `${kind}:${snap.symbol}:${snap.ts}`, ts: snap.ts, kind, symbol: snap.symbol, ...d });
        signals[kind] = { active: true, clearSince: null, lastFiredAt: snap.ts };
      } else {
        signals[kind] = { ...st, active: true, clearSince: null }; // still true (or suppressed): keep it latched
      }
    } else if (st.active) {
      // condition just went false: start the re-arm clock, release the latch only after it has stayed false long enough
      const since = st.clearSince ?? snap.ts;
      signals[kind] =
        snap.ts - since >= REARM_MS ? { ...st, active: false, clearSince: null } : { ...st, clearSince: since };
    } else {
      signals[kind] = { ...st, clearSince: st.clearSince ?? snap.ts };
    }
  }
  return { events, state: { context, signals } };
}

export interface LevelRule {
  id: string;
  symbol: string;
  market: "spot" | "perp";
  level: number;
  dir: "above" | "below";
  createdAt: number;
}

export interface LevelResult {
  events: AlertEvent[];
  firedIds: string[];
  lastPrices: Record<string, number>;
}

/**
 * A level fires when price crosses it between two observations. Needs a previous price for that coin, so the first
 * observation only records. One-shot: the caller removes fired rules. Works for any coin whose price you feed in.
 */
export function evaluateLevels(
  rules: LevelRule[],
  prices: Record<string, number>,
  lastPrices: Record<string, number>,
  ts: number,
): LevelResult {
  const events: AlertEvent[] = [];
  const firedIds: string[] = [];
  for (const r of rules) {
    const key = `${r.symbol}:${r.market}`;
    const now = prices[key],
      prev = lastPrices[key];
    if (now === undefined || prev === undefined) continue;
    const crossed = r.dir === "above" ? prev < r.level && now >= r.level : prev > r.level && now <= r.level;
    if (!crossed) continue;
    firedIds.push(r.id);
    events.push({
      id: `price:${r.id}:${ts}`,
      ts,
      kind: "price-cross",
      symbol: r.symbol,
      title: `${r.symbol} ${r.dir === "above" ? "rose above" : "fell below"} ${r.level}`,
      detail: `Price is now ${now}. This alert is one-shot and has been removed.`,
    });
  }
  return { events, firedIds, lastPrices: { ...lastPrices, ...prices } };
}
