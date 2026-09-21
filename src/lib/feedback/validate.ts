export const KINDS = ["feature", "bug", "message"] as const;
export type FeedbackKind = (typeof KINDS)[number];

export const LIMITS = { titleMax: 120, titleMin: 3, bodyMin: 10, bodyMax: 2000, pageMax: 200, perHour: 5 } as const;

export interface FeedbackInput {
  kind: FeedbackKind;
  title: string;
  body: string;
  page: string;
}
export type Parsed = { ok: true; value: FeedbackInput } | { ok: false; error: string };

// Control characters other than tab and newline: never useful in feedback, and they can mangle logs and terminals.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s: string) => s.replace(CONTROL, "").replace(/\r\n?/g, "\n").trim();

/** Validates and normalises an untrusted request body. Never throws. Titles are required for ideas and bug reports, optional for messages. */
export function parseFeedback(raw: unknown): Parsed {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid request." };
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind))
    return { ok: false, error: "Choose what kind of feedback this is." };
  const title = typeof r.title === "string" ? clean(r.title).replace(/\n+/g, " ") : "";
  const body = typeof r.body === "string" ? clean(r.body) : "";
  if (kind !== "message" && title.length < LIMITS.titleMin) return { ok: false, error: "Add a short title." };
  if (title.length > LIMITS.titleMax)
    return { ok: false, error: `Keep the title under ${LIMITS.titleMax} characters.` };
  if (body.length < LIMITS.bodyMin) return { ok: false, error: `Please write at least ${LIMITS.bodyMin} characters.` };
  if (body.length > LIMITS.bodyMax) return { ok: false, error: `Keep it under ${LIMITS.bodyMax} characters.` };
  // The page the person was on: a same-site path only, never a full URL (it can carry query strings we do not want to keep).
  const page =
    typeof r.page === "string" && r.page.startsWith("/") && !r.page.startsWith("//")
      ? r.page.split(/[?#]/)[0].slice(0, LIMITS.pageMax)
      : "";
  return { ok: true, value: { kind: kind as FeedbackKind, title, body, page } };
}
