import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { authStatus, baseUrl, COOKIE_PREFIX, enabledProviders, normalizeDatabaseUrl, type Env } from "./providers";

type Options = Parameters<typeof betterAuth>[0];

/** Builds the Better Auth instance from an env object. Exported for the migration script and tests; app code uses getAuth(). */
export function createAuth(env: Env) {
  const url = baseUrl(env);
  const social: Record<string, Record<string, unknown>> = {};
  for (const p of enabledProviders(env)) {
    social[p.id] = { clientId: p.clientId, clientSecret: p.clientSecret };
    if (p.id === "microsoft") social[p.id].tenantId = (env.MICROSOFT_TENANT_ID ?? "").trim() || "common";
    if (p.id === "apple" && env.APPLE_APP_BUNDLE_IDENTIFIER)
      social[p.id].appBundleIdentifier = env.APPLE_APP_BUNDLE_IDENTIFIER.trim();
  }

  return betterAuth({
    // A small pool: serverless functions each hold their own, and Neon's pooled connection string multiplexes them.
    database: new Pool({
      connectionString: normalizeDatabaseUrl(env.DATABASE_URL),
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: url,
    trustedOrigins: [url],
    // OAuth only: no email/password, no magic links, nothing to reset or leak.
    emailAndPassword: { enabled: false },
    socialProviders: social as Options["socialProviders"],
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh the expiry once a day of use
      // A short-lived signed cookie cache means most API calls verify the session without a database round trip.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: {
      // Same person, second provider: link automatically ONLY when the provider vouches that the email is verified.
      accountLinking: { enabled: true },
    },
    user: { deleteUser: { enabled: true } },
    // In serverless there is no shared memory, so rate limits live in the database.
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: {
      useSecureCookies: url.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      // A unique cookie prefix, so this app can never collide with another Better Auth app on the same host (cookies are
      // shared across ports on localhost and across subdomains). Must match getSessionCookie() in proxy.ts.
      cookiePrefix: COOKIE_PREFIX,
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | null | undefined;

/** The shared instance, or null when authentication is not enabled (the dashboard is then open). Built lazily, once per process. */
export function getAuth(): Auth | null {
  if (cached !== undefined) return cached;
  cached = authStatus(process.env).enabled ? createAuth(process.env) : null;
  return cached;
}
