/**
 * Exploratory: how well does ATR (optionally conditioned on the volatility regime) predict the NEXT h bars' high-low range?
 * Calibrate quantiles on the first part of history, score on the later part. Pooled across symbols.
 *   npm run -s calibrate-risk -- 1h BTCUSDT ETHUSDT SOLUSDT
 */
import { binance } from "@/exchanges/binance";
import { classifyRegime } from "@/regime/regime";
import { forwardRange } from "@/backtest/study";
import { TIMEFRAMES, type Timeframe } from "@/types/market";

const [tfArg = "1h", ...syms] = process.argv.slice(2);
const tf = tfArg as Timeframe;
if (!TIMEFRAMES.includes(tf)) { console.error("bad timeframe"); process.exit(1); }
const SYMBOLS = syms.length ? syms : ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TF_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };
const HS = [4, 12, 24];
const QS = [0.5, 0.8, 0.9, 0.95];
const W = 300;

interface Obs { sym: string; i: number; n: number; vol: string; atrPct: number; x: Record<number, number> } // x[h] = forwardRange / (atrPct/100)

function quantile(sorted: number[], q: number) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN; }
/** Pinball (quantile) loss: the proper score for a quantile forecast. Lower is better. */
const pinball = (pred: number, y: number, q: number) => (y >= pred ? q * (y - pred) : (1 - q) * (pred - y));

async function main() {
  const toMs = Date.now(), fromMs = toMs - 2 * 365 * 86400_000;
  const obs: Obs[] = [];
  for (const sym of SYMBOLS) {
    const c = await binance.getCandlesRange!(sym, "perp", tf, fromMs, toMs);
    for (let i = W - 1; i < c.length - 1; i++) {
      const w = c.slice(i - W + 1, i + 1);
      const r = classifyRegime(w, tf, { nowMs: (c[i].time + TF_SEC[tf]) * 1000 });
      if (!r) continue;
      const x: Record<number, number> = {};
      let ok = true;
      for (const h of HS) { const fr = forwardRange(c, i, h); if (fr === null) { ok = false; break; } x[h] = fr / (r.atrPct / 100); }
      if (ok) obs.push({ sym, i, n: c.length, vol: r.volatility, atrPct: r.atrPct, x });
    }
    console.error(`${sym}: ${c.length} candles`);
  }
  // time-split per symbol: first 60% train, last 40% test
  const train = obs.filter((o) => o.i < o.n * 0.6), test = obs.filter((o) => o.i >= o.n * 0.6);
  console.log(`\n${tf}, symbols ${SYMBOLS.join("/")}: ${train.length} train obs, ${test.length} test obs (time-split 60/40 per symbol)`);
  console.log(`x = forward range over next h bars divided by current ATR%. A forecast is q-quantile(x | label) * ATR%.\n`);

  // Quantiles over ALL observations (train + test): these are the numbers the shipped table is built from (averaged across timeframes).
  console.log(`ALL-DATA quantiles of x (n=${obs.length}): ` + HS.map((h) => { const a = obs.map((o) => o.x[h]).sort((p, q) => p - q); return `h${h}[${QS.map((q) => quantile(a, q).toFixed(3)).join(", ")}]`; }).join("  "));
  const labels = ["SQUEEZE", "LOW", "NORMAL", "HIGH", "EXTREME"];
  for (const h of HS) {
    const all = train.map((o) => o.x[h]).sort((a, b) => a - b);
    console.log(`--- horizon h=${h} bars`);
    console.log(`train quantiles of x   ${"label".padEnd(9)} ${"n".padStart(6)}  ${QS.map((q) => `p${q * 100}`.padStart(6)).join(" ")}`);
    console.log(`                       ${"(all)".padEnd(9)} ${String(all.length).padStart(6)}  ${QS.map((q) => quantile(all, q).toFixed(2).padStart(6)).join(" ")}`);
    const byLabel = new Map<string, number[]>();
    for (const l of labels) byLabel.set(l, train.filter((o) => o.vol === l).map((o) => o.x[h]).sort((a, b) => a - b));
    for (const l of labels) { const xs = byLabel.get(l)!; console.log(`                       ${l.padEnd(9)} ${String(xs.length).padStart(6)}  ${QS.map((q) => quantile(xs, q).toFixed(2).padStart(6)).join(" ")}`); }
    console.log(`TEST (out of sample):  coverage = share of actual ranges at or below the forecast (target = q);  pinball loss, lower is better`);
    console.log(`  ${"q".padEnd(5)} ${"cov ATR-only".padStart(13)} ${"cov +regime".padStart(12)} ${"loss ATR-only".padStart(14)} ${"loss +regime".padStart(13)} ${"improve".padStart(8)}`);
    for (const q of QS) {
      const kAll = quantile(all, q);
      let covA = 0, covB = 0, lossA = 0, lossB = 0;
      for (const o of test) {
        const kB = quantile(byLabel.get(o.vol)!, q);
        const y = o.x[h];
        if (y <= kAll) covA++;
        if (y <= kB) covB++;
        lossA += pinball(kAll, y, q); lossB += pinball(kB, y, q);
      }
      const n = test.length;
      console.log(`  ${String(q).padEnd(5)} ${(covA / n).toFixed(3).padStart(13)} ${(covB / n).toFixed(3).padStart(12)} ${(lossA / n).toFixed(4).padStart(14)} ${(lossB / n).toFixed(4).padStart(13)} ${(((lossA - lossB) / lossA) * 100).toFixed(1).padStart(7)}%`);
    }
    console.log();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
