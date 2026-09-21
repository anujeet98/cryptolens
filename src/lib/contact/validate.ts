export const CONTACT_LIMITS = {
  nameMax: 80,
  emailMax: 200,
  messageMin: 10,
  messageMax: 2000,
  perHourPerIp: 3,
  perDayTotal: 200,
} as const;

export interface ContactInput {
  name: string;
  email: string;
  message: string;
}
export type ParsedContact =
  { ok: true; value: ContactInput } | { ok: true; spam: true; value?: undefined } | { ok: false; error: string };

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s: string) => s.replace(CONTROL, "").replace(/\r\n?/g, "\n").trim();
// Deliberately loose: a real check is "can we reply", which only the person can prove. This just stops obvious junk.
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/**
 * Validates an UNAUTHENTICATED contact request. `website` is a honeypot field hidden from people: bots fill it. A filled
 * honeypot is reported as `spam` so the caller can answer "ok" without storing anything (bots learn nothing).
 */
export function parseContact(raw: unknown): ParsedContact {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid request." };
  const r = raw as Record<string, unknown>;
  if (typeof r.website === "string" && r.website.trim() !== "") return { ok: true, spam: true };
  const name = typeof r.name === "string" ? clean(r.name).replace(/\n+/g, " ") : "";
  const email = typeof r.email === "string" ? clean(r.email) : "";
  const message = typeof r.message === "string" ? clean(r.message) : "";
  if (name.length > CONTACT_LIMITS.nameMax)
    return { ok: false, error: `Keep the name under ${CONTACT_LIMITS.nameMax} characters.` };
  if (!email || email.length > CONTACT_LIMITS.emailMax || !EMAIL.test(email))
    return { ok: false, error: "Enter an email address we can reply to." };
  if (message.length < CONTACT_LIMITS.messageMin)
    return { ok: false, error: `Please write at least ${CONTACT_LIMITS.messageMin} characters.` };
  if (message.length > CONTACT_LIMITS.messageMax)
    return { ok: false, error: `Keep the message under ${CONTACT_LIMITS.messageMax} characters.` };
  return { ok: true, value: { name, email, message } };
}

/** Origins allowed to call the contact endpoint from a browser: CONTACT_ALLOWED_ORIGINS (comma list), else the landing page's origin. */
export function allowedOrigins(env: Record<string, string | undefined>): string[] {
  const list = (env.CONTACT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromHome = (() => {
    try {
      return env.NEXT_PUBLIC_HOME_URL ? [new URL(env.NEXT_PUBLIC_HOME_URL).origin] : [];
    } catch {
      return [];
    }
  })();
  const out = new Set<string>();
  for (const o of [...list, ...fromHome]) {
    try {
      out.add(new URL(o).origin);
    } catch {
      /* ignore junk */
    }
  }
  return [...out];
}

/** A request with no Origin (curl, server to server) is let through to the rate limiter; a browser from another site is refused. */
export function originAllowed(origin: string | null, env: Record<string, string | undefined>): boolean {
  return origin === null || allowedOrigins(env).includes(origin);
}
