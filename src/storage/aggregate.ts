/** One minute of taker flow for one symbol, built from aggTrade prints. `ts` is the minute START (unix seconds), like a candle time. */
export interface MinuteFlow {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  buyUsd: number;
  sellUsd: number;
  buyN: number;
  sellN: number;
  maxBuyUsd: number; // largest single taker buy print
  maxSellUsd: number;
  /** True if the stream was down at any point while this minute was open, so the totals are a lower bound. */
  gap: boolean;
}

const minuteOf = (tMs: number) => Math.floor(tMs / 60_000) * 60;

const blank = (ts: number): MinuteFlow => ({ ts, open: null, high: null, low: null, close: null, buyUsd: 0, sellUsd: 0, buyN: 0, sellN: 0, maxBuyUsd: 0, maxSellUsd: 0, gap: false });

/**
 * Buckets trades by EXCHANGE time into minutes. A minute is only emitted by `flush`, and once flushed it is sealed:
 * a straggler arriving later is dropped rather than re-creating (and overwriting) a complete row with a partial one.
 */
export class MinuteAggregator {
  private open = new Map<number, MinuteFlow>();
  private sealedUpTo = -Infinity; // minute starts <= this have been flushed
  private downSince: number | null = null; // ms, while the stream is down

  add(tMs: number, price: number, usd: number, buy: boolean): boolean {
    const ts = minuteOf(tMs);
    if (ts <= this.sealedUpTo) return false;
    let m = this.open.get(ts);
    if (!m) { m = blank(ts); this.open.set(ts, m); }
    if (m.open === null) m.open = price;
    m.close = price;
    m.high = m.high === null ? price : Math.max(m.high, price);
    m.low = m.low === null ? price : Math.min(m.low, price);
    if (buy) { m.buyUsd += usd; m.buyN++; m.maxBuyUsd = Math.max(m.maxBuyUsd, usd); } else { m.sellUsd += usd; m.sellN++; m.maxSellUsd = Math.max(m.maxSellUsd, usd); }
    return true;
  }

  /** Stream dropped at `nowMs`: every minute touched by the outage is flagged. */
  markDown(nowMs: number): void { if (this.downSince === null) this.downSince = nowMs; }

  /** Stream is back at `nowMs`. Minutes overlapping [downSince, nowMs] are flagged, including ones with no trades at all. */
  markUp(nowMs: number): void {
    if (this.downSince === null) return;
    for (let ts = minuteOf(this.downSince); ts <= minuteOf(nowMs); ts += 60) {
      if (ts <= this.sealedUpTo) continue;
      let m = this.open.get(ts);
      if (!m) { m = blank(ts); this.open.set(ts, m); }
      m.gap = true;
    }
    this.downSince = null;
  }

  /**
   * Emit every minute that has fully elapsed (start + 60s <= now), oldest first, and seal them.
   * If the stream is still down, elapsed minutes are flagged too.
   */
  flush(nowMs: number): MinuteFlow[] {
    const out: MinuteFlow[] = [];
    const cutoff = minuteOf(nowMs) - 60; // last fully elapsed minute start
    if (this.downSince !== null) {
      for (let ts = minuteOf(this.downSince); ts <= cutoff; ts += 60) {
        if (ts <= this.sealedUpTo) continue;
        let m = this.open.get(ts);
        if (!m) { m = blank(ts); this.open.set(ts, m); }
        m.gap = true;
      }
    }
    for (const ts of [...this.open.keys()].sort((a, b) => a - b)) {
      if (ts > cutoff) break;
      out.push(this.open.get(ts)!);
      this.open.delete(ts);
    }
    if (cutoff > this.sealedUpTo) this.sealedUpTo = cutoff;
    return out;
  }
}
