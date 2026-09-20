/**
 * Who is using the dashboard? A read-only report straight from the database.   npm run users
 * Emails are masked in the output. Nothing is written.
 */
import { Pool } from "pg";
import { normalizeDatabaseUrl } from "@/lib/auth/providers";

const mask = (e: string) => { const [u, d] = e.split("@"); return d ? `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}` : "(no email)"; };

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 1 });
  try {
    const one = async <T,>(sql: string) => (await pool.query(sql)).rows as T[];
    const [{ n: users }] = await one<{ n: string }>(`select count(*) n from "user"`);
    const [{ n: sessions }] = await one<{ n: string }>(`select count(*) n from session where "expiresAt" > now()`);
    const [{ n: week }] = await one<{ n: string }>(`select count(*) n from "user" where "createdAt" > now() - interval '7 days'`);
    console.log(`Users: ${users} total, ${week} joined in the last 7 days, ${sessions} active sessions\n`);
    console.log("Sign-ups per day (last 14 days):");
    for (const r of await one<{ d: string; n: string }>(`select "createdAt"::date d, count(*) n from "user" where "createdAt" > now() - interval '14 days' group by 1 order by 1 desc`)) console.log(`  ${String(r.d).slice(0, 10)}  ${r.n}`);
    console.log("\nBy sign-in provider:");
    for (const r of await one<{ p: string; n: string }>(`select "providerId" p, count(*) n from account group by 1 order by 2 desc`)) console.log(`  ${r.p.padEnd(12)} ${r.n}`);
    console.log("\nMost recent sign-ups:");
    for (const r of await one<{ name: string; email: string; c: Date }>(`select name, email, "createdAt" c from "user" order by "createdAt" desc limit 10`)) console.log(`  ${new Date(r.c).toISOString().slice(0, 16)}  ${r.name.slice(0, 24).padEnd(24)} ${mask(r.email)}`);
  } finally { await pool.end(); }
}
main().catch((e) => { console.error("Report failed:", e instanceof Error ? e.message : e); process.exit(1); });
