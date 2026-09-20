/**
 * Create or update the authentication tables (user, session, account, verification, rateLimit) in DATABASE_URL.
 * Safe to run repeatedly: it only adds what is missing.   npm run db:migrate
 */
import { getMigrations } from "better-auth/db/migration";
import { authStatus } from "@/lib/auth/providers";
import { createAuth } from "@/lib/auth/server";

async function main() {
  const st = authStatus(process.env);
  if (!st.enabled) { console.error(`Authentication is not fully configured, so there is nothing to migrate: ${st.reason}`); process.exit(1); }
  // Schema changes must not go through a connection pooler (Neon's pooled URL). Use the direct URL when the host provides one.
  const auth = createAuth({ ...process.env, DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (!toBeCreated.length && !toBeAdded.length) { console.log("Database is up to date. Nothing to do."); process.exit(0); }
  for (const t of toBeCreated) console.log(`create table ${t.table}`);
  for (const t of toBeAdded) console.log(`alter table ${t.table}: add ${Object.keys(t.fields).join(", ")}`);
  await runMigrations();
  console.log("Migration complete.");
  process.exit(0);
}
main().catch((e) => { console.error("Migration failed:", e instanceof Error ? e.message : e); process.exit(1); });
