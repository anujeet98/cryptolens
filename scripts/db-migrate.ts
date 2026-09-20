/**
 * Create or update the authentication tables (user, session, account, verification, rateLimit) and the feedback table in DATABASE_URL.
 * Safe to run repeatedly: it only adds what is missing.   npm run db:migrate
 */
import { getMigrations } from "better-auth/db/migration";
import { authStatus } from "@/lib/auth/providers";
import { createAuth } from "@/lib/auth/server";
import { Pool } from "pg";
import { normalizeDatabaseUrl } from "@/lib/auth/providers";
import { FEEDBACK_SCHEMA } from "@/lib/feedback/store";

async function main() {
  const st = authStatus(process.env);
  if (!st.enabled) { console.error(`Authentication is not fully configured, so there is nothing to migrate: ${st.reason}`); process.exit(1); }
  // Schema changes must not go through a connection pooler (Neon's pooled URL). Use the direct URL when the host provides one.
  const auth = createAuth({ ...process.env, DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (!toBeCreated.length && !toBeAdded.length) console.log("Auth tables are up to date.");
  for (const t of toBeCreated) console.log(`create table ${t.table}`);
  for (const t of toBeAdded) console.log(`alter table ${t.table}: add ${Object.keys(t.fields).join(", ")}`);
  if (toBeCreated.length || toBeAdded.length) await runMigrations();
  // Feedback references "user", so it must come after the auth tables. Idempotent.
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL), max: 1 });
  try { await pool.query(FEEDBACK_SCHEMA); console.log("Feedback table is ready."); } finally { await pool.end(); }
  console.log("Migration complete.");
  process.exit(0);
}
main().catch((e) => { console.error("Migration failed:", e instanceof Error ? e.message : e); process.exit(1); });
