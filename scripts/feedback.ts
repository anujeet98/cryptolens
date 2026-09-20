/**
 * Read what users sent through the in-app feedback dialog.   npm run feedback [-- new|all]
 * Read-only. Shows the sender's email so you can reply (this is your own database; do not paste it into public issues).
 */
import { Pool } from "pg";
import { normalizeDatabaseUrl } from "@/lib/auth/providers";

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
  const all = process.argv.includes("all");
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 1 });
  try {
    const rows = (await pool.query(
      `select f.id, f.kind, f.title, f.body, f.page, f.status, f."createdAt" c, u.name, u.email
       from feedback f join "user" u on u.id = f."userId" ${all ? "" : "where f.status = 'new'"} order by f."createdAt" desc limit 50`)).rows;
    console.log(`${rows.length} ${all ? "" : "new "}item(s), newest first\n`);
    for (const r of rows) {
      console.log(`#${r.id}  [${r.kind}]  ${new Date(r.c).toISOString().slice(0, 16)}  ${r.name} <${r.email}>${r.page ? `  on ${r.page}` : ""}`);
      if (r.title) console.log(`  ${r.title}`);
      console.log(r.body.split("\n").map((l: string) => `  ${l}`).join("\n") + "\n");
    }
  } finally { await pool.end(); }
}
main().catch((e) => { console.error("Report failed:", e instanceof Error ? e.message : e); process.exit(1); });
