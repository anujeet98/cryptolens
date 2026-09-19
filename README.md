# CryptoLens

Real-time crypto market intelligence dashboard: live price, technicals, derivatives, order book, liquidations
and an explainable market-state assessment. Public exchange data only, no API keys required.

**Status:** Phase 10 — history recorder (SQLite): per-minute taker flow, liquidations, derivatives and book depth captured live, with coverage reporting. On top of chart, indicators, volume, momentum, funding, OI, order book, trade flow, liquidations, cross-exchange and regime.

Roadmap: indicators → volume/momentum → funding/OI → order book → trade flow → liquidations →
cross-exchange → regime → prediction/scenarios → storage → backtesting → alerts.

Not financial advice. Outputs are model estimates, never guarantees.

## Run
```bash
npm install
npm run dev   # http://localhost:3000
```

## Structure
- `src/exchanges/<name>` — modular connectors behind `ExchangeConnector` (Binance, Bybit, Bitget)
- `src/app/api/*` — normalized REST API routes (symbols, candles, ticker)
- `src/hooks/useLiveMarket.ts` — REST history + WebSocket stream with auto-reconnect
- `src/indicators` — pure, unit-tested indicator math (`npm test`)
- `src/analysis/technicals.ts` — turns candles into a structured technicals snapshot
- `src/tradeflow` — rolling taker-flow engine (per-second buckets, CVD, large prints), unit-tested
- `src/liquidations` — rolling liquidation store (long/short windows, burst detection, market-wide top), unit-tested
- `src/exchanges/bybit` — Bybit v5 connector (spot + linear perp, no API key)
- `src/exchanges/bitget` — Bitget v2 connector (spot + USDT-margined perp, no API key; no OI history endpoint)
- `src/crossexchange` — pure venue comparison (funding normalised to 8h, basis vs reference, OI/volume share), unit-tested
- `src/storage` — SQLite recorder core (minute aggregator, schema/migrations, queries, coverage), unit-tested
- `scripts/record.ts` — the recorder process (`npm run record`)
- `src/regime` — rule-based regime classifier (ADX-gated trend vs range, weighted directional vote, volatility percentile, stall detection), unit-tested
- `src/types` — common schema

## Notes on exchanges
- **OKX is not included.** `okx.com` is unreachable from the development network (India): the host resolves to an ISP address and connections time out. The connector interface is exchange-agnostic, so OKX can be added from a network that reaches it.
- Cross-exchange data is matched by base asset name. Coins listed under different names (e.g. `1000PEPE` vs `PEPE`) are not paired.

## Recording history
Trade flow and liquidations have no REST backfill: once a minute has passed, it can never be fetched again. The recorder captures them live so later phases (backtesting) have real history.

```bash
npm run record                       # BTCUSDT + ETHUSDT (Binance perp)
npm run record -- SOLUSDT XRPUSDT    # choose symbols
npm run record:status                # how much history exists and how trustworthy it is
```
Needs Node 22+ (uses the built-in `node:sqlite`; no native dependency). Data goes to `data/cryptolens.db` (gitignored; override with `DB_PATH`). Retention: 180 days of minutes, 90 days of liquidations.

- One row per symbol per minute; `ts` is the minute **start**, like a candle time. Flow and OHLC come from `aggTrade` bucketed by exchange time. Mark, index, funding, OI and depth are REST samples taken ~1s after the minute closes, so only the most recent minute of a tick carries them.
- Liquidations are stored raw and market-wide (Binance sends at most one per symbol per second, so totals are lower bounds).
- **Gaps are recorded, never filled.** A minute overlapping a stream outage (or the first, partial minute of a run) is flagged as partial; a failed REST sample is flagged and left NULL. `record:status` reports missing minutes, gaps and clean vs flagged rows. A backtest should check this before trusting a window.
- `buy_n`/`sell_n` count aggregated trade prints, not raw fills, so they run lower than the exchange's candle trade count. Volumes match exactly.
- The recorder only records while it is running (it stops when the machine sleeps). Run it under `caffeinate -i npm run record` or on an always-on machine for continuous history.
