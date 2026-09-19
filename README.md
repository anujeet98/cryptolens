# CryptoLens

Real-time crypto market intelligence dashboard: live price, technicals, derivatives, order book, liquidations
and an explainable market-state assessment. Public exchange data only, no API keys required.

**Status:** Phase 9 — market regime (trend/range + volatility state with evidence and a multi-timeframe strip), on top of chart, indicators, volume, momentum, funding, OI, order book, trade flow, liquidations and cross-exchange.

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
- `src/regime` — rule-based regime classifier (ADX-gated trend vs range, weighted directional vote, volatility percentile, stall detection), unit-tested
- `src/types` — common schema

## Notes on exchanges
- **OKX is not included.** `okx.com` is unreachable from the development network (India): the host resolves to an ISP address and connections time out. The connector interface is exchange-agnostic, so OKX can be added from a network that reaches it.
- Cross-exchange data is matched by base asset name. Coins listed under different names (e.g. `1000PEPE` vs `PEPE`) are not paired.
