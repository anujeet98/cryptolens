"use client";
import { useEffect, useMemo, useState } from "react";
import { computeTechnicals } from "@/analysis/technicals";
import { DEFAULT_TOGGLES, EMA_COLORS, PriceChart, type Toggles } from "@/components/PriceChart";
import { computeMomentum } from "@/analysis/momentum";
import { analyzeVolume } from "@/analysis/volume";
import { MomentumVolumePanel } from "@/components/MomentumVolumePanel";
import { useVolumeWindows } from "@/hooks/useVolumeWindows";
import { analyzeFunding } from "@/analysis/funding";
import { analyzeOi } from "@/analysis/openInterest";
import { DerivativesPanel } from "@/components/DerivativesPanel";
import { useDerivatives, useOiSeries } from "@/hooks/useDerivatives";
import { OrderBookPanel } from "@/components/OrderBookPanel";
import { useOrderBook } from "@/hooks/useOrderBook";
import { TradeFlowPanel } from "@/components/TradeFlowPanel";
import { useTradeFlow } from "@/hooks/useTradeFlow";
import { LiquidationsPanel } from "@/components/LiquidationsPanel";
import { useLiquidations } from "@/hooks/useLiquidations";
import { CrossExchangePanel } from "@/components/CrossExchangePanel";
import { RegimePanel } from "@/components/RegimePanel";
import { useMtfRegime } from "@/hooks/useMtfRegime";
import { classifyRegime } from "@/regime/regime";
import { useCrossExchange } from "@/hooks/useCrossExchange";
import { TechnicalsPanel } from "@/components/TechnicalsPanel";
import { useMtfRsi } from "@/hooks/useMtfRsi";
import { SummaryBar } from "@/components/SummaryBar";
import { SymbolSearch } from "@/components/SymbolSearch";
import { useLiveMarket } from "@/hooks/useLiveMarket";
import { TIMEFRAMES, type CoinListing, type MarketType, type Timeframe } from "@/types/market";

const seg = (on: boolean) =>
  `rounded px-2.5 py-1 text-xs ${on ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground"}`;

export default function Home() {
  const [base, setBase] = useState("BTC");
  const [market, setMarket] = useState<MarketType>("perp");
  const [tf, setTf] = useState<Timeframe>("15m");
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [coins, setCoins] = useState<CoinListing[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetch("/api/symbols").then((r) => r.json()).then((d) => Array.isArray(d) && setCoins(d)).catch(() => {});
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const listing = coins.find((c) => c.base === base);
  const pick = (mt: MarketType) => {
    const ms = listing?.markets.filter((m) => m.exchange === "binance" && m.marketType === mt) ?? [];
    return ms.find((m) => m.quote === "USDT") ?? ms[0];
  };
  const sel = pick(market) ?? pick(market === "perp" ? "spot" : "perp");
  const symbol = sel?.symbol ?? `${base}USDT`;
  const mt: MarketType = sel?.marketType ?? market;

  const live = useLiveMarket(symbol, mt, tf);
  const mtfRsi = useMtfRsi(symbol, mt);
  const tech = useMemo(() => computeTechnicals(live.candles), [live.candles]);
  const momentum = useMemo(() => computeMomentum(live.candles), [live.candles]);
  const volume = useMemo(() => analyzeVolume(live.candles, tf, now), [live.candles, tf, now]);
  const volWindows = useVolumeWindows(symbol, mt);
  const perpSymbol = pick("perp")?.symbol ?? null; // derivatives always come from the perp, even when viewing spot
  const deriv = useDerivatives(perpSymbol);
  const oiSeries = useOiSeries(perpSymbol, tf);
  const funding = useMemo(() => (deriv.data ? analyzeFunding(deriv.data.funding, deriv.data.snapshot.fundingRate) : null), [deriv.data]);
  const oi = useMemo(() => (deriv.data ? analyzeOi(deriv.data.oi5m, deriv.data.snapshot) : null), [deriv.data]);
  const mtfRegime = useMtfRegime(symbol, mt);
  const regime = useMemo(
    () => classifyRegime(live.candles, tf, { nowMs: now, ctx: { fundingClass: funding?.class, oiRegime: oi?.windows.find((w) => w.label === "1h")?.regime } }),
    [live.candles, tf, now, funding, oi],
  );
  const nextFundingIn = (() => {
    const ms = (deriv.data?.snapshot.nextFundingTime ?? 0) - now;
    if (ms <= 0) return "—";
    const m = Math.floor(ms / 60000);
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m ${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}s`;
  })();
  const ob = useOrderBook(symbol, mt);
  const flow = useTradeFlow(symbol, mt);
  const liq = useLiquidations(perpSymbol);
  const xch = useCrossExchange(base);
  const exchanges = [...new Set(listing?.markets.map((m) => m.exchange))];

  return (
    <main className="flex min-h-screen flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <span className="text-sm font-semibold tracking-wide">CRYPTO<span className="text-accent">LENS</span></span>
        <SymbolSearch value={base} onSelect={setBase} />
        <div className="flex gap-1">
          {(["perp", "spot"] as const).map((m) => (
            <button key={m} disabled={!pick(m)} onClick={() => setMarket(m)} className={`${seg(mt === m)} disabled:opacity-30`}>
              {m === "perp" ? "Perp" : "Spot"}
            </button>
          ))}
        </div>
        <span className="num text-xs text-muted">{symbol} · {exchanges.length ? exchanges.map((e) => `${e} ✓`).join("  ") : ""}</span>
      </header>

      <SummaryBar t={live.ticker} state={live.state} age={live.lastMsgAt ? now - live.lastMsgAt : 0}
        d={deriv.data ? { funding: deriv.data.snapshot.fundingRate, oiUsd: deriv.data.snapshot.openInterestUsd, oiChg1h: oi?.windows.find((w) => w.label === "1h")?.oiChangePct, ls: deriv.data.ls.at(-1)?.ratio } : undefined} />

      <RegimePanel r={regime} mtf={mtfRegime} tf={tf} />

      <section className="rounded border border-line bg-panel">
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          {TIMEFRAMES.map((t) => (
            <button key={t} onClick={() => setTf(t)} className={seg(tf === t)}>{t === "1d" ? "1D" : t}</button>
          ))}
          <span className="mx-2 h-4 w-px bg-line" />
          {([9, 20, 50, 100, 200] as const).map((p) => {
            const k = `ema${p}` as keyof Toggles;
            return (
              <button key={p} onClick={() => setToggles((s) => ({ ...s, [k]: !s[k] }))} className={seg(toggles[k])} style={toggles[k] ? { color: EMA_COLORS[p] } : undefined}>EMA{p}</button>
            );
          })}
          {(["vwap", "bb", "swings", "rsi", "macd", "oi", "funding"] as const).map((k) => (
            <button key={k} onClick={() => setToggles((s) => ({ ...s, [k]: !s[k] }))} className={seg(toggles[k])}>
              {k === "bb" ? "BB" : k === "swings" ? "Swings/SR" : k === "funding" ? "Funding" : k.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="relative h-[720px]">
          <PriceChart candles={live.candles} resetKey={`${symbol}:${mt}:${tf}:${oiSeries.length > 0}:${(deriv.data?.funding.length ?? 0) > 0}`} toggles={toggles} tf={tf} oi={oiSeries} funding={deriv.data?.funding ?? []} />
          {live.state === "error" && (
            <div className="absolute inset-0 grid place-items-center text-sm text-bear">{live.error}</div>
          )}
        </div>
      </section>

      <CrossExchangePanel x={xch} now={now} />
      <TradeFlowPanel tf={flow} now={now} symbol={symbol} marketLabel={mt === "perp" ? "perp" : "spot"} />
      <LiquidationsPanel liq={liq} symbol={perpSymbol} now={now} />
      <OrderBookPanel ob={ob} now={now} symbol={symbol} marketLabel={mt === "perp" ? "perp" : "spot"} />
      <DerivativesPanel st={deriv} funding={funding} oi={oi} symbol={perpSymbol} now={now} nextFundingIn={nextFundingIn} />
      <MomentumVolumePanel m={momentum} v={volume} windows={volWindows} ticker={live.ticker} tf={tf} />
      <TechnicalsPanel t={tech} mtfRsi={mtfRsi} tf={tf} />
    </main>
  );
}
