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
import { scanMarket, scanSymbol, type ScanResult } from "@/scan/scanMarket";
import type { Regime } from "@/regime/regime";
import type { Timeframe } from "@/types/market";

const CAVEAT =
  "Not a forecast or financial advice. Backtests found the volatility label predicts range size; " +
  "trend/momentum labels showed no significant directional edge. Present this as data to weigh, never as a trade instruction.";

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
    ...summarizeRegime(r.regime),
  };
}

function round(n: number, digits = 1) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const server = new McpServer({ name: "cryptolens", version: "0.1.0" });

server.registerTool(
  "scan_top_picks",
  {
    title: "Scan top picks",
    description:
      "Scans the most liquid Binance USDT perpetuals live and ranks them by how much they're worth looking at right " +
      "now (extreme/rising ATR percentile first, then directional conviction as a tiebreak). Returns raw regime data " +
      "for the caller to interpret and present to the trader — never a buy/sell instruction.",
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
          text: JSON.stringify({ caveat: CAVEAT, timeframe, count: results.length, results: results.map(summarizeResult) }, null, 2),
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
      content: [{ type: "text", text: JSON.stringify({ caveat: CAVEAT, symbol: sym, timeframe, ...summarizeRegime(regime) }, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
