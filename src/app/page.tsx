"use client";
import { useEffect, useState } from "react";
import { PriceChart } from "@/components/PriceChart";
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
        </div>
        <div className="relative h-[560px]">
          <PriceChart candles={live.candles} resetKey={`${symbol}:${mt}:${tf}`} />
          {live.state === "error" && (
            <div className="absolute inset-0 grid place-items-center text-sm text-bear">{live.error}</div>
          )}
        </div>
      </section>
    </main>
  );
}
