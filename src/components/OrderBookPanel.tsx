import { ladder, niceStep, type LadderRow } from "@/orderbook/analysis";
import type { OrderBookState } from "@/hooks/useOrderBook";
import { fmtPrice, fmtUsd } from "@/lib/format";

const tone = (v: number) => (v > 0 ? "text-bull" : v < 0 ? "text-bear" : "text-muted");
const ratingCls = { HIGH: "text-bull", MEDIUM: "text-warn", LOW: "text-bear" } as const;

const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
);

function Rows({ rows, side, max }: { rows: LadderRow[]; side: "bid" | "ask"; max: number }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.price} className="relative flex justify-between px-2 py-px text-xs">
          <div className={`absolute inset-y-0 right-0 ${side === "bid" ? "bg-bull/15" : "bg-bear/15"}`} style={{ width: `${(r.cumUsd / max) * 100}%` }} />
          <span className={`num relative ${side === "bid" ? "text-bull" : "text-bear"}`}>{fmtPrice(r.price)}</span>
          <span className="num relative text-muted">{fmtUsd(r.usd)}</span>
          <span className="num relative w-16 text-right">{fmtUsd(r.cumUsd)}</span>
        </div>
      ))}
    </>
  );
}

export function OrderBookPanel({ ob, now, symbol, marketLabel }: { ob: OrderBookState; now: number; symbol: string; marketLabel: string }) {
  const a = ob.analysis;
  const age = ob.lastEventAt ? Math.round((now - ob.lastEventAt) / 1000) : null;
  const stale = ob.status === "live" && age !== null && age > 5;
  const badge = stale ? { t: `STALE ${age}s`, c: "text-warn" } : ob.status === "live" ? { t: "LIVE", c: "text-bull" } : ob.status === "error" ? { t: "ERROR", c: "text-bear" } : { t: ob.status === "resyncing" ? "RESYNCING" : "SYNCING", c: "text-warn" };

  if (!a) {
    return (
      <section className="rounded border border-line bg-panel p-4 text-sm text-muted">
        Order book: {ob.error ?? "syncing snapshot + live deltas…"}
      </section>
    );
  }

  const step = niceStep(a.mid * 0.0001); // ~1bp per ladder row
  const asks = ladder(ob.asks, "ask", step, 10);
  const bids = ladder(ob.bids, "bid", step, 10);
  const max = Math.max(asks.at(-1)?.cumUsd ?? 1, bids.at(-1)?.cumUsd ?? 1);
  const bidTotal = bids.reduce((s, r) => s + r.usd, 0), askTotal = asks.reduce((s, r) => s + r.usd, 0);
  const topImb = bidTotal + askTotal > 0 ? (bidTotal - askTotal) / (bidTotal + askTotal) : 0;

  return (
    <section className="rounded border border-line bg-panel">
      <div className="grid md:grid-cols-3">
        <div className="border-line p-3 md:border-r">
          <Title>Order book · {symbol} {marketLabel}</Title>
          <div className="mb-1 flex justify-between px-2 text-[10px] uppercase text-muted"><span>Price</span><span>Size</span><span className="w-16 text-right">Cum.</span></div>
          <Rows rows={[...asks].reverse()} side="ask" max={max} />
          <div className="my-1 flex items-center justify-between border-y border-line px-2 py-1 text-xs">
            <span className="num text-sm font-semibold">{fmtPrice(a.mid)}</span>
            <span className="num text-muted">spread {fmtPrice(a.spread)} · {a.spreadBps.toFixed(2)} bps</span>
          </div>
          <Rows rows={bids} side="bid" max={max} />
          <div className="mt-1 px-2 text-[11px] text-muted">Top-10 imbalance <span className={`num ${tone(topImb)}`}>{topImb >= 0 ? "+" : ""}{(topImb * 100).toFixed(0)}%</span> · rows grouped by {fmtPrice(step)}</div>
        </div>

        <div className="border-line p-3 md:border-r">
          <div className="mb-1 flex items-baseline justify-between">
            <Title>Depth (USD, from mid)</Title>
            <span className={`text-xs font-medium ${ratingCls[a.rating]}`}>Liquidity {a.rating}</span>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] uppercase text-muted"><th className="text-left font-normal">±%</th><th className="text-right font-normal">Bids</th><th className="text-right font-normal">Asks</th><th className="text-right font-normal">Imb.</th></tr></thead>
            <tbody>
              {a.bands.map((b) => (
                <tr key={b.pct} className={b.complete ? "" : "text-muted"} title={b.complete ? undefined : "Loaded book (1000 levels) does not reach this far — value is a lower bound"}>
                  <td className="num py-px">{b.pct}%</td>
                  <td className="num text-right">{b.complete ? "" : "≥ "}{fmtUsd(b.bidUsd)}</td>
                  <td className="num text-right">{b.complete ? "" : "≥ "}{fmtUsd(b.askUsd)}</td>
                  <td className={`num text-right ${b.complete ? tone(b.imbalance) : ""}`}>{b.complete ? `${b.imbalance >= 0 ? "+" : ""}${(b.imbalance * 100).toFixed(0)}%` : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] leading-snug text-muted">Book reaches {a.coveragePct.bid.toFixed(2)}% below / {a.coveragePct.ask.toFixed(2)}% above mid. Grey rows are truncated lower bounds.</p>

          <div className="mt-3"><Title>Estimated market impact</Title></div>
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] uppercase text-muted"><th className="text-left font-normal">Size</th><th className="text-right font-normal">Buy</th><th className="text-right font-normal">Sell</th></tr></thead>
            <tbody>
              {a.impacts.map((i) => (
                <tr key={i.usd}>
                  <td className="num py-px">{fmtUsd(i.usd)}</td>
                  {[i.buySlippageBps, i.sellSlippageBps].map((v, k) => (
                    <td key={k} className={`num text-right ${v === null ? "text-bear" : v > 30 ? "text-warn" : ""}`}>{v === null ? "exceeds book" : `${v.toFixed(1)} bps`}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-3">
          <Title>Potential liquidity walls</Title>
          <div className="text-xs">
            {a.walls.length === 0 && <span className="text-muted">No outsized resting orders nearby.</span>}
            {a.walls.map((w) => {
              const active = ob.activeWalls.find((x) => x.side === w.side && x.price === w.price);
              return (
                <div key={w.side + w.price} className="flex justify-between py-0.5">
                  <span className={w.side === "bid" ? "text-bull" : "text-bear"}>{w.side === "bid" ? "Bid" : "Ask"} {fmtPrice(w.price)}</span>
                  <span className="num text-muted">{fmtUsd(w.usd)} · {w.multiple.toFixed(0)}× typical · {w.distancePct >= 0 ? "+" : ""}{w.distancePct.toFixed(2)}%{active ? ` · ${Math.round(active.ageSec)}s` : ""}</span>
                </div>
              );
            })}
            <p className="mt-1 text-[11px] leading-snug text-muted">Displayed orders can be cancelled at any time. These are only potential temporary liquidity walls, never confirmed intent.</p>
          </div>
          <div className="mt-3"><Title>Recent wall events</Title></div>
          <div className="max-h-40 overflow-auto text-xs">
            {ob.wallEvents.length === 0 && <span className="text-muted">None yet — tracking started when this book synced.</span>}
            {ob.wallEvents.map((e, i) => (
              <div key={i} className="flex justify-between py-0.5">
                <span className={e.kind === "pulled" ? "text-warn" : e.kind === "consumed" ? "text-muted" : ""}>
                  {e.kind === "appeared" ? "Appeared" : e.kind === "pulled" ? "Pulled (price never reached)" : "Absorbed / filled"} · {e.side}
                </span>
                <span className="num text-muted">{fmtPrice(e.price)} · {fmtUsd(e.usd)}{e.lifetimeSec ? ` · ${Math.round(e.lifetimeSec)}s` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-between border-t border-line px-3 py-1.5 text-[11px] text-muted">
        <span>Binance · book <span className={`font-medium ${badge.c}`}>{badge.t}</span>{age !== null && ` · last delta ${age}s ago`} · {ob.resyncs} resync{ob.resyncs === 1 ? "" : "s"}</span>
        <span>Snapshot + WS deltas, sequence-checked; resyncs automatically on any gap</span>
      </div>
    </section>
  );
}
