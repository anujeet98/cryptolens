/** Data-quality report for the recorder database: how much history exists and how trustworthy it is. */
import { statSync } from "node:fs";
import { DEFAULT_DB_PATH, openDb } from "@/storage/db";
import { coverage } from "@/storage/queries";

const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;
try { statSync(DB_PATH); } catch { console.error(`No database at ${DB_PATH}. Run: npm run record`); process.exit(1); }

const db = openDb(DB_PATH);
const iso = (s: number | null) => (s === null ? "-" : new Date(s * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z");
const dur = (min: number) => (min >= 1440 ? `${(min / 1440).toFixed(1)}d` : min >= 60 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`);
const now = Math.floor(Date.now() / 1000);

console.log(`Database ${DB_PATH} (${(statSync(DB_PATH).size / 1024).toFixed(0)} KB)\n`);
const symbols = (db.prepare("SELECT DISTINCT symbol FROM snapshots ORDER BY symbol").all() as { symbol: string }[]).map((r) => r.symbol);
if (!symbols.length) console.log("No snapshots yet.");
for (const s of symbols) {
  const c = coverage(db, s);
  const pct = c.expectedRows ? (100 * c.rows) / c.expectedRows : 0;
  console.log(`${s}`);
  console.log(`  span        ${iso(c.firstTs)}  ->  ${iso(c.lastTs)}  (${dur(c.expectedRows)}), last row ${dur((now - (c.lastTs ?? now)) / 60)} ago`);
  console.log(`  rows        ${c.rows} of ${c.expectedRows} minutes (${pct.toFixed(1)}% present), ${c.missingMinutes} missing`);
  console.log(`  quality     ${c.cleanRows} clean, ${c.partialRows} partial flow (stream gap), ${c.restMissingRows} without derivatives/book`);
  for (const g of c.gaps.slice(-5)) console.log(`  gap         ${iso(g.fromTs)} -> ${iso(g.toTs)} (${dur(g.minutes)})`);
  if (c.gaps.length > 5) console.log(`  gap         ... ${c.gaps.length - 5} earlier gaps not shown`);
}
const liq = db.prepare("SELECT COUNT(*) n, MIN(t) a, MAX(t) b, COUNT(DISTINCT symbol) s FROM liquidations").get() as { n: number; a: number | null; b: number | null; s: number };
console.log(`\nLiquidations (market-wide): ${liq.n} events across ${liq.s} symbols${liq.a ? `, ${iso(Math.floor(liq.a / 1000))} -> ${iso(Math.floor((liq.b as number) / 1000))}` : ""}`);
const runs = db.prepare("SELECT started, heartbeat, symbols FROM runs ORDER BY id DESC LIMIT 5").all() as { started: number; heartbeat: number; symbols: string }[];
console.log(`\nRecent runs (last heartbeat = when it was last known alive):`);
for (const r of runs) console.log(`  ${iso(r.started)} -> ${iso(r.heartbeat)}  ${dur((r.heartbeat - r.started) / 60)}  ${r.symbols}`);
db.close();
