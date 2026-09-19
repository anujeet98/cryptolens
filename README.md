# CryptoLens

Real-time crypto market intelligence dashboard: live price, technicals, derivatives, order book, liquidations
and an explainable market-state assessment. Public exchange data only, no API keys required.

**Status:** Live at https://cryptolens-silk.vercel.app with a CI/CD pipeline (see Deployment). Analytics phases 1-13 complete: chart, indicators, volume, momentum, funding, OI, order book, trade flow, liquidations, cross-exchange, regime, history recorder, backtesting, risk forecast, alerts.

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
- `src/alerts` — edge-triggered alert engine and context-checked snapshot builder, unit-tested
- `src/risk` — expected-range forecast table and helpers (calibrated by `npm run calibrate-risk`), unit-tested
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

## Expected range (risk forecast)
Phase 11 found the trend and momentum labels carry no directional information but that volatility is genuinely forecastable. So the dashboard forecasts **how far price tends to travel**, not which way.

- **Definition.** Range = highest high minus lowest low over the next *h* bars, relative to the entry open. Forecast = (multiple from a calibrated table) x current ATR%. Shown as median / 80th / 90th percentile over 4, 12 and 24 bars.
- **Calibration** (`npm run calibrate-risk -- 1h`): quantiles of forward-range / ATR% over ~2 years of BTC, ETH and SOL on 15m, 1h and 4h, averaged with equal weight across timeframes. The multiples were nearly identical across timeframes, so one table serves all.
- **Scored out of sample** (fit on the first 60% of each series, tested on the last 40%): the median, 80th and 90th percentile figures held 47-53%, 77-86% and 88-93% of the time across nine timeframe x horizon combinations. **The upper tail ran slightly short on 15m and 1h (about 88% for the 90th percentile)**, so it is "roughly 1 in 8 exceed", not a guarantee. The UI states this.
- **Regime conditioning was tried and rejected.** Per-volatility-regime multipliers gained little (about 0.5% pinball loss at 4 bars, up to 5% at 24 bars on 15m/1h) and got *worse* on 4h. Only the direction was consistent (low volatility tends to expand beyond current ATR, high volatility tends to settle back), so it appears as a qualitative hint and does not change the numbers.
- **Stops.** A stop farther from entry than the 90th percentile range would rarely have been hit by noise alone. This is a valid upper bound because a one-directional move cannot exceed the total range. The reverse (a stop inside the typical range *will* be hit) is not claimed.

## Alerts
An alerts panel under the risk forecast. Two kinds:

- **Signal alerts** for the coin and timeframe on screen: volatility turns EXTREME, an unusually large recent move (last 4 bars beyond the historical 90th percentile for that ATR), a liquidation burst, and funding extreme. Each carries an evidence tag: *backtested* (volatility, range), *descriptive* (liquidation burst) or *untested* (funding, off by default).
- **Price levels** ("rises above" / "falls below") for any coin. Levels for coins that are not on screen are checked by polling their price every 5 seconds. One-shot: removed when they fire.

Delivery: an in-page list with a "new" count (also in the tab title while the page is in the background), browser notifications if you allow them, and an optional beep.

**Design rules**
- **Edge-triggered.** An alert fires when a condition *turns* true, never because it was already true. The first observation in any context (page load, new coin, new timeframe) only primes the state.
- **Hysteresis.** After firing, the condition must stay false for 5 minutes before it can re-arm, and the same alert never repeats within 15 minutes, so a label flickering at a threshold does not spam.
- **Missing data is not "clear".** If an input is unavailable the rule keeps its state.
- **Stale data is refused.** After a coin or timeframe switch the market hook briefly still holds the previous coin's candles and price. Alert inputs are only used when tagged with the exact `symbol:market:tf` on screen (`src/alerts/snapshot.ts`), and liquidation data must be for the same symbol.

**Limits.** Alerts run in the page, so they only fire while it is open; browsers throttle timers in background tabs, so checks there can lag by up to about a minute. A background alerting service is not built. Alerts say nothing about direction: the backtests found no directional edge in these signals.

## Deployment
Live at **https://cryptolens-silk.vercel.app** (Vercel, region `bom1` / Mumbai, free Hobby plan).

**Why Mumbai.** Exchanges geo-block by IP: Binance answers HTTP 451 from US datacenters, and this app's API routes call the exchanges from the server. Region was chosen by testing, not assuming: from `bom1` Binance perp/spot, Bybit and Bitget are all reachable (`/api/health` reports it). The region is set in `vercel.json`.

### The pipeline (`.github/workflows/pipeline.yml`)
| Trigger | What runs |
|---|---|
| Pull request | **Verify** (typecheck, lint, tests, production build), then a **preview deployment** that is smoke-tested; the URL is commented on the PR |
| Push to `main` | **Verify**, then the deploy gate below |

**The production gate** (`scripts/deploy.sh production`): build, deploy **staged** (not live), smoke-test the staged URL, only then **promote**, then smoke-test the public URL and **roll back automatically** to the previous deployment if that fails. A failing smoke test leaves production untouched.

`scripts/smoke.sh` checks what breaks in real life: exchanges reachable from the deployed region, live ticker, candles (count, order, validity), market listing, cross-exchange data, derivatives, and that the page and the app's own security headers are served (not a Vercel placeholder page). It fails if any core check fails and only warns for known non-blocking issues.

Run the same things yourself:
```bash
BASE_URL=http://localhost:3000 scripts/smoke.sh                 # against any URL
DEPLOYMENT_URL=https://<deployment>.vercel.app scripts/smoke.sh  # a protected Vercel deployment
NO_PROMOTE=1 scripts/deploy.sh production                        # dry run: stage + smoke test, do not go live
```

### One-time setup (already done for this repo)
1. `vercel login`, then `vercel link --project cryptolens` (creates the project; `.vercel/` and `.env.local` are git-ignored).
2. Create a token at https://vercel.com/account/tokens with **Scope = Full Account** (set an expiry). A token scoped to a single team can read the project but is refused the user/team lookups the CLI makes first, and `vercel pull` fails with "Could not retrieve Project Settings". Store it: `pbpaste | tr -d "[:space:]" | gh secret set VERCEL_TOKEN`.
3. Repo secrets `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` come from `.vercel/project.json`.
4. Turn the deploy jobs on: `gh variable set DEPLOY_ENABLED --body true`. Until then they are skipped (Verify still runs), and you deploy by hand with `scripts/deploy.sh production`.
5. Do **not** connect the repository in Vercel's Git integration: deploys come from the pipeline only.

### Operating it
```bash
vercel rollback <deployment-url-or-id>    # instant rollback (about 3 s)
vercel promote  <deployment-url-or-id>    # promote a staged/older deployment
curl https://cryptolens-silk.vercel.app/api/health   # exchange reachability from the deployed region
```

### Troubleshooting
- **Deployment `BLOCKED`: "commit author doesn't have permission".** Vercel refuses commit authors whose GitHub account is not the one linked to the Vercel account. `scripts/deploy.sh` avoids this by deploying the prebuilt output with no git author metadata (the commit is recorded as plain labels). The alternative is to link the matching GitHub account in Vercel (Account Settings, Authentication).
- **Health check fails with "blocked for this region (HTTP 451)".** The region is geo-blocked by that exchange; change `regions` in `vercel.json`.
- **`vercel deploy --skip-domain` hangs.** A staged deployment never reports `READY`, so the CLI's own wait never ends; the script uses `--no-wait` and polls the API instead.

### Limits
- **Vercel Hobby is for non-commercial use.** Ads or paid plans need Vercel Pro (or another host).
- API routes have per-route `maxDuration` limits (15-30 s). Personal-scale traffic fits the free tier; each open dashboard polls several routes.
- The history recorder (`npm run record`) is a long-running process and cannot run on serverless hosting.
