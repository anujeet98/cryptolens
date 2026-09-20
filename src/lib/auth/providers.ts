/**
 * Which sign-in methods exist and whether authentication is on at all. Pure functions of an env object so they can be
 * tested exhaustively and shared by the server, the proxy and the health endpoint. Nothing here reads secrets into logs.
 *
 * Authentication is OPTIONAL. It turns on only when a database, a signing secret and at least one OAuth provider are
 * configured, so a self-hosted copy of the open-source dashboard stays open with zero setup.
 */
export type ProviderId = "google" | "github" | "microsoft" | "apple" | "twitter" | "discord" | "facebook" | "linkedin";

export interface ProviderMeta { id: ProviderId; label: string; prefix: string }

/** Order here is the order of the buttons on the sign-in page. Add a provider by adding a row (and its config in server.ts). */
export const PROVIDERS: readonly ProviderMeta[] = [
  { id: "google", label: "Google", prefix: "GOOGLE" },
  { id: "github", label: "GitHub", prefix: "GITHUB" },
  { id: "microsoft", label: "Microsoft", prefix: "MICROSOFT" },
  { id: "apple", label: "Apple", prefix: "APPLE" },
  { id: "twitter", label: "X (Twitter)", prefix: "TWITTER" },
  { id: "discord", label: "Discord", prefix: "DISCORD" },
  { id: "facebook", label: "Facebook", prefix: "FACEBOOK" },
  { id: "linkedin", label: "LinkedIn", prefix: "LINKEDIN" },
];

export type Env = Record<string, string | undefined>;

export interface ProviderCredentials { id: ProviderId; label: string; clientId: string; clientSecret: string }

const clean = (v: string | undefined) => (v ?? "").trim();

/** A provider is enabled only when BOTH its client id and secret are set. A half-configured provider is ignored, never partially on. */
export function enabledProviders(env: Env): ProviderCredentials[] {
  const out: ProviderCredentials[] = [];
  for (const p of PROVIDERS) {
    const clientId = clean(env[`${p.prefix}_CLIENT_ID`]), clientSecret = clean(env[`${p.prefix}_CLIENT_SECRET`]);
    if (clientId && clientSecret) out.push({ id: p.id, label: p.label, clientId, clientSecret });
  }
  return out;
}

/** Prefix for every auth cookie (session_token, session_data, ...). Shared by the server config and the proxy. */
export const COOKIE_PREFIX = "cryptolens";

export const MIN_SECRET_LENGTH = 32;

export interface AuthStatus {
  enabled: boolean;
  /** Why it is off (or misconfigured). Safe to show to the operator; never contains a secret value. */
  reason?: string;
  providers: ProviderId[];
}

export function authStatus(env: Env): AuthStatus {
  const providers = enabledProviders(env).map((p) => p.id);
  if (!clean(env.DATABASE_URL)) return { enabled: false, reason: "DATABASE_URL is not set", providers };
  const secret = clean(env.BETTER_AUTH_SECRET);
  if (!secret) return { enabled: false, reason: "BETTER_AUTH_SECRET is not set", providers };
  if (secret.length < MIN_SECRET_LENGTH) return { enabled: false, reason: `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`, providers };
  if (providers.length === 0) return { enabled: false, reason: "no OAuth provider is configured (set <PROVIDER>_CLIENT_ID and <PROVIDER>_CLIENT_SECRET)", providers };
  return { enabled: true, providers };
}

/** The public origin OAuth callbacks are built from. Must match the redirect URIs registered with each provider. */
export function baseUrl(env: Env): string {
  const explicit = clean(env.BETTER_AUTH_URL);
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = clean(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/**
 * Pin TLS verification. The `pg` driver currently treats sslmode=require/prefer/verify-ca as verify-full but is changing that
 * to weaker libpq semantics in its next major version, which would silently stop verifying the server certificate. Rewriting
 * them to verify-full keeps the connection strictly verified across upgrades. Explicit choices ("verify-full", "disable") and
 * URLs without sslmode (local development) are left alone; anything that is not a valid URL is returned unchanged.
 */
export function normalizeDatabaseUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode");
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  } catch { return url; }
}
