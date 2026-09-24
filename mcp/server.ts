#!/usr/bin/env -S npx tsx
/**
 * CryptoLens MCP server: exposes the same live regime/volatility scan CryptoLens shows in the browser,
 * as tools an MCP client (e.g. Claude) can call on demand. Pull-based, computed live at call time —
 * no background jobs, no stored positions, no trade execution. Decision support only: every tool result
 * carries the same "not a forecast" caveats the web app shows, and callers must not present output as
 * financial advice or place trades on the user's behalf.
 *
 * Run directly:   npx tsx mcp/server.ts
 * Register with Claude Code:   claude mcp add cryptolens -- npx tsx <repo>/mcp/server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { binance } from "@/exchanges/binance";
import { classifyRegime, type Regime } from "@/regime/regime";
import { scanMarket, scanSymbol, type ScanResult } from "@/scan/scanMarket";
import { classifyStage, STAGE_LABEL } from "@/scan/stage";
import { detectRetest } from "@/scan/retest";
import { evaluateRetestFollowup, evaluateScanPickFollowup, type RetestSnapshot, type ScanPickSnapshot } from "@/scan/followup";
import { listTrackedSignals, openTrackerDb, trackSignal } from "@/scan/trackStore";
import {
  commentate,
  readPump,
  REGIME_LABEL,
  statusLine,
  type CommentaryState,
  type PumpReading,
} from "@/scan/pumpwatch";
import { fetchPumpInputs, openLiquidationStream } from "@/scan/pumpwatchFeed";
import type { Timeframe } from "@/types/market";

const CAVEAT =
  "Not a forecast or financial advice. Backtests found the volatility label predicts range size; " +
  "trend/momentum labels showed no significant directional edge. Present this as data to weigh, never as a trade instruction.";

const STAGE_NOTE =
  "stage separates 'about to move' from 'already moved': igniting = range widening right now, not yet extreme " +
  "(the best fit for a short hold); coiled = compressed, energy exists but timing/direction unconfirmed; " +
  "extended = already at a volatility extreme and no longer widening, the move likely already happened; " +
  "exhausted = stalled or cooling off a high-vol state, real reversal risk. Results are ranked igniting > coiled " +
  "> extended > exhausted, then by volatility. Chasing an 'extended' or 'exhausted' coin is the late-entry mistake " +
  "this ranking is designed to avoid.";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
const timeframeSchema = z.enum(TIMEFRAMES).default("15m");

function summarizeRegime(r: Regime) {
  return {
    trend: r.trend,
    volatility: r.volatility,
    volTrend: r.volTrend,
    trendScore: r.trendScore,
    confidence: r.confidence,
    adx: round(r.adx),
    plusDI: round(r.plusDI),
    minusDI: round(r.minusDI),
    efficiency: round(r.efficiency * 100),
    atrPct: round(r.atrPct, 3),
    atrPercentile: round(r.atrPercentile),
    notes: r.notes,
  };
}

function summarizeResult(r: ScanResult) {
  return {
    symbol: r.symbol,
    price: r.price,
    changePct24h: round(r.changePct24h, 2),
    quoteVolume24h: Math.round(r.quoteVolume24h),
    stage: r.stage,
    stageDescription: STAGE_LABEL[r.stage],
    ...summarizeRegime(r.regime),
  };
}

function round(n: number, digits = 1) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const RETEST_NOTE =
  "No signal combination proves a retest will hold — fakeouts happen regardless of how many indicators agree. " +
  "'confirmed' here means: the rejection candle (mandatory) plus at least 2 of 4 independent checks (volume, " +
  "momentum, stage, RSI failure swing) agree with the bounce direction. Fewer than 2 does not mean 'avoid' — it " +
  "means less evidence, not none. Always show the individual signals, never collapse this into a single 'safe' verdict.";

const server = new McpServer({ name: "cryptolens", version: "0.1.0" });

server.registerTool(
  "scan_top_picks",
  {
    title: "Scan top picks",
    description:
      "Scans the most liquid Binance USDT perpetuals live and ranks them by stage first (igniting/coiled before " +
      "extended/exhausted — see the 'stage' field), then by ATR percentile and directional conviction. Aims to " +
      "surface coins about to move, not ones that already moved. Returns raw regime data for the caller to " +
      "interpret and present to the trader — never a buy/sell instruction.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(25).describe("How many ranked results to return"),
      timeframe: timeframeSchema.describe("Candle timeframe to classify on"),
      candidatePool: z
        .number()
        .int()
        .min(10)
        .max(200)
        .default(80)
        .describe("How many of the most liquid perps to actually pull candles for before ranking"),
    },
  },
  async ({ limit, timeframe, candidatePool }) => {
    const results = await scanMarket({ timeframe: timeframe as Timeframe, limit, candidatePool });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { caveat: CAVEAT, stageNote: STAGE_NOTE, timeframe, count: results.length, results: results.map(summarizeResult) },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "get_coin_snapshot",
  {
    title: "Get coin snapshot",
    description:
      "Full live regime snapshot for one Binance USDT perp symbol (e.g. BTCUSDT), same data as the CryptoLens page. " +
      "Use after scan_top_picks to drill into a specific candidate before describing it to the trader.",
    inputSchema: {
      symbol: z.string().min(3).max(20).describe("Binance perp symbol, e.g. BTCUSDT"),
      timeframe: timeframeSchema.describe("Candle timeframe to classify on"),
    },
  },
  async ({ symbol, timeframe }) => {
    const sym = symbol.toUpperCase();
    const regime = await scanSymbol(sym, timeframe as Timeframe);
    if (!regime) {
      return {
        content: [{ type: "text", text: JSON.stringify({ caveat: CAVEAT, symbol: sym, error: "Not enough candle history yet, or invalid symbol." }) }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              caveat: CAVEAT,
              stageNote: STAGE_NOTE,
              symbol: sym,
              timeframe,
              stage: classifyStage(regime),
              stageDescription: STAGE_LABEL[classifyStage(regime)],
              ...summarizeRegime(regime),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "get_level_retest",
  {
    title: "Get support/resistance retest",
    description:
      "Checks one Binance USDT perp symbol for a recent support/resistance retest: price returning to an " +
      "established level (2+ prior swing touches) and rejecting off it with a close back on the right side. " +
      "Scores the rejection against 4 independent confirmation signals (volume, momentum, stage, RSI failure " +
      "swing). Returns null if no qualifying retest happened in the recent lookback window — that means 'nothing " +
      "to report', not 'safe to enter elsewhere'.",
    inputSchema: {
      symbol: z.string().min(3).max(20).describe("Binance perp symbol, e.g. BTCUSDT"),
      timeframe: timeframeSchema.describe("Candle timeframe for both level-building and the retest check"),
      lookbackBars: z.number().int().min(1).max(20).default(5).describe("How many recent closed candles to scan for a touch"),
      minTouches: z.number().int().min(1).max(10).default(2).describe("Minimum prior touches for a level to count as established"),
    },
  },
  async ({ symbol, timeframe, lookbackBars, minTouches }) => {
    const sym = symbol.toUpperCase();
    const tf = timeframe as Timeframe;
    const candles = await binance.getCandles(sym, "perp", tf, 200);
    const result = detectRetest(candles, tf, { lookbackBars, minTouches });
    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              caveat: CAVEAT,
              retestNote: RETEST_NOTE,
              symbol: sym,
              timeframe,
              result: null,
              note: "No qualifying retest of an established level in the recent lookback window.",
            }),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              caveat: CAVEAT,
              retestNote: RETEST_NOTE,
              symbol: sym,
              timeframe,
              level: { price: round(result.level.price, 6), type: result.level.type, touches: result.level.touches },
              direction: result.direction,
              barsAgo: result.barsAgo,
              touchPrice: round(result.touchPrice, 6),
              currentPrice: round(result.currentPrice, 6),
              confirmedSignalCount: result.confirmedSignalCount,
              confirmed: result.confirmed,
              signals: result.signals,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "track_signal",
  {
    title: "Track a signal for follow-up",
    description:
      "Logs a live snapshot of one symbol (its regime/stage, or its current retest state) to local storage so " +
      "check_followups can later report whether it held up. Only call this when the trader actually wants to " +
      "follow up on something specific — not automatically for every scan result.",
    inputSchema: {
      symbol: z.string().min(3).max(20).describe("Binance perp symbol, e.g. BTCUSDT"),
      timeframe: timeframeSchema.describe("Candle timeframe to snapshot on"),
      kind: z.enum(["scan_pick", "retest"]).describe("What to snapshot: general regime/stage, or the current retest state"),
      note: z.string().max(200).optional().describe("Optional free-text reason for tracking this"),
    },
  },
  async ({ symbol, timeframe, kind, note }) => {
    const sym = symbol.toUpperCase();
    const tf = timeframe as Timeframe;
    const db = openTrackerDb();
    try {
      if (kind === "scan_pick") {
        const candles = await binance.getCandles(sym, "perp", tf, 150);
        const regime = classifyRegime(candles, tf);
        if (!regime || !candles.length) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Not enough candle history to snapshot." }) }], isError: true };
        }
        const price = candles[candles.length - 1].close;
        const snapshot: ScanPickSnapshot = {
          kind: "scan_pick",
          price,
          stage: classifyStage(regime),
          trend: regime.trend,
          volatility: regime.volatility,
          atrPercentile: round(regime.atrPercentile),
        };
        const id = trackSignal(db, { symbol: sym, timeframe, kind, note, snapshot });
        return { content: [{ type: "text", text: JSON.stringify({ trackId: id, symbol: sym, timeframe, snapshot }, null, 2) }] };
      }

      const candles = await binance.getCandles(sym, "perp", tf, 200);
      const result = detectRetest(candles, tf);
      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "No current retest on this symbol/timeframe to track." }) }],
          isError: true,
        };
      }
      const snapshot: RetestSnapshot = {
        kind: "retest",
        price: result.currentPrice,
        level: { price: result.level.price, type: result.level.type, touches: result.level.touches },
        direction: result.direction,
        confirmed: result.confirmed,
        confirmedSignalCount: result.confirmedSignalCount,
      };
      const id = trackSignal(db, { symbol: sym, timeframe, kind, note, snapshot });
      return { content: [{ type: "text", text: JSON.stringify({ trackId: id, symbol: sym, timeframe, snapshot }, null, 2) }] };
    } finally {
      db.close();
    }
  },
);

server.registerTool(
  "check_followups",
  {
    title: "Check tracked signals",
    description:
      "Re-fetches live data for signals previously logged with track_signal and reports whether each one held, " +
      "was invalidated (the fakeout case), or is still pending — never a single collapsed verdict, always the " +
      "price move and specifics.",
    inputSchema: {
      symbol: z.string().min(3).max(20).optional().describe("Filter to one symbol; omit to check all tracked signals"),
      sinceHours: z.number().min(0.1).max(24 * 30).default(24).describe("Only check signals logged within this many hours"),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  async ({ symbol, sinceHours, limit }) => {
    const db = openTrackerDb();
    let tracked;
    try {
      tracked = listTrackedSignals(db, {
        symbol: symbol?.toUpperCase(),
        sinceMs: Date.now() - sinceHours * 3_600_000,
        limit,
      });
    } finally {
      db.close();
    }

    const results = await Promise.all(
      tracked.map(async (t) => {
        try {
          const candles = await binance.getCandles(t.symbol, "perp", t.timeframe as Timeframe, 150);
          if (!candles.length) return { ...base(t), error: "No live data available." };
          const currentPrice = candles[candles.length - 1].close;

          if (t.kind === "scan_pick") {
            const regime = classifyRegime(candles, t.timeframe as Timeframe);
            const currentStage = regime ? classifyStage(regime) : null;
            if (!currentStage) return { ...base(t), error: "Not enough live history to re-evaluate." };
            const fu = evaluateScanPickFollowup(t.snapshot as ScanPickSnapshot, currentPrice, currentStage);
            return { ...base(t), currentPrice: round(currentPrice, 6), ...fu };
          }

          const fu = evaluateRetestFollowup(t.snapshot as RetestSnapshot, currentPrice);
          return { ...base(t), currentPrice: round(currentPrice, 6), ...fu };
        } catch {
          return { ...base(t), error: "Live re-fetch failed." };
        }
      }),
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { caveat: CAVEAT, count: results.length, results },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const PUMP_NOTE =
  "score counts how many of 12 continuation ingredients are present right now (>=8 strong, 5-7 mixed, <=4 weak). " +
  "It describes current order flow and positioning, not what happens next. Thin coins flip factors within seconds " +
  "(especially the order book): weigh the regime, VWAP side and OI direction over single flips. Data is Binance; " +
  "CoinDCX B- perps track it, but the trader's own CoinDCX orders are not visible in it.";

const symbolSchema = z.string().min(2).max(20).describe("Coin or Binance perp symbol, e.g. XAI or XAIUSDT");
const toPerp = (s: string) => s.toUpperCase().replace(/USDT$/, "") + "USDT";

server.registerTool(
  "get_pump_factors",
  {
    title: "Get pump-continuation factors",
    description:
      "Live 12-factor read on whether a pumping perp has the ingredients for another leg: VWAP of the pump, pullback " +
      "depth, higher lows, taker buy %, 15m CVD, up/down volume, OI trend, retail long/short, funding/basis, book " +
      "imbalance, short liquidations, spot buying. Also returns the OI/price regime (new longs / short covering / " +
      "shorts piling / longs exiting) and warnings. Use when the trader asks 'will it pump again / is it unwinding'.",
    inputSchema: { symbol: symbolSchema },
  },
  async ({ symbol }) => {
    const sym = toPerp(symbol);
    const r = readPump(await fetchPumpInputs(sym));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { caveat: CAVEAT, pumpNote: PUMP_NOTE, symbol: sym, regimeLabel: REGIME_LABEL[r.regime], ...r },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "watch_commentary",
  {
    title: "Watch a coin with live commentary",
    description:
      "Watches one perp live for a short window and returns timestamped play-by-play lines: VWAP lost/reclaimed, new " +
      "leg highs, broken 5m lows, pullback thresholds, buyer/seller takeover, OI/price regime shifts, OI jumps, book " +
      "flips, volume spikes, retail L/S shifts, score swings, and every liquidation >= $500 as it happens, plus a " +
      "status line every 30s. Blocks for durationSec, so keep it short and call again to keep watching.",
    inputSchema: {
      symbol: symbolSchema,
      durationSec: z.number().int().min(10).max(240).default(60).describe("How long to watch before returning"),
      intervalSec: z.number().int().min(3).max(30).default(5).describe("Seconds between readings"),
    },
  },
  async ({ symbol, durationSec, intervalSec }) => {
    const sym = toPerp(symbol);
    const lines: string[] = [];
    const say = (msg: string) => lines.push(`${new Date().toLocaleTimeString("en-GB", { hour12: false })}  ${msg}`);
    const stream = openLiquidationStream(sym, (l) => {
      if (l.usd >= 500) say(`${l.side === "short" ? "SHORTS" : "LONGS"} liquidated $${Math.round(l.usd)} at ${l.price}`);
    });
    const state: CommentaryState = {};
    let prev: PumpReading | null = null;
    let lastBeat = Date.now();
    const end = Date.now() + durationSec * 1000;
    try {
      while (true) {
        try {
          const cur = readPump(await fetchPumpInputs(sym, stream.liqs));
          for (const line of commentate(prev, cur, state)) say(line);
          if (Date.now() - lastBeat >= 30_000) {
            say(`status: ${statusLine(cur)}`);
            lastBeat = Date.now();
          }
          prev = cur;
        } catch (e) {
          say(`fetch error: ${(e as Error).message}`);
        }
        if (Date.now() + intervalSec * 1000 > end) break;
        await new Promise((r) => setTimeout(r, intervalSec * 1000));
      }
    } finally {
      stream.stop();
    }
    if (prev) say(`final: ${statusLine(prev)}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              caveat: CAVEAT,
              pumpNote: PUMP_NOTE,
              symbol: sym,
              watchedSec: durationSec,
              regimeLabel: prev ? REGIME_LABEL[prev.regime] : null,
              score: prev?.score ?? null,
              commentary: lines,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

function base(t: { id: number; symbol: string; timeframe: string; kind: string; loggedAtMs: number; note: string | null }) {
  return {
    trackId: t.id,
    symbol: t.symbol,
    timeframe: t.timeframe,
    kind: t.kind,
    note: t.note,
    minutesAgo: round((Date.now() - t.loggedAtMs) / 60_000, 1),
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
