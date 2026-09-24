/**
 * Pump-continuation read for one perp: 12 order-flow / positioning factors, a score, and a commentary diff
 * between two readings. Pure functions — pumpwatchFeed.ts does the fetching. Descriptive only: a high score
 * means the ingredients for another leg are present right now, not that one will happen.
 */

/** One 1m candle with the taker-buy split Binance klines carry. */
export interface FlowCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  baseVolume: number;
  quoteVolume: number;
  takerBuyBase: number;
}

export interface PumpInputs {
  perp: FlowCandle[]; // 1m, oldest first, ~180 bars
  spot: FlowCandle[] | null; // 1m, last ~15 bars; null when the coin has no spot market
  oiHist5m: number[]; // open interest (contracts), 5m buckets, oldest first, 13 points = 1h
  fundingPct: number; // last funding rate, % per 8h
  basisPct: number; // (mark - index) / index, %
  retailLongShort: [number, number]; // account ratio 30m ago -> now
  topLongShort: [number, number]; // top-trader position ratio 30m ago -> now
  bids1pctUsd: number; // resting bid notional within 1% below price
  asks1pctUsd: number; // resting ask notional within 1% above price
  shortLiqs5mUsd: number;
  longLiqs5mUsd: number;
}

export type Regime = "new_longs" | "short_covering" | "shorts_piling" | "longs_exiting" | "mixed";

export const REGIME_LABEL: Record<Regime, string> = {
  new_longs: "price up, OI up: aggressive buyers opening positions",
  short_covering: "price up, OI down: short covering, can fade once shorts are out",
  shorts_piling: "price down, OI up: shorts piling in, squeeze fuel if support holds",
  longs_exiting: "price down, OI down: longs exiting, pump unwinding",
  mixed: "flat / mixed",
};

export interface Factor {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PumpReading {
  price: number;
  legLow: number;
  legHigh: number;
  vwap: number;
  pullbackPct: number; // % of the pump leg given back
  priceChange15mPct: number;
  volumeRatio: number; // last-5m avg vs prior-30m avg quote volume
  takerBuy5mPct: number;
  cvd15mUsd: number;
  lastLow5m: number;
  prevLow5m: number;
  oiChange15mPct: number;
  oiChange1hPct: number;
  openInterest: number;
  bookImbalance: number; // bids / asks within 1%
  retailLongShort: number;
  fundingPct: number;
  regime: Regime;
  factors: Factor[];
  score: number;
  warnings: string[];
}

const pct = (a: number, b: number) => (b ? (a / b - 1) * 100 : 0);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const fmtK = (usd: number) => `${usd >= 0 ? "+" : "-"}${Math.round(Math.abs(usd) / 1000).toLocaleString("en-US")}k`;

export function classifyFlowRegime(priceChangePct: number, oiChangePct: number): Regime {
  if (priceChangePct > 0.3 && oiChangePct > 0.5) return "new_longs";
  if (priceChangePct > 0.3 && oiChangePct < -0.5) return "short_covering";
  if (priceChangePct < -0.3 && oiChangePct > 0.5) return "shorts_piling";
  if (priceChangePct < -0.3 && oiChangePct < -0.5) return "longs_exiting";
  return "mixed";
}

export function readPump(inp: PumpInputs): PumpReading {
  const k = inp.perp;
  if (k.length < 40) throw new Error("need at least 40 one-minute candles");
  const price = k[k.length - 1].close;

  // Pump leg = highest high in the window and the lowest low before it.
  let hiI = 0;
  for (let i = 1; i < k.length; i++) if (k[i].high > k[hiI].high) hiI = i;
  let loI = 0;
  for (let i = 1; i <= hiI; i++) if (k[i].low < k[loI].low) loI = i;
  const legHigh = k[hiI].high;
  const legLow = k[loI].low;
  const leg = legHigh - legLow;
  const pullbackPct = leg > 0 ? ((legHigh - price) / leg) * 100 : 0;

  const legBars = k.slice(loI);
  const vwap =
    sum(legBars.map((b) => ((b.high + b.low + b.close) / 3) * b.baseVolume)) /
    Math.max(sum(legBars.map((b) => b.baseVolume)), 1e-12);

  const last5 = k.slice(-5);
  const last15 = k.slice(-15);
  const takerBuy5mPct =
    (sum(last5.map((b) => b.takerBuyBase)) / Math.max(sum(last5.map((b) => b.baseVolume)), 1e-12)) * 100;
  const cvd15mUsd = sum(last15.map((b) => (2 * b.takerBuyBase - b.baseVolume) * b.close));
  const upVol = sum(last15.filter((b) => b.close >= b.open).map((b) => b.quoteVolume));
  const downVol = sum(last15.filter((b) => b.close < b.open).map((b) => b.quoteVolume));
  const volumeRatio =
    sum(last5.map((b) => b.quoteVolume)) / 5 / Math.max(sum(k.slice(-35, -5).map((b) => b.quoteVolume)) / 30, 1e-12);
  const lows5 = [15, 10, 5].map((n) => Math.min(...k.slice(k.length - n, k.length - n + 5).map((b) => b.low)));
  const higherLows = lows5[0] < lows5[1] && lows5[1] < lows5[2];

  const oi = inp.oiHist5m;
  const openInterest = oi[oi.length - 1];
  const oiChange15mPct = pct(openInterest, oi[Math.max(oi.length - 4, 0)]);
  const oiChange1hPct = pct(openInterest, oi[0]);
  const priceChange15mPct = pct(price, k[k.length - 16].close);
  const bookImbalance = inp.bids1pctUsd / Math.max(inp.asks1pctUsd, 1e-12);
  const [lsThen, lsNow] = inp.retailLongShort;

  let spotTakerPct: number | null = null;
  let spotSharePct = 0;
  if (inp.spot?.length) {
    const s5 = inp.spot.slice(-5);
    spotTakerPct = (sum(s5.map((b) => b.takerBuyBase)) / Math.max(sum(s5.map((b) => b.baseVolume)), 1e-12)) * 100;
    const spotVol = sum(inp.spot.map((b) => b.quoteVolume));
    spotSharePct = (spotVol / Math.max(spotVol + sum(last15.map((b) => b.quoteVolume)), 1e-12)) * 100;
  }

  const factors: Factor[] = [
    { name: "Price above pump VWAP", ok: price > vwap, detail: `price ${price} vs VWAP ${vwap.toPrecision(6)}` },
    {
      name: "Shallow pullback (<38% of leg)",
      ok: pullbackPct < 38,
      detail: `${pullbackPct.toFixed(0)}% of leg retraced`,
    },
    { name: "Higher lows (5m)", ok: higherLows, detail: lows5.map((x) => x.toPrecision(6)).join(" < ") },
    { name: "Aggressive buying (taker buy >55%, 5m)", ok: takerBuy5mPct > 55, detail: `${takerBuy5mPct.toFixed(0)}%` },
    { name: "CVD 15m positive", ok: cvd15mUsd > 0, detail: `${fmtK(cvd15mUsd)} USDT` },
    {
      name: "Up-candle volume > down-candle volume (15m)",
      ok: upVol > downVol,
      detail: `${fmtK(upVol)} vs ${fmtK(downVol)}`,
    },
    {
      name: "OI rising (15m)",
      ok: oiChange15mPct > 0.5,
      detail: `${oiChange15mPct.toFixed(1)}% (1h ${oiChange1hPct.toFixed(1)}%)`,
    },
    {
      name: "Retail crowding short (account L/S falling)",
      ok: lsNow < lsThen * 0.97,
      detail: `${lsThen.toFixed(2)} -> ${lsNow.toFixed(2)}`,
    },
    {
      name: "Funding not overheated (<=0.03%)",
      ok: inp.fundingPct <= 0.03,
      detail: `${inp.fundingPct.toFixed(4)}% / 8h, basis ${inp.basisPct.toFixed(3)}%`,
    },
    { name: "Bid wall > ask wall (±1%)", ok: bookImbalance > 1.2, detail: `${bookImbalance.toFixed(2)}x` },
    {
      name: "Shorts getting liquidated (5m)",
      ok: inp.shortLiqs5mUsd > 0,
      detail: `shorts $${Math.round(inp.shortLiqs5mUsd)} / longs $${Math.round(inp.longLiqs5mUsd)}`,
    },
    {
      name: "Spot buyers active (spot taker >52%)",
      ok: spotTakerPct !== null && spotTakerPct > 52,
      detail:
        spotTakerPct === null
          ? "no spot market"
          : `${spotTakerPct.toFixed(0)}%, spot ${spotSharePct.toFixed(0)}% of volume`,
    },
  ];

  const warnings: string[] = [];
  if (inp.fundingPct > 0.05) warnings.push("Funding hot: longs crowded, pullback risk");
  if (inp.topLongShort[1] > inp.topLongShort[0] * 1.05 && priceChange15mPct < 0)
    warnings.push("Top traders adding longs while price drops");
  if (volumeRatio < 0.5) warnings.push("Volume dried up (<0.5x the last 30m): momentum fading");
  if (pullbackPct > 61) warnings.push("Pullback >61%: leg likely broken");
  if (price < vwap && oiChange15mPct < 0) warnings.push("Below VWAP with OI falling: distribution");

  return {
    price,
    legLow,
    legHigh,
    vwap,
    pullbackPct,
    priceChange15mPct,
    volumeRatio,
    takerBuy5mPct,
    cvd15mUsd,
    lastLow5m: lows5[2],
    prevLow5m: lows5[1],
    oiChange15mPct,
    oiChange1hPct,
    openInterest,
    bookImbalance,
    retailLongShort: lsNow,
    fundingPct: inp.fundingPct,
    regime: classifyFlowRegime(priceChange15mPct, oiChange15mPct),
    factors,
    score: factors.filter((f) => f.ok).length,
    warnings,
  };
}

/** Mutable state commentary carries across readings (VWAP side with hysteresis, OI reference). */
export interface CommentaryState {
  vwapSide?: "above" | "below";
  oiRef?: number;
}

/** 0.15% band around VWAP so chop on the line doesn't flip the side every tick. */
const VWAP_BAND = 0.0015;

/** Event lines for what changed between two readings. `prev` null = opening line. */
export function commentate(prev: PumpReading | null, cur: PumpReading, state: CommentaryState): string[] {
  const out: string[] = [];
  const px = cur.price;
  const side = px > cur.vwap * (1 + VWAP_BAND) ? "above" : px < cur.vwap * (1 - VWAP_BAND) ? "below" : state.vwapSide;
  const crossed = prev !== null && state.vwapSide !== undefined && side !== state.vwapSide;
  state.vwapSide = side;
  state.oiRef ??= cur.openInterest;

  if (!prev) {
    out.push(
      `Watching: price ${px}, VWAP ${cur.vwap.toPrecision(6)}, leg ${cur.legLow} -> ${cur.legHigh}, score ${cur.score}/12`,
    );
    out.push(`OI/price: ${REGIME_LABEL[cur.regime]}`);
    return out;
  }

  if (crossed) {
    out.push(
      side === "below"
        ? `Lost VWAP (${cur.vwap.toPrecision(6)}), price ${px}. Pump structure weakening.`
        : `Reclaimed VWAP (${cur.vwap.toPrecision(6)}), price ${px}. Buyers back in control.`,
    );
  }
  if (cur.legHigh > prev.legHigh) out.push(`New leg high ${cur.legHigh}: breakout continuing.`);
  if (px < prev.lastLow5m && prev.price >= prev.lastLow5m)
    out.push(`Broke the last 5m low ${prev.lastLow5m}: lower low printing.`);
  for (const lvl of [38, 61]) {
    if (prev.pullbackPct < lvl && cur.pullbackPct >= lvl)
      out.push(`Pullback passed ${lvl}% of the leg${lvl === 61 ? ": leg likely broken" : ""}.`);
    else if (prev.pullbackPct >= lvl && cur.pullbackPct < lvl) out.push(`Recovered above the ${lvl}% pullback line.`);
  }
  if (prev.cvd15mUsd > 0 !== cur.cvd15mUsd > 0)
    out.push(`${cur.cvd15mUsd > 0 ? "Buyers" : "Sellers"} took over order flow (15m CVD ${fmtK(cur.cvd15mUsd)} USDT).`);
  if (cur.takerBuy5mPct > 60 && prev.takerBuy5mPct <= 60)
    out.push(`Aggressive buying burst: taker buy ${cur.takerBuy5mPct.toFixed(0)}% last 5m.`);
  else if (cur.takerBuy5mPct < 40 && prev.takerBuy5mPct >= 40)
    out.push(`Aggressive selling burst: taker buy only ${cur.takerBuy5mPct.toFixed(0)}% last 5m.`);
  if (cur.regime !== prev.regime) out.push(`OI/price shift: ${REGIME_LABEL[cur.regime]}`);
  const oiMove = pct(cur.openInterest, state.oiRef);
  if (Math.abs(oiMove) >= 1.5) {
    out.push(
      `OI ${oiMove > 0 ? "jumped" : "dropped"} ${oiMove.toFixed(1)}% (positions ${oiMove > 0 ? "opening" : "closing"}) at ${px}.`,
    );
    state.oiRef = cur.openInterest;
  }
  const book = (x: number) => (x > 1.2 ? "bids heavier" : x < 0.8 ? "asks heavier" : "balanced");
  if (book(cur.bookImbalance) !== book(prev.bookImbalance))
    out.push(`Order book ±1% now ${book(cur.bookImbalance)} (${cur.bookImbalance.toFixed(2)}x).`);
  if (cur.volumeRatio >= 2 && prev.volumeRatio < 2)
    out.push(`Volume spike: ${cur.volumeRatio.toFixed(1)}x the 30m average.`);
  else if (cur.volumeRatio < 0.5 && prev.volumeRatio >= 0.5)
    out.push(`Volume drying up (${cur.volumeRatio.toFixed(1)}x): move losing steam.`);
  if (Math.abs(cur.retailLongShort - prev.retailLongShort) >= 0.05)
    out.push(
      `Retail L/S ${prev.retailLongShort.toFixed(2)} -> ${cur.retailLongShort.toFixed(2)} (${
        cur.retailLongShort < prev.retailLongShort ? "more shorts piling in: squeeze fuel" : "longs adding"
      }).`,
    );
  if (Math.abs(cur.score - prev.score) >= 2) out.push(`Continuation score ${prev.score} -> ${cur.score}/12`);
  return out;
}

/** One-line status used as a periodic heartbeat. */
export function statusLine(r: PumpReading): string {
  return (
    `${r.price} (${r.priceChange15mPct >= 0 ? "+" : ""}${r.priceChange15mPct.toFixed(2)}% 15m), ` +
    `${r.price > r.vwap ? "above" : "below"} VWAP, pullback ${r.pullbackPct.toFixed(0)}%, taker ${r.takerBuy5mPct.toFixed(0)}%, ` +
    `CVD ${fmtK(r.cvd15mUsd)}, OI 15m ${r.oiChange15mPct.toFixed(1)}%, funding ${r.fundingPct.toFixed(3)}%, score ${r.score}/12`
  );
}
