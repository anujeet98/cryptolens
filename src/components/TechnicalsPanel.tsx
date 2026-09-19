import type { Technicals } from "@/analysis/technicals";
import { MTF } from "@/hooks/useMtfRsi";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { Timeframe } from "@/types/market";

const tone = (good: boolean | null) => (good === null ? "text-muted" : good ? "text-bull" : "text-bear");
const rsiTone = (v: number) => (v >= 70 ? "text-warn" : v <= 30 ? "text-warn" : "text-foreground");

function Row({ k, v, cls = "" }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted">{k}</span>
      <span className={`num text-right ${cls}`}>{v}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-line px-3 py-2 md:border-r last:border-r-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="text-xs">{children}</div>
    </div>
  );
}

export function TechnicalsPanel({ t, mtfRsi, tf }: { t: Technicals | null; mtfRsi: Partial<Record<Timeframe, number>>; tf: Timeframe }) {
  if (!t) return <div className="rounded border border-line bg-panel p-4 text-sm text-muted">Waiting for enough candle history…</div>;
  const ema = t.mas.filter((m) => m.kind === "EMA");
  const smas = t.mas.filter((m) => m.kind === "SMA");
  const divs = [...t.rsiDivergences.map((d) => ({ ...d, src: "RSI" })), ...(t.macd?.divergences ?? []).map((d) => ({ ...d, src: "MACD" }))];
  const b = t.bollinger;
  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-4">
        <Block title={`Moving averages · ${tf}`}>
          <Row k="EMA structure" v={t.alignment} cls={t.alignment === "BULLISH" ? "text-bull" : t.alignment === "BEARISH" ? "text-bear" : "text-muted"} />
          {[...ema, ...smas].map((m) => (
            <Row key={m.kind + m.period} k={`${m.kind}${m.period}`}
              v={m.value === null ? "n/a" : <>{fmtPrice(m.value)} <span className={tone(m.priceAbove)}>{fmtPct(m.distancePct!)}</span> <span className="text-muted">{m.slopePct! >= 0 ? "↗" : "↘"}</span></>} />
          ))}
          {t.crosses.map((x) => (
            <Row key={x.pair} k={x.pair} v={`${x.dir === "up" ? "bullish" : "bearish"} cross ${x.barsAgo}b ago`} cls={x.dir === "up" ? "text-bull" : "text-bear"} />
          ))}
        </Block>

        <Block title="RSI">
          <Row k="RSI 14" v={t.rsi14?.toFixed(1) ?? "n/a"} cls={t.rsi14 ? rsiTone(t.rsi14) : ""} />
          <Row k="RSI 7" v={t.rsi7?.toFixed(1) ?? "n/a"} cls={t.rsi7 ? rsiTone(t.rsi7) : ""} />
          <Row k="Zone" v={t.rsiZone} cls={t.rsiZone === "NEUTRAL" ? "text-muted" : "text-warn"} />
          {MTF.map((x) => (
            <Row key={x} k={`RSI 14 · ${x}`} v={mtfRsi[x] !== undefined ? mtfRsi[x]!.toFixed(1) : "…"} cls={mtfRsi[x] !== undefined ? rsiTone(mtfRsi[x]!) : "text-muted"} />
          ))}
          {t.rsiFailureSwing && <Row k="Failure swing" v={t.rsiFailureSwing} cls={tone(t.rsiFailureSwing === "bullish")} />}
          {t.rsiNote && <p className="mt-1 text-[11px] leading-snug text-warn/80">{t.rsiNote}</p>}
        </Block>

        <Block title="MACD (12, 26, 9)">
          {t.macd ? (
            <>
              <Row k="State" v={t.macd.state} cls={tone(t.macd.state === "BULLISH")} />
              <Row k="Momentum" v={t.macd.momentum} cls={t.macd.momentum === "WEAKENING" ? "text-warn" : "text-foreground"} />
              <Row k="MACD" v={t.macd.macd.toPrecision(4)} />
              <Row k="Signal" v={t.macd.signal.toPrecision(4)} />
              <Row k="Histogram" v={t.macd.hist.toPrecision(4)} cls={tone(t.macd.hist >= 0)} />
              <Row k="Hist Δ" v={t.macd.histAccel.toPrecision(3)} cls={tone(t.macd.histAccel >= 0)} />
              {t.macd.cross && <Row k="Crossover" v={`${t.macd.cross.dir === "up" ? "bullish" : "bearish"} ${t.macd.cross.barsAgo}b ago`} cls={tone(t.macd.cross.dir === "up")} />}
            </>
          ) : <span className="text-muted">n/a</span>}
          <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Divergences</div>
          {divs.length === 0 && <span className="text-muted">none detected</span>}
          {divs.map((d, i) => (
            <Row key={i} k={`${d.src}`} v={`${d.kind} · ${d.barsAgo}b ago`} cls={d.kind.includes("bullish") ? "text-bull" : "text-bear"} />
          ))}
        </Block>

        <Block title="VWAP · Bollinger (20, 2)">
          <Row k="Day VWAP" v={t.vwap.day ? fmtPrice(t.vwap.day) : "n/a"} />
          <Row k="Week VWAP" v={t.vwap.week ? fmtPrice(t.vwap.week) : "n/a"} />
          <Row k="Price vs day VWAP" v={t.vwap.event ? `${t.vwap.dayPosition} · ${t.vwap.event}` : t.vwap.dayPosition ?? "n/a"} cls={tone(t.vwap.dayPosition === null ? null : t.vwap.dayPosition === "above")} />
          {b && (
            <>
              <div className="my-1 border-t border-line" />
              <Row k="Upper / Lower" v={`${fmtPrice(b.upper)} / ${fmtPrice(b.lower)}`} />
              <Row k="%B" v={b.percentB.toFixed(2)} />
              <Row k="Bandwidth" v={`${(b.bandwidth * 100).toFixed(2)}%`} />
              <Row k="Volatility" v={b.squeeze ? "SQUEEZE" : b.volatility} cls={b.squeeze ? "text-squeeze" : b.volatility === "EXPANDING" ? "text-warn" : "text-muted"} />
              {b.walking && <Row k="Band walk" v={`${b.walking} band`} cls="text-warn" />}
              <p className="mt-1 text-[11px] leading-snug text-muted">Touching a band is not by itself a reversal signal.</p>
            </>
          )}
        </Block>
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
        Indicators describe recent price behavior; they are inputs to the analysis engine, not standalone signals.
      </div>
    </section>
  );
}
