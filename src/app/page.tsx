"use client";
import { useEffect, useMemo, useState } from "react";
import { computeTechnicals } from "@/analysis/technicals";
import { DEFAULT_TOGGLES, EMA_COLORS, PriceChart, type Toggles } from "@/components/PriceChart";
import { computeMomentum } from "@/analysis/momentum";
import { analyzeVolume } from "@/analysis/volume";
import { MomentumVolumePanel } from "@/components/MomentumVolumePanel";
import { useVolumeWindows } from "@/hooks/useVolumeWindows";
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

      <SummaryBar t={live.ticker} state={live.state} age={live.lastMsgAt ? now - live.lastMsgAt : 0} />

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
          {(["vwap", "bb", "swings", "rsi", "macd"] as const).map((k) => (
            <button key={k} onClick={() => setToggles((s) => ({ ...s, [k]: !s[k] }))} className={seg(toggles[k])}>
              {k === "bb" ? "BB" : k === "swings" ? "Swings/SR" : k.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="relative h-[720px]">
          <PriceChart candles={live.candles} resetKey={`${symbol}:${mt}:${tf}`} toggles={toggles} />
          {live.state === "error" && (
            <div className="absolute inset-0 grid place-items-center text-sm text-bear">{live.error}</div>
          )}
        </div>
      </section>

      <MomentumVolumePanel m={momentum} v={volume} windows={volWindows} ticker={live.ticker} tf={tf} />
      <TechnicalsPanel t={tech} mtfRsi={mtfRsi} tf={tf} />
    </main>
  );
}
