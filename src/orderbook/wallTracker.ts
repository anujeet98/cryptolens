import type { Wall } from "./analysis";

export type WallEventKind = "appeared" | "pulled" | "consumed";
export interface WallEvent {
  at: number;
  kind: WallEventKind;
  side: "bid" | "ask";
  price: number;
  usd: number;
  lifetimeSec: number;
}

interface Tracked {
  side: "bid" | "ask";
  price: number;
  usd: number;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Follows walls across book updates. A wall that vanishes while price never traded through it was cancelled/moved
 * ("pulled"); one that vanishes after price reached it was likely filled ("consumed"). Short-lived pulled walls are
 * reported as "potential temporary liquidity walls" — we cannot know intent, so nothing is ever labelled spoofing.
 */
export class WallTracker {
  private live = new Map<string, Tracked>();
  events: WallEvent[] = [];
  constructor(
    private minLifetimeSec = 3,
    private maxEvents = 30,
  ) {}

  private key = (w: { side: string; price: number }) => `${w.side}:${w.price}`;

  update(walls: Wall[], mid: number, nowMs: number): WallEvent[] {
    const fresh: WallEvent[] = [];
    const seen = new Set<string>();
    for (const w of walls) {
      const k = this.key(w);
      seen.add(k);
      const t = this.live.get(k);
      if (t) {
        t.lastSeen = nowMs;
        t.usd = w.usd;
      } else {
        this.live.set(k, { side: w.side, price: w.price, usd: w.usd, firstSeen: nowMs, lastSeen: nowMs });
        fresh.push({ at: nowMs, kind: "appeared", side: w.side, price: w.price, usd: w.usd, lifetimeSec: 0 });
      }
    }
    for (const [k, t] of this.live) {
      if (seen.has(k)) continue;
      this.live.delete(k);
      const life = (nowMs - t.firstSeen) / 1000;
      if (life < this.minLifetimeSec) continue; // flicker, ignore
      // Price within 0.05% of the wall (or through it) → it was likely hit rather than pulled.
      const reached = t.side === "bid" ? mid <= t.price * 1.0005 : mid >= t.price * 0.9995;
      fresh.push({
        at: nowMs,
        kind: reached ? "consumed" : "pulled",
        side: t.side,
        price: t.price,
        usd: t.usd,
        lifetimeSec: life,
      });
    }
    if (fresh.length) this.events = [...fresh, ...this.events].slice(0, this.maxEvents);
    return fresh;
  }

  /** Walls currently on the book with how long each has persisted. */
  active(nowMs: number) {
    return [...this.live.values()].map((t) => ({ ...t, ageSec: (nowMs - t.firstSeen) / 1000 }));
  }

  reset() {
    this.live.clear();
    this.events = [];
  }
}
