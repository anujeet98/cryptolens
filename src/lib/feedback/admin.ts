export const STATUSES = ["new", "seen", "planned", "done", "dismissed"] as const;
export type FeedbackStatus = (typeof STATUSES)[number];
export const isStatus = (v: unknown): v is FeedbackStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

/** Emails allowed into the internal feedback review page: ADMIN_EMAILS, comma separated, case-insensitive. */
export function adminEmails(env: Record<string, string | undefined>): string[] {
  return (env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Admin only when the email is on the list AND the sign-in provider vouched that the email is verified. Without the second
 * check, a provider that hands back unverified emails (X can) would let anyone claim an admin address.
 */
export function isAdmin(user: { email?: string | null; emailVerified?: boolean | null } | null | undefined, env: Record<string, string | undefined>): boolean {
  if (!user?.email || user.emailVerified !== true) return false;
  return adminEmails(env).includes(user.email.trim().toLowerCase());
}
