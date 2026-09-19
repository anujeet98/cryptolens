import { mtfAlignment, type Regime, type TrendRegime, type VolRegime } from "@/regime/regime";
import { MTF } from "@/hooks/useMtfRsi";
import type { MtfRegimes } from "@/hooks/useMtfRegime";
import type { Timeframe } from "@/types/market";

const TREND: Record<TrendRegime, { t: string; short: string; c: string }> = {
  STRONG_UPTREND: { t: "Strong uptrend", short: "▲▲", c: "text-bull" },
  UPTREND: { t: "Uptrend", short: "▲", c: "text-bull" },
  RANGE: { t: "Range", short: "↔", c: "text-muted" },
  DOWNTREND: { t: "Downtrend", short: "▼", c: "text-bear" },
  STRONG_DOWNTREND: { t: "Strong downtrend", short: "▼▼", c: "text-bear" },
  TRANSITION: { t: "Transition / mixed", short: "~", c: "text-warn" },
};
const VOL: Record<VolRegime, { t: string; c: string }> = {
  SQUEEZE: { t: "Squeeze", c: "text-warn" },
  LOW: { t: "Low volatility", c: "text-muted" },
  NORMAL: { t: "Normal volatility", c: "" },
  HIGH: { t: "High volatility", c: "text-warn" },
  EXTREME: { t: "Extreme volatility", c: "text-bear" },
};
const tone = (v: number) => (v > 0.05 ? "bg-bull" : v < -0.05 ? "bg-bear" : "bg-muted");

const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
);
const Kv = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between py-px text-xs"><span className="text-muted">{k}</span><span className="num">{v}</span></div>
);

export function RegimePanel({ r, mtf, tf }: { r: Regime | null; mtf: MtfRegimes; tf: Timeframe }) {
  if (!r) {
    return <section className="rounded border border-line bg-panel p-4 text-sm text-muted">Market regime: not enough candles on {tf} yet (needs 80).</section>;
  }
  const t = TREND[r.trend], v = VOL[r.volatility];
  const align = mtfAlignment(MTF.map((x) => mtf[x]?.trend));

  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-3">
        <div className="border-line p-3 md:border-r">
          <Title>Market regime · {tf}</Title>
          <div className={`text-xl font-semibold ${t.c}`}>{t.t}{r.stalled ? <span className="ml-2 text-sm font-normal text-warn">stalling</span> : null}</div>
          <div className={`text-sm ${v.c}`}>{v.t}{r.volTrend !== "STEADY" ? ` · ${r.volTrend.toLowerCase()}` : ""}</div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted">Confidence</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-line" title="How decisively the evidence fits this label. Not a probability of being right."><div className="h-full bg-accent" style={{ width: `${r.confidence}%` }} /></div>
            <span className="num w-8 text-right">{r.confidence}%</span>
          </div>
          <div className="mt-3"><Title>Across timeframes</Title></div>
          <div className="flex gap-1.5">
            {MTF.map((x) => {
              const m = mtf[x];
              const tt = m ? TREND[m.trend] : null;
              return (
                <div key={x} className={`flex-1 rounded border px-1 py-1 text-center ${x === tf ? "border-accent" : "border-line"}`} title={m ? `${tt!.t} · ${VOL[m.volatility].t} · ${m.confidence}% confidence` : "loading"}>
                  <div className="text-[10px] uppercase text-muted">{x === "1d" ? "1D" : x}</div>
                  <div className={`num text-sm ${tt?.c ?? "text-muted"}`}>{tt?.short ?? "…"}</div>
                </div>
              );
            })}
          </div>
          {align && <div className="mt-1 text-xs text-muted">{align.label}</div>}
        </div>

        <div className="border-line p-3 md:border-r">
          <div className="mb-1 flex items-baseline justify-between">
            <Title>Why: evidence</Title>
            <span className="num text-xs text-muted">score {r.trendScore >= 0 ? "+" : ""}{r.trendScore.toFixed(0)}</span>
          </div>
          <div className="space-y-1">
            {r.factors.map((f) => (
              <div key={f.key} className="text-xs" title={f.detail}>
                <div className="flex justify-between"><span>{f.label}</span><span className="text-[11px] text-muted">{f.detail}</span></div>
                <div className="relative h-1 rounded bg-line">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-muted/60" />
                  <div className={`absolute inset-y-0 ${tone(f.vote)}`} style={f.vote >= 0 ? { left: "50%", width: `${f.vote * 50}%` } : { right: "50%", width: `${-f.vote * 50}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3">
          <Title>Measures</Title>
          <Kv k="ADX (trend strength)" v={r.adx.toFixed(0)} />
          <Kv k="+DI / −DI" v={`${r.plusDI.toFixed(0)} / ${r.minusDI.toFixed(0)}`} />
          <Kv k="Efficiency (20 bars)" v={`${(r.efficiency * 100).toFixed(0)}%`} />
          <Kv k="ATR % of price" v={`${r.atrPct.toFixed(2)}%`} />
          <Kv k="ATR percentile (recent)" v={`${r.atrPercentile.toFixed(0)}th`} />
          <div className="mt-2"><Title>Context</Title></div>
          <ul className="space-y-1 text-xs">
            {r.notes.length === 0 && <li className="text-muted">Nothing notable beyond the classification.</li>}
            {r.notes.map((n) => <li key={n} className="text-warn">{n}</li>)}
          </ul>
        </div>
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
        Rule-based read of recent price behaviour: ADX gates trend vs range, a weighted vote of seven signals sets direction. It describes the past and is not a forecast. Backtests (npm run backtest) found the volatility label does tell how much price tends to move next, but the trend and momentum labels carried no significant directional information. Funding/OI notes are context and never change the label.
      </div>
    </section>
  );
}
