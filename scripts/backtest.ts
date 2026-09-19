/**
 * Walk-forward evaluation of the dashboard's own signals on historical Binance perp candles.
 *
 *   npm run backtest -- BTCUSDT 1h 2024-01-01 [2026-01-01]
 *
 * It answers two questions honestly:
 *   1. Do the labels carry information? (forward returns per label vs the unconditional average, overlap-adjusted t-stats)
 *   2. Would trading them have paid after costs? (simple long/short/flat rules, full period and each half)
 *
 * The signal thresholds are the live dashboard's, untouched: no parameter search, so nothing here is fitted to the past.
 */
import { computeMomentum } from "@/analysis/momentum";
import { computeTechnicals } from "@/analysis/technicals";
import { binance } from "@/exchanges/binance";
import { classifyRegime } from "@/regime/regime";
import { runStudy, type SignalFn, type StudyResult } from "@/backtest/study";
import { simulate, type SimResult } from "@/backtest/sim";
import { TIMEFRAMES, type Candle, type Timeframe } from "@/types/market";

const [symbol = "BTCUSDT", tfArg = "1h", fromArg, toArg] = process.argv.slice(2);
const tf = tfArg as Timeframe;
if (!/^[A-Z0-9]{2,20}$/.test(symbol) || !TIMEFRAMES.includes(tf)) { console.error(`Usage: npm run backtest -- SYMBOL ${TIMEFRAMES.join("|")} [FROM YYYY-MM-DD] [TO YYYY-MM-DD]`); process.exit(1); }
const TF_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };
const toMs = toArg ? Date.parse(`${toArg}T00:00:00Z`) : Date.now();
const fromMs = fromArg ? Date.parse(`${fromArg}T00:00:00Z`) : toMs - 2 * 365 * 86400_000;
if (!isFinite(fromMs) || !isFinite(toMs) || fromMs >= toMs) { console.error("Invalid date range"); process.exit(1); }

const HORIZONS = [1, 4, 12, 24];
const FEE_BPS = 4, SLIP_BPS = 1; // per side: roughly Binance taker fee plus a small slippage allowance
const WINDOW = 300;

interface Feat { trend: string; vol: string; stalled: boolean; mom: string; align: string }
const cache = new Map<number, Feat | null>();
function features(w: Candle[]): Feat | null {
  const key = w[w.length - 1].time;
  if (cache.has(key)) return cache.get(key)!;
  const r = classifyRegime(w, tf, { nowMs: (key + TF_SEC[tf]) * 1000 });
  const m = computeMomentum(w), t = computeTechnicals(w);
  const f = r && m && t ? { trend: r.trend, vol: r.volatility, stalled: r.stalled, mom: `${m.direction}/${m.strength}`, align: t.alignment } : null;
  cache.set(key, f);
  return f;
}
const signals: Record<string, SignalFn> = {
  "regime trend": (w) => features(w)?.trend ?? null,
  "regime trend (stalled split)": (w) => { const f = features(w); return f ? `${f.trend}${f.stalled ? " (stalling)" : ""}` : null; },
  "volatility regime": (w) => features(w)?.vol ?? null,
  "momentum": (w) => features(w)?.mom ?? null,
  "EMA alignment": (w) => features(w)?.align ?? null,
};

const pct = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const pad = (s: string | number, n: number, right = false) => (right ? String(s).padEnd(n) : String(s).padStart(n));

function printStudy(name: string, r: StudyResult, range = false) {
  console.log(`\n== ${name}`);
  console.log(`${pad("label", 30, true)} ${pad("h", 3)} ${pad("n", 6)} ${pad("nEff", 6)} ${pad("mean", 8)} ${pad("hit", 6)} ${pad("excess", 8)} ${pad("t", 6)}`);
  for (const label of Object.keys(r.byLabel).sort()) {
    for (const h of r.horizons) {
      const s = r.byLabel[label][h];
      const flag = !s.reliable ? "  (thin)" : s.t !== null && Math.abs(s.t) >= 3 ? "  *" : "";
      console.log(`${pad(label, 30, true)} ${pad(h, 3)} ${pad(s.n, 6)} ${pad(Math.round(s.nEff), 6)} ${pad(range ? (s.mean * 100).toFixed(2) + "%" : pct(s.mean), 8)} ${pad(range ? "-" : (s.hitRate * 100).toFixed(0) + "%", 6)} ${pad(pct(s.excess), 8)} ${pad(s.t === null ? "-" : s.t.toFixed(1), 6)}${flag}`);
    }
  }
  console.log(`${pad("(all bars)", 30, true)}     ${pad(r.baseline[HORIZONS[0]].n, 6)} ${pad("", 6)} ${HORIZONS.map((h) => `h${h} ${pct(r.baseline[h].mean, 3)}`).join("  ")}`);
}

function row(name: string, r: SimResult) {
  console.log(`${pad(name, 26, true)} ${pad(pct(r.totalReturn, 1), 9)} ${pad(pct(r.buyHoldReturn, 1), 9)} ${pad(pct(r.maxDrawdown, 1), 8)} ${pad(r.trades, 6)} ${pad((r.exposure * 100).toFixed(0) + "%", 5)} ${pad(r.sharpe === null ? "-" : r.sharpe.toFixed(2), 6)} ${pad(pct(r.costPaid, 1), 8)}`);
}

async function main() {
  console.log(`Fetching ${symbol} perp ${tf} ${new Date(fromMs).toISOString().slice(0, 10)} -> ${new Date(toMs).toISOString().slice(0, 10)} ...`);
  const candles = await binance.getCandlesRange!(symbol, "perp", tf, fromMs, toMs);
  if (candles.length < WINDOW + 200) { console.error(`Only ${candles.length} candles: need at least ${WINDOW + 200}.`); process.exit(1); }
  let missing = 0;
  for (let i = 1; i < candles.length; i++) missing += Math.max(0, Math.round((candles[i].time - candles[i - 1].time) / TF_SEC[tf]) - 1);
  console.log(`${candles.length} candles, ${missing} missing bars, ${new Date(candles[0].time * 1000).toISOString().slice(0, 10)} -> ${new Date(candles.at(-1)!.time * 1000).toISOString().slice(0, 10)}`);
  console.log(`Signals use the dashboard's own thresholds, no tuning. Entry at next bar's open. Costs ${FEE_BPS + SLIP_BPS} bps per side (fee ${FEE_BPS} + slippage ${SLIP_BPS}).`);
  console.log(`h = horizon in bars; nEff = n/h (forward windows overlap); t is the excess vs all bars using nEff; * = |t| >= 3; (thin) = nEff < 30.`);

  for (const [name, fn] of Object.entries(signals)) printStudy(name, runStudy(candles, fn, { horizons: HORIZONS, window: WINDOW }));

  // A volatility regime claims to describe HOW MUCH price will move, not which way, so judge it on that: the forward high-low range.
  console.log(`\n\n######## Forward RANGE (how much price moved over the next h bars, high-low over entry open). Direction-free. mean = average range, excess = vs all bars.`);
  for (const name of ["volatility regime", "regime trend"]) printStudy(`${name} -> forward range`, runStudy(candles, signals[name], { horizons: HORIZONS, window: WINDOW, measure: "range" }), true);

  // Strategy rules: label -> position. Positions are decided from the label at bar i, executed at bar i+1's open.
  const rules: Record<string, (f: Feat) => number> = {
    "regime follow (long/short)": (f) => (f.trend.includes("UP") ? 1 : f.trend.includes("DOWN") ? -1 : 0),
    "regime long-only": (f) => (f.trend.includes("UP") ? 1 : 0),
    "momentum follow": (f) => (f.mom.startsWith("BULLISH") ? 1 : f.mom.startsWith("BEARISH") ? -1 : 0),
  };
  const desired = (rule: (f: Feat) => number) => candles.map((_, i) => {
    if (i < WINDOW - 1) return 0;
    const f = features(candles.slice(Math.max(0, i - WINDOW + 1), i + 1));
    return f ? rule(f) : 0;
  });
  const opts = { feeBps: FEE_BPS, slipBps: SLIP_BPS, barsPerYear: (365 * 86400) / TF_SEC[tf] };
  const start = WINDOW - 1, mid = start + Math.floor((candles.length - 1 - start) / 2);
  console.log(`\n== Strategies (unlevered, no funding). Columns: strategy return | buy&hold | max drawdown | entries | in market | Sharpe | costs paid`);
  const periods: [string, number, number][] = [["FULL PERIOD", start, candles.length], ["FIRST HALF", start, mid + 1], ["SECOND HALF", mid, candles.length]];
  for (const [label, a, b] of periods) {
    console.log(`\n${label}: ${new Date(candles[a].time * 1000).toISOString().slice(0, 10)} -> ${new Date(candles[b - 1].time * 1000).toISOString().slice(0, 10)}`);
    console.log(`${pad("strategy", 26, true)} ${pad("return", 9)} ${pad("hold", 9)} ${pad("maxDD", 8)} ${pad("trades", 6)} ${pad("mkt", 5)} ${pad("sharpe", 6)} ${pad("costs", 8)}`);
    const seg = candles.slice(0, b);
    row("buy & hold", simulate(seg, candles.map(() => 1), a, { ...opts, feeBps: 0, slipBps: 0 }));
    for (const [name, rule] of Object.entries(rules)) row(name, simulate(seg, desired(rule).slice(0, b), a, opts));
  }
  console.log(`\nReading this: an edge needs to beat buy & hold AND hold up in both halves AND survive costs. One good period is luck until proven otherwise.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
