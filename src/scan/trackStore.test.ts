import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { getTrackedSignal, listTrackedSignals, openTrackerDb, trackSignal } from "./trackStore";

let db: DatabaseSync | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

describe("trackStore", () => {
  it("logs a signal and reads it back with its snapshot intact", () => {
    db = openTrackerDb(":memory:");
    const id = trackSignal(db, {
      symbol: "BTCUSDT",
      timeframe: "15m",
      kind: "scan_pick",
      note: "watching this one",
      snapshot: { price: 100, stage: "igniting" },
      nowMs: 1000,
    });

    const row = getTrackedSignal(db, id);
    expect(row).toEqual({
      id,
      symbol: "BTCUSDT",
      timeframe: "15m",
      kind: "scan_pick",
      loggedAtMs: 1000,
      note: "watching this one",
      snapshot: { price: 100, stage: "igniting" },
    });
  });

  it("returns null for an id that doesn't exist", () => {
    db = openTrackerDb(":memory:");
    expect(getTrackedSignal(db, 999)).toBeNull();
  });

  it("lists signals newest first, filtered by symbol and time window", () => {
    db = openTrackerDb(":memory:");
    trackSignal(db, { symbol: "BTCUSDT", timeframe: "15m", kind: "scan_pick", snapshot: {}, nowMs: 1000 });
    trackSignal(db, { symbol: "ETHUSDT", timeframe: "15m", kind: "scan_pick", snapshot: {}, nowMs: 2000 });
    trackSignal(db, { symbol: "BTCUSDT", timeframe: "1h", kind: "retest", snapshot: {}, nowMs: 3000 });

    expect(listTrackedSignals(db).map((s) => s.loggedAtMs)).toEqual([3000, 2000, 1000]);
    expect(listTrackedSignals(db, { symbol: "BTCUSDT" }).map((s) => s.loggedAtMs)).toEqual([3000, 1000]);
    expect(listTrackedSignals(db, { sinceMs: 1500 }).map((s) => s.loggedAtMs)).toEqual([3000, 2000]);
  });
});
