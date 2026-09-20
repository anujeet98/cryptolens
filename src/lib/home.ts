/**
 * Optional link from the dashboard back to a marketing/landing page. Self-hosters leave NEXT_PUBLIC_HOME_URL unset and get
 * no link. Only absolute http(s) URLs are accepted, so a typo or a "javascript:" value can never become a clickable link.
 */
export function resolveHomeUrl(value: string | undefined | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}
