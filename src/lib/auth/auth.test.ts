import { describe, expect, it } from "vitest";
import { authStatus, baseUrl, COOKIE_PREFIX, enabledProviders, normalizeDatabaseUrl, type Env } from "./providers";
import { checkApiAccess, gateDecision, isPublicPath, safeNext, tokensMatch } from "./gate";

const SECRET = "x".repeat(40);
// Build URLs from parts so no credential-shaped literal sits in the source (secret scanners flag those, even fake ones).
const dbUrl = ({ user = "", pass = "", host, path = "" }: { user?: string; pass?: string; host: string; path?: string }) => {
  const u = new URL("postgresql://placeholder");
  u.username = user; u.password = pass; u.hostname = host; u.pathname = path;
  return u.toString();
};
const base: Env = { DATABASE_URL: dbUrl({ host: "h", path: "/db" }), BETTER_AUTH_SECRET: SECRET, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "sec" };

describe("enabledProviders", () => {
  it("enables a provider only when both id and secret are present, in button order", () => {
    const p = enabledProviders({ GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "d", DISCORD_CLIENT_ID: "only-id" });
    expect(p.map((x) => x.id)).toEqual(["google", "github"]); // discord ignored (no secret)
    expect(p[1]).toMatchObject({ label: "GitHub", clientId: "a", clientSecret: "b" });
  });
  it("ignores blank and whitespace-only values", () => {
    expect(enabledProviders({ GITHUB_CLIENT_ID: "  ", GITHUB_CLIENT_SECRET: "x" })).toEqual([]);
  });
  it("knows all the major providers", () => {
    const env: Env = {};
    for (const k of ["GOOGLE", "GITHUB", "MICROSOFT", "APPLE", "TWITTER", "DISCORD", "FACEBOOK", "LINKEDIN"]) { env[`${k}_CLIENT_ID`] = "i"; env[`${k}_CLIENT_SECRET`] = "s"; }
    expect(enabledProviders(env).map((x) => x.id)).toEqual(["google", "github", "microsoft", "apple", "twitter", "discord", "facebook", "linkedin"]);
  });
});

describe("authStatus", () => {
  it("is on only with a database, a long-enough secret and at least one provider", () => {
    expect(authStatus(base)).toEqual({ enabled: true, providers: ["github"] });
  });
  it("is off, with a specific reason, for each missing piece (self-hosted default is off)", () => {
    expect(authStatus({})).toMatchObject({ enabled: false, reason: "DATABASE_URL is not set" });
    expect(authStatus({ ...base, DATABASE_URL: undefined })).toMatchObject({ enabled: false });
    expect(authStatus({ ...base, BETTER_AUTH_SECRET: undefined })).toMatchObject({ enabled: false, reason: "BETTER_AUTH_SECRET is not set" });
    expect(authStatus({ ...base, BETTER_AUTH_SECRET: "short" }).reason).toContain("at least 32");
    expect(authStatus({ ...base, GITHUB_CLIENT_ID: undefined }).reason).toContain("no OAuth provider");
  });
  it("never puts a secret value into the reason", () => {
    const r = JSON.stringify(authStatus({ ...base, BETTER_AUTH_SECRET: "short-secret-value" }));
    expect(r).not.toContain("short-secret-value");
    expect(JSON.stringify(authStatus(base))).not.toContain(SECRET);
  });
});

describe("normalizeDatabaseUrl (keep TLS verification strict)", () => {
  const neon = dbUrl({ user: "user", pass: "p@ss", host: "db.example.test", path: "/appdb" });
  it.each(["require", "prefer", "verify-ca"])("upgrades sslmode=%s to verify-full", (m) => {
    expect(new URL(normalizeDatabaseUrl(`${neon}?sslmode=${m}`)!).searchParams.get("sslmode")).toBe("verify-full");
  });
  const local = dbUrl({ user: "postgres", host: "127.0.0.1", path: "/e2e" });
  it("leaves explicit verify-full, explicit disable and URLs without sslmode alone", () => {
    expect(normalizeDatabaseUrl(`${neon}?sslmode=verify-full`)).toBe(`${neon}?sslmode=verify-full`);
    expect(new URL(normalizeDatabaseUrl(`${neon}?sslmode=disable`)!).searchParams.get("sslmode")).toBe("disable");
    expect(normalizeDatabaseUrl(local)).toBe(local);
  });
  it("preserves credentials (including encoded characters) and other parameters", () => {
    const out = new URL(normalizeDatabaseUrl(`${neon}?sslmode=require&channel_binding=require&connect_timeout=10`)!);
    expect(decodeURIComponent(out.password)).toBe("p@ss");
    expect(out.username).toBe("user");
    expect(out.hostname).toBe("db.example.test");
    expect(out.searchParams.get("channel_binding")).toBe("require");
    expect(out.searchParams.get("connect_timeout")).toBe("10");
  });
  it("passes through undefined, empty and non-URL values without throwing", () => {
    expect(normalizeDatabaseUrl(undefined)).toBeUndefined();
    expect(normalizeDatabaseUrl("")).toBe("");
    expect(normalizeDatabaseUrl("not a url")).toBe("not a url");
  });
});

describe("COOKIE_PREFIX", () => {
  it("is unique to this app, so it cannot collide with another Better Auth app on the same host", () => {
    expect(COOKIE_PREFIX).toBe("cryptolens");
    expect(COOKIE_PREFIX).not.toBe("better-auth"); // the library default, shared by every other app
  });
});

describe("baseUrl", () => {
  it("prefers BETTER_AUTH_URL, strips trailing slashes, then the Vercel production host, then localhost", () => {
    expect(baseUrl({ BETTER_AUTH_URL: "https://app.example.com//" })).toBe("https://app.example.com");
    expect(baseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://x.vercel.app");
    expect(baseUrl({})).toBe("http://localhost:3000");
  });
});

describe("safeNext (open-redirect protection)", () => {
  it("keeps ordinary same-site paths and queries", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/dashboard?coin=ETH&tf=1h")).toBe("/dashboard?coin=ETH&tf=1h");
  });
  it.each(["//evil.com", "https://evil.com", "http://evil.com/x", "javascript:alert(1)", "/\\evil.com", "\\\\evil.com", "evil.com", "", "/ok\nSet-Cookie: a=b", "data:text/html,x"])("rejects %j", (v) => {
    expect(safeNext(v)).toBe("/");
  });
  it("never bounces back into the auth pages", () => {
    expect(safeNext("/sign-in?next=/x")).toBe("/");
    expect(safeNext("/api/auth/callback/github")).toBe("/");
  });
  it("handles null and undefined", () => { expect(safeNext(null)).toBe("/"); expect(safeNext(undefined)).toBe("/"); });
});

describe("gateDecision (fast, optimistic layer)", () => {
  const on = { enabled: true };
  it("allows everything when auth is off", () => {
    expect(gateDecision({ enabled: false, pathname: "/", hasSessionCookie: false })).toEqual({ action: "allow" });
    expect(gateDecision({ enabled: false, pathname: "/api/ticker", hasSessionCookie: false })).toEqual({ action: "allow" });
  });
  it("sends anonymous page requests to sign-in and remembers where they were going", () => {
    expect(gateDecision({ ...on, pathname: "/", hasSessionCookie: false })).toEqual({ action: "redirect", to: "/sign-in" });
    expect(gateDecision({ ...on, pathname: "/x", search: "?a=1", hasSessionCookie: false })).toEqual({ action: "redirect", to: "/sign-in?next=%2Fx%3Fa%3D1" });
  });
  it("answers anonymous API requests with 401, not a redirect", () => {
    expect(gateDecision({ ...on, pathname: "/api/ticker", hasSessionCookie: false })).toEqual({ action: "unauthorized" });
  });
  it("lets public paths through anonymously (sign-in, auth endpoints, health)", () => {
    for (const p of ["/sign-in", "/api/auth/sign-in/social", "/api/auth/callback/github", "/api/health"]) expect(gateDecision({ ...on, pathname: p, hasSessionCookie: false })).toEqual({ action: "allow" });
  });
  it("lets a cookie-holder through to the app", () => {
    expect(gateDecision({ ...on, pathname: "/", hasSessionCookie: true })).toEqual({ action: "allow" });
    expect(gateDecision({ ...on, pathname: "/api/ticker", hasSessionCookie: true })).toEqual({ action: "allow" });
  });
  it("REGRESSION: never bounces away from /sign-in because of a cookie (an invalid cookie would cause a redirect loop)", () => {
    expect(gateDecision({ ...on, pathname: "/sign-in", hasSessionCookie: true })).toEqual({ action: "allow" });
    expect(gateDecision({ ...on, pathname: "/sign-in", search: "?next=%2F", hasSessionCookie: true })).toEqual({ action: "allow" });
    expect(gateDecision({ ...on, pathname: "/sign-in", hasSessionCookie: false })).toEqual({ action: "allow" });
  });
  it("lets a request with the correct smoke token through the proxy, on any path", () => {
    const t = { ...on, smokeToken: "s3cret", presentedToken: "s3cret", hasSessionCookie: false };
    expect(gateDecision({ ...t, pathname: "/api/ticker" })).toEqual({ action: "allow" });
    expect(gateDecision({ ...t, pathname: "/" })).toEqual({ action: "allow" });
  });
  it("still refuses a wrong, missing or unconfigured smoke token at the proxy", () => {
    const anon = { ...on, pathname: "/api/ticker", hasSessionCookie: false };
    expect(gateDecision({ ...anon, smokeToken: "s3cret", presentedToken: "wrong" })).toEqual({ action: "unauthorized" });
    expect(gateDecision({ ...anon, smokeToken: "s3cret", presentedToken: null })).toEqual({ action: "unauthorized" });
    expect(gateDecision({ ...anon, smokeToken: undefined, presentedToken: "anything" })).toEqual({ action: "unauthorized" });
    expect(gateDecision({ ...anon, smokeToken: "", presentedToken: "" })).toEqual({ action: "unauthorized" });
  });
  it("does not treat look-alike paths as public", () => {
    expect(isPublicPath("/sign-in-evil")).toBe(false);
    expect(isPublicPath("/api/authx")).toBe(false);
    expect(isPublicPath("/api/health/extra")).toBe(false);
  });
});

describe("tokensMatch", () => {
  it("matches only identical non-empty strings", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
    expect(tokensMatch(null, "abc")).toBe(false);
    expect(tokensMatch("abc", undefined)).toBe(false);
  });
});

describe("checkApiAccess (strict layer)", () => {
  const never = async () => { throw new Error("should not be called"); };
  it("is open when auth is off, without touching the session", async () => {
    expect(await checkApiAccess({ enabled: false, getUser: never })).toEqual({ ok: true, via: "open" });
  });
  it("accepts a verified session", async () => {
    expect(await checkApiAccess({ enabled: true, getUser: async () => ({ id: "u1" }) })).toEqual({ ok: true, via: "session", userId: "u1" });
  });
  it("refuses when there is no verified session, even though a cookie may exist", async () => {
    expect(await checkApiAccess({ enabled: true, getUser: async () => null })).toEqual({ ok: false, status: 401 });
  });
  it("fails closed when the session lookup throws (database down)", async () => {
    expect(await checkApiAccess({ enabled: true, getUser: async () => { throw new Error("db down"); } })).toEqual({ ok: false, status: 401 });
  });
  it("accepts the smoke token only when it is configured AND matches, and skips the session lookup", async () => {
    expect(await checkApiAccess({ enabled: true, smokeToken: "s3cret", presentedToken: "s3cret", getUser: never })).toEqual({ ok: true, via: "smoke-token" });
    expect(await checkApiAccess({ enabled: true, smokeToken: "s3cret", presentedToken: "wrong", getUser: async () => null })).toEqual({ ok: false, status: 401 });
    expect(await checkApiAccess({ enabled: true, smokeToken: undefined, presentedToken: "anything", getUser: async () => null })).toEqual({ ok: false, status: 401 });
    expect(await checkApiAccess({ enabled: true, smokeToken: "", presentedToken: "", getUser: async () => null })).toEqual({ ok: false, status: 401 });
  });
});
