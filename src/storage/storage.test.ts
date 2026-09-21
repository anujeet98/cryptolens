import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FLAG_REST_MISSING,
  FLAG_WS_GAP,
  SCHEMA_VERSION,
  insertLiquidations,
  insertSnapshots,
  openDb,
  prune,
  type SnapshotRow,
} from "./db";
import { coverage, getLiquidations, getSnapshots } from "./queries";
import { Recorder, bookMetrics, type RecorderDeps } from "./recorder";

const T0 = 1_700_000_040; // minute-aligned unix seconds
const row = (ts: number, o: Partial<SnapshotRow> = {}): SnapshotRow => ({
  symbol: "BTCUSDT",
  ts,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  buyUsd: 10,
  sellUsd: 5,
  buyN: 2,
  sellN: 1,
  maxBuyUsd: 6,
  maxSellUsd: 5,
  mark: 1,
  indexPrice: 1,
  fundingRate: 0.0001,
  oiUsd: 1000,
  mid: 1,
  spreadBps: 1,
  bidUsd10bp: 1,
  askUsd10bp: 1,
  bidUsd50bp: 1,
  askUsd50bp: 1,
  flags: 0,
  ...o,
});

describe("openDb", () => {
  it("creates the schema at the current version and is idempotent on reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "cl-"));
    const p = join(dir, "sub", "t.db"); // nested dir is created
    const a = openDb(p);
    expect((a.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    insertSnapshots(a, [row(T0)]);
    a.close();
    const b = openDb(p);
    expect(getSnapshots(b, "BTCUSDT", 0, 9e9)).toHaveLength(1); // data survived, migration did not rerun destructively
    b.close();
  });
  it("refuses a database written by newer code", () => {
    const dir = mkdtempSync(join(tmpdir(), "cl-"));
    const p = join(dir, "t.db");
    const raw = new DatabaseSync(p);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    expect(() => openDb(p)).toThrow(/newer than this code/);
  });
});

describe("inserts and queries", () => {
  it("replaces on the same (symbol, ts) and round-trips NULLs", () => {
    const db = openDb(":memory:");
    insertSnapshots(db, [row(T0, { close: 1, mark: null })]);
    insertSnapshots(db, [row(T0, { close: 9, mark: null })]);
    const r = getSnapshots(db, "BTCUSDT", T0, T0);
    expect(r).toHaveLength(1);
    expect(r[0].close).toBe(9);
    expect(r[0].mark).toBeNull();
  });
  it("filters snapshots by symbol and inclusive range, oldest first", () => {
    const db = openDb(":memory:");
    insertSnapshots(db, [row(T0 + 120), row(T0), row(T0 + 60), row(T0, { symbol: "ETHUSDT" })]);
    expect(getSnapshots(db, "BTCUSDT", T0, T0 + 60).map((r) => r.ts)).toEqual([T0, T0 + 60]);
  });
  it("stores liquidations and filters by symbol or market-wide", () => {
    const db = openDb(":memory:");
    insertLiquidations(db, [
      { t: 3000, symbol: "A", side: "long", price: 1, usd: 5 },
      { t: 1000, symbol: "B", side: "short", price: 2, usd: 7 },
    ]);
    expect(getLiquidations(db, null, 0, 9000).map((l) => l.symbol)).toEqual(["B", "A"]);
    expect(getLiquidations(db, "A", 0, 9000)).toHaveLength(1);
  });
  it("prunes by retention window", () => {
    const db = openDb(":memory:");
    const now = T0 + 200 * 86400;
    insertSnapshots(db, [row(T0), row(now - 60)]);
    insertLiquidations(db, [
      { t: T0 * 1000, symbol: "A", side: "long", price: 1, usd: 1 },
      { t: (now - 60) * 1000, symbol: "A", side: "long", price: 1, usd: 1 },
    ]);
    expect(prune(db, now, 180, 90)).toEqual({ snapshots: 1, liquidations: 1 });
    expect(getSnapshots(db, "BTCUSDT", 0, 9e9)).toHaveLength(1);
  });
});

describe("coverage", () => {
  it("reports gaps, partial and REST-missing rows, and the clean count", () => {
    const db = openDb(":memory:");
    insertSnapshots(db, [
      row(T0),
      row(T0 + 60, { flags: FLAG_WS_GAP }),
      row(T0 + 120, { flags: FLAG_REST_MISSING }),
      // 5 minutes missing, then continues
      row(T0 + 120 + 6 * 60),
      row(T0 + 120 + 7 * 60),
      // 1 minute missing: below the gap threshold but still counted as missing
      row(T0 + 120 + 9 * 60),
    ]);
    const c = coverage(db, "BTCUSDT");
    expect(c.rows).toBe(6);
    expect(c.expectedRows).toBe(12);
    expect(c.missingMinutes).toBe(6);
    expect(c.gaps).toEqual([{ fromTs: T0 + 180, toTs: T0 + 120 + 5 * 60, minutes: 5 }]);
    expect(c.partialRows).toBe(1);
    expect(c.restMissingRows).toBe(1);
    expect(c.cleanRows).toBe(4);
  });
  it("handles an empty symbol", () => {
    expect(coverage(openDb(":memory:"), "NOPE").rows).toBe(0);
  });
});

describe("bookMetrics", () => {
  const bids: [number, number][] = Array.from({ length: 100 }, (_, i) => [100 - 0.01 * (i + 1), 10]);
  const asks: [number, number][] = Array.from({ length: 100 }, (_, i) => [100 + 0.01 * (i + 1), 10]);
  it("returns depth for bands the book reaches and NULL for those it does not", () => {
    const m = bookMetrics(bids, asks)!; // book spans ~1% each side
    expect(m.spreadBps).toBeGreaterThan(0);
    expect(m.bidUsd10bp).toBeGreaterThan(0);
    expect(m.bidUsd50bp).toBeGreaterThan(m.bidUsd10bp!);
    const thin = bookMetrics(bids.slice(0, 5), asks.slice(0, 5))!; // reaches only 0.05%
    expect(thin.bidUsd10bp).toBeNull();
    expect(thin.bidUsd50bp).toBeNull();
    expect(thin.mid).toBeGreaterThan(0);
  });
  it("returns null for a crossed or empty book", () => {
    expect(bookMetrics([], [])).toBeNull();
    expect(bookMetrics([[101, 1]], [[100, 1]])).toBeNull();
  });
});

describe("Recorder", () => {
  const bids: [number, number][] = Array.from({ length: 100 }, (_, i) => [100 - 0.01 * (i + 1), 10]);
  const asks: [number, number][] = Array.from({ length: 100 }, (_, i) => [100 + 0.01 * (i + 1), 10]);
  const ok: RecorderDeps = {
    sampleDerivs: async () => ({ mark: 100, index: 100.1, fundingRate: 0.0001, oiUsd: 5e9 }),
    sampleBook: async () => ({ bids, asks }),
  };
  const ms = (sec: number) => (T0 + sec) * 1000;

  it("writes a complete row for the minute that just closed, with flow, REST and book columns", async () => {
    const db = openDb(":memory:");
    const r = new Recorder(db, ["BTCUSDT"], ok, ms(0));
    r.onTrade("BTCUSDT", ms(5), 100, 2, false); // taker buy $200
    r.onTrade("BTCUSDT", ms(30), 101, 1, true); // taker sell $101
    r.onTrade("ETHUSDT", ms(30), 5, 1, true); // untracked: ignored
    expect(await r.tick(ms(61))).toBe(1);
    const s = getSnapshots(db, "BTCUSDT", 0, 9e9);
    expect(s).toHaveLength(1);
    expect(s[0].ts).toBe(T0);
    expect(s[0].buyUsd).toBe(200);
    expect(s[0].sellUsd).toBe(101);
    expect([s[0].open, s[0].close, s[0].high, s[0].low]).toEqual([100, 101, 101, 100]);
    expect(s[0].mark).toBe(100);
    expect(s[0].oiUsd).toBe(5e9);
    expect(s[0].spreadBps).toBeGreaterThan(0);
    expect(s[0].flags).toBe(0);
  });

  it("does not attach current REST samples to stale minutes after a stall", async () => {
    const db = openDb(":memory:");
    const r = new Recorder(db, ["BTCUSDT"], ok, ms(0));
    r.onTrade("BTCUSDT", ms(10), 100, 1, false);
    r.onTrade("BTCUSDT", ms(70), 100, 1, false);
    r.onTrade("BTCUSDT", ms(130), 100, 1, false);
    await r.tick(ms(200)); // machine slept: minutes 0, 1, 2 all closed; only minute 2 is "just closed"... minute 3 is open
    const s = getSnapshots(db, "BTCUSDT", 0, 9e9);
    expect(s.map((x) => x.ts - T0)).toEqual([0, 60, 120]);
    const stale = s.slice(0, 2),
      fresh = s[2];
    expect(stale.every((x) => x.mark === null && (x.flags & FLAG_REST_MISSING) === FLAG_REST_MISSING)).toBe(true);
    expect(fresh.mark).toBe(100);
    expect(fresh.flags).toBe(0);
  });

  it("still writes flow when REST sampling fails, and flags it", async () => {
    const db = openDb(":memory:");
    const logs: string[] = [];
    const bad: RecorderDeps = {
      sampleDerivs: async () => {
        throw new Error("451");
      },
      sampleBook: async () => ({ bids, asks }),
      log: (m) => logs.push(m),
    };
    const r = new Recorder(db, ["BTCUSDT"], bad, ms(0));
    r.onTrade("BTCUSDT", ms(5), 100, 1, false);
    await r.tick(ms(61));
    const s = getSnapshots(db, "BTCUSDT", 0, 9e9)[0];
    expect(s.buyUsd).toBe(100);
    expect(s.mark).toBeNull();
    expect(s.flags & FLAG_REST_MISSING).toBe(FLAG_REST_MISSING);
    expect(logs[0]).toContain("451");
  });

  it("flags minutes affected by a stream outage as partial", async () => {
    const db = openDb(":memory:");
    const r = new Recorder(db, ["BTCUSDT"], ok, ms(0));
    r.onTrade("BTCUSDT", ms(5), 100, 1, false);
    r.markDown(ms(20));
    r.markUp(ms(40));
    await r.tick(ms(61));
    expect(getSnapshots(db, "BTCUSDT", 0, 9e9)[0].flags & FLAG_WS_GAP).toBe(FLAG_WS_GAP);
  });

  it("persists buffered liquidations and heartbeats the run", async () => {
    const db = openDb(":memory:");
    const r = new Recorder(db, ["BTCUSDT"], ok, ms(0));
    r.onLiquidation({ t: ms(10), symbol: "XYZUSDT", side: "long", price: 1, usd: 50 });
    await r.tick(ms(61));
    expect(getLiquidations(db, null, 0, 9e15)).toHaveLength(1);
    const run = db.prepare("SELECT started, heartbeat, symbols FROM runs").get() as {
      started: number;
      heartbeat: number;
      symbols: string;
    };
    expect(run.started).toBe(T0);
    expect(run.heartbeat).toBe(T0 + 61);
    expect(run.symbols).toBe("BTCUSDT");
  });

  it("is single-flight: an overlapping tick is skipped and nothing is lost", async () => {
    const db = openDb(":memory:");
    let release!: () => void;
    const slow: RecorderDeps = {
      sampleDerivs: () =>
        new Promise((res) => {
          release = () => res({ mark: 1, index: 1, fundingRate: 0, oiUsd: 1 });
        }),
      sampleBook: async () => ({ bids, asks }),
    };
    const r = new Recorder(db, ["BTCUSDT"], slow, ms(0));
    r.onTrade("BTCUSDT", ms(5), 100, 1, false);
    const first = r.tick(ms(61));
    expect(await r.tick(ms(62))).toBe(0); // skipped while the first is in flight
    release();
    expect(await first).toBe(1);
    expect(getSnapshots(db, "BTCUSDT", 0, 9e9)).toHaveLength(1);
  });
});
