import { Pool } from "pg";
import { normalizeDatabaseUrl } from "@/lib/auth/providers";
import { LIMITS, type FeedbackInput } from "./validate";

/** Created by `npm run db:migrate`. Rows go away with the account (ON DELETE CASCADE), matching the privacy policy. */
export const FEEDBACK_SCHEMA = `
create table if not exists feedback (
  id bigserial primary key,
  "userId" text not null references "user"(id) on delete cascade,
  kind text not null check (kind in ('feature','bug','message')),
  title text not null default '',
  body text not null,
  page text not null default '',
  "userAgent" text not null default '',
  status text not null default 'new',
  "createdAt" timestamptz not null default now()
);
create index if not exists feedback_user_created on feedback ("userId", "createdAt" desc);
`;

let pool: Pool | undefined;
const db = () => (pool ??= new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 }));

/** Inserts unless the person already sent LIMITS.perHour items in the last hour. Returns false when rate limited. One statement, so two racing requests cannot both slip past the limit. */
export async function addFeedback(userId: string, f: FeedbackInput, userAgent: string): Promise<boolean> {
  const r = await db().query(
    `insert into feedback ("userId", kind, title, body, page, "userAgent")
     select $1, $2, $3, $4, $5, $6
     where (select count(*) from feedback where "userId" = $1 and "createdAt" > now() - interval '1 hour') < $7
     returning id`,
    [userId, f.kind, f.title, f.body, f.page, userAgent.slice(0, 300), LIMITS.perHour],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface FeedbackRow {
  id: number; kind: "feature" | "bug" | "message"; title: string; body: string; page: string; userAgent: string;
  status: string; createdAt: string; name: string; email: string;
}

/** Internal review list, newest first. Includes the sender's contact details: only call this behind the admin check. */
export async function listFeedback(limit = 200): Promise<FeedbackRow[]> {
  const r = await db().query(
    `select f.id, f.kind, f.title, f.body, f.page, f."userAgent", f.status, f."createdAt", u.name, u.email
     from feedback f join "user" u on u.id = f."userId" order by f."createdAt" desc limit $1`, [limit]);
  return r.rows.map((x) => ({ ...x, id: Number(x.id), createdAt: new Date(x.createdAt).toISOString() }));
}

export async function setFeedbackStatus(id: number, status: string): Promise<boolean> {
  const r = await db().query(`update feedback set status = $2 where id = $1`, [id, status]);
  return (r.rowCount ?? 0) > 0;
}
