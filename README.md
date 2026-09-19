# CryptoLens

Real-time crypto market intelligence dashboard: live price, technicals, derivatives, order book, liquidations
and an explainable market-state assessment. Public exchange data only, no API keys required.

**Status:** Phase 11 — backtesting: walk-forward evaluation of the dashboard's own signals, with findings. On top of chart, indicators, volume, momentum, funding, OI, order book, trade flow, liquidations, cross-exchange, regime and the history recorder.

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
- `src/backtest` — walk-forward signal study and strategy simulator (pure, unit-tested)
- `scripts/backtest.ts` — `npm run backtest`
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

## Backtesting
```bash
npm run backtest -- BTCUSDT 1h                    # last 2 years of Binance perp candles
npm run backtest -- ETHUSDT 4h 2024-01-01 2026-01-01
```
- **No lookahead.** A signal is handed only the candles up to bar *i* and trades at the **next bar's open**. A test asserts the signal never sees a later bar.
- **Honest statistics.** Forward windows overlap, so the effective sample size is n / horizon and the t-stat uses that; labels with fewer than 30 effective samples are marked `(thin)`. Labels are persistent, so even this t-stat is generous: trust the ordering and magnitudes more than the exact t.
- **No tuning.** Signals use the dashboard's live thresholds untouched; there is no parameter search, so nothing is fitted to the past.
- **Two lenses.** Signed forward return (does a label predict *direction*?) and forward high-low range (does it predict *how much* price moves?). Strategies use 5 bps per side (4 fee + 1 slippage), are unlevered, ignore funding, and are reported for the full period and each half.

**Findings (Sept 2024 – Sept 2026, BTC/ETH/SOL 1h and BTC 4h):**
- The **trend, momentum and EMA-alignment labels carry no significant directional information**: across all datasets, no label reached |t| >= 3 on signed forward returns.
- Simple long/short/flat rules built on them **lose money after costs** and trail buy & hold (over-trading; momentum-follow flips thousands of times).
- The **volatility label works at what it claims**: forward range rises monotonically SQUEEZE < LOW < NORMAL < HIGH < EXTREME on every dataset.
- **A squeeze does not imply a breakout**: ranges after a squeeze were below average everywhere. The regime notes were corrected accordingly.
- Descriptive panels remain useful for context and risk sizing. Directional prediction from these inputs is not supported by the evidence, which matters for the roadmap.
