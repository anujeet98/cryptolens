/**
 * Recorder: captures what cannot be fetched from a REST API later (taker flow, liquidations) plus a
 * per-minute sample of derivatives and order-book depth, into a local SQLite file.
 *
 *   npm run record                    # BTCUSDT + ETHUSDT
 *   npm run record -- SOLUSDT XRPUSDT # choose Binance perp symbols
 *   DB_PATH=/path/to.db npm run record
 *
 * Leave it running to build history. Gaps (laptop asleep, network down) are recorded and flagged, never filled in.
 */
import { WS, binance } from "@/exchanges/binance";
import { parseForceOrder } from "@/liquidations/liqs";
import { DEFAULT_DB_PATH, openDb, prune } from "@/storage/db";
import { Recorder } from "@/storage/recorder";

const SYMBOLS = (process.argv.slice(2).length ? process.argv.slice(2) : ["BTCUSDT", "ETHUSDT"]).map((s) =>
  s.toUpperCase(),
);
const bad = SYMBOLS.find((s) => !/^[A-Z0-9]{2,20}$/.test(s));
if (bad) {
  console.error(`Invalid symbol: ${bad}`);
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;
const db = openDb(DB_PATH);
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

const deriv = binance.derivatives;
if (!deriv || !binance.getOrderBookSnapshot)
  throw new Error("Binance connector is missing derivatives/order book support");
const recorder = new Recorder(db, SYMBOLS, {
  async sampleDerivs(symbol) {
    const s = await deriv.getSnapshot(symbol);
    return { mark: s.markPrice, index: s.indexPrice, fundingRate: s.fundingRate, oiUsd: s.openInterestUsd };
  },
  async sampleBook(symbol) {
    const b = await binance.getOrderBookSnapshot!(symbol, "perp", 1000);
    return { bids: b.bids, asks: b.asks };
  },
  log,
});

let ws: WebSocket | null = null;
let up = false;
let lastMsgAt = Date.now();
let retry = 0;
let stopping = false;
let liqCount = 0;

recorder.markDown(Date.now()); // we start mid-minute: that first minute is partial by definition

function connect() {
  const streams = [...SYMBOLS.map((s) => `${s.toLowerCase()}@aggTrade`), "!forceOrder@arr"].join("/");
  ws = new WebSocket(`${WS.perp}?streams=${streams}`);
  ws.onopen = () => {
    retry = 0;
    up = true;
    lastMsgAt = Date.now();
    recorder.markUp(Date.now());
    log(`stream up: ${SYMBOLS.join(", ")}`);
  };
  ws.onmessage = (ev) => {
    lastMsgAt = Date.now();
    const d = JSON.parse(String(ev.data)).data;
    if (d?.e === "aggTrade") recorder.onTrade(d.s, d.T, +d.p, +d.q, !!d.m);
    else if (d?.e === "forceOrder") {
      const l = parseForceOrder(d);
      if (l) {
        recorder.onLiquidation(l);
        liqCount++;
      }
    }
  };
  ws.onclose = () => {
    if (up) {
      up = false;
      recorder.markDown(Date.now());
      log("stream down");
    }
    if (stopping) return;
    setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
  };
  ws.onerror = () => ws?.close();
}

// A silent socket is a dead socket: BTC trades every second, so 45s of nothing means reconnect.
const watchdog = setInterval(() => {
  if (up && Date.now() - lastMsgAt > 45_000) {
    log("no data for 45s, reconnecting");
    ws?.close();
  }
}, 15_000);

async function tick() {
  try {
    const n = await recorder.tick(Date.now());
    log(`rows +${n} · liquidations +${liqCount} · stream ${up ? "up" : "DOWN"}`);
    liqCount = 0;
  } catch (e) {
    log(`tick failed: ${e instanceof Error ? e.message : e}`);
  }
}

// Tick one second after each minute boundary so the closing minute's trades have arrived.
let timer: ReturnType<typeof setTimeout>;
function schedule() {
  const wait = 60_000 - (Date.now() % 60_000) + 1000;
  timer = setTimeout(async () => {
    await tick();
    if (!stopping) schedule();
  }, wait);
}

const pruneNow = () => {
  const p = prune(db, Math.floor(Date.now() / 1000));
  if (p.snapshots || p.liquidations) log(`pruned ${p.snapshots} snapshots, ${p.liquidations} liquidations`);
};
pruneNow();
const pruneTimer = setInterval(pruneNow, 24 * 3600_000);

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  clearInterval(watchdog);
  clearInterval(pruneTimer);
  ws?.close();
  await tick(); // flush minutes that have fully elapsed
  db.close();
  log("stopped");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log(`recording ${SYMBOLS.join(", ")} -> ${DB_PATH}`);
connect();
schedule();
