# CryptoLens

Real-time crypto market intelligence dashboard: live price, technicals, derivatives, order book, liquidations
and an explainable market-state assessment. Public exchange data only, no API keys required.

**Status:** Phase 4 — funding + open interest (Binance perp), on top of chart, indicators, volume and momentum.

Roadmap: indicators → volume/momentum → funding/OI → order book → trade flow → liquidations →
cross-exchange → regime → prediction/scenarios → storage → backtesting → alerts.

Not financial advice. Outputs are model estimates, never guarantees.

## Run
```bash
npm install
npm run dev   # http://localhost:3000
```

## Structure
- `src/exchanges/<name>` — modular connectors behind `ExchangeConnector` (Binance now; Bybit/OKX next)
- `src/app/api/*` — normalized REST API routes (symbols, candles, ticker)
- `src/hooks/useLiveMarket.ts` — REST history + WebSocket stream with auto-reconnect
- `src/indicators` — pure, unit-tested indicator math (`npm test`)
- `src/analysis/technicals.ts` — turns candles into a structured technicals snapshot
- `src/types` — common schema
