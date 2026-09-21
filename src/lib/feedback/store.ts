import { Pool } from "pg";
import { normalizeDatabaseUrl } from "@/lib/auth/providers";
import { CONTACT_LIMITS } from "@/lib/contact/validate";
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

-- Messages from the public landing-page contact form: no account, so the sender's email is whatever they typed.
-- ipHash is a salted hash (never the raw address), used only for rate limiting.
create table if not exists contact (
  id bigserial primary key,
  name text not null default '',
  email text not null,
  message text not null,
  "ipHash" text not null default '',
  "userAgent" text not null default '',
  status text not null default 'new',
  "createdAt" timestamptz not null default now()
);
create index if not exists contact_ip_created on contact ("ipHash", "createdAt" desc);
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

export type InboxSource = "feedback" | "contact";
export interface InboxRow {
  source: InboxSource; id: number; kind: "feature" | "bug" | "message" | "contact"; title: string; body: string; page: string;
  status: string; createdAt: string; name: string; email: string;
}

/** Everything for the internal inbox (signed-in feedback and public contact messages), newest first. Includes contact details: admin only. */
export async function listInbox(limit = 200): Promise<InboxRow[]> {
  const [f, c] = await Promise.all([
    db().query(`select f.id, f.kind, f.title, f.body, f.page, f.status, f."createdAt", u.name, u.email
                from feedback f join "user" u on u.id = f."userId" order by f."createdAt" desc limit $1`, [limit]),
    db().query(`select id, name, email, message as body, status, "createdAt" from contact order by "createdAt" desc limit $1`, [limit]),
  ]);
  const rows: InboxRow[] = [
    ...f.rows.map((x) => ({ source: "feedback" as const, id: Number(x.id), kind: x.kind, title: x.title, body: x.body, page: x.page, status: x.status, createdAt: new Date(x.createdAt).toISOString(), name: x.name, email: x.email })),
    ...c.rows.map((x) => ({ source: "contact" as const, id: Number(x.id), kind: "contact" as const, title: "", body: x.body, page: "", status: x.status, createdAt: new Date(x.createdAt).toISOString(), name: x.name || "(no name)", email: x.email })),
  ];
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

export async function setInboxStatus(source: InboxSource, id: number, status: string): Promise<boolean> {
  const table = source === "contact" ? "contact" : "feedback"; // fixed identifiers: never interpolated from input
  const r = await db().query(`update ${table} set status = $2 where id = $1`, [id, status]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Stores a public contact message unless this caller (by salted IP hash) sent CONTACT_LIMITS.perHourPerIp in the last hour,
 * or the whole form received perDayTotal in the last day (a flood cap). One statement, so racing requests cannot slip past.
 */
export async function addContact(c: { name: string; email: string; message: string }, ipHash: string, userAgent: string): Promise<boolean> {
  const r = await db().query(
    `insert into contact (name, email, message, "ipHash", "userAgent")
     select $1, $2, $3, $4, $5
     where (select count(*) from contact where "ipHash" = $4 and "createdAt" > now() - interval '1 hour') < $6
       and (select count(*) from contact where "createdAt" > now() - interval '1 day') < $7
     returning id`,
    [c.name, c.email, c.message, ipHash, userAgent.slice(0, 300), CONTACT_LIMITS.perHourPerIp, CONTACT_LIMITS.perDayTotal],
  );
  return (r.rowCount ?? 0) > 0;
}
