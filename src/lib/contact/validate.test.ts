import { describe, expect, it } from "vitest";
import { allowedOrigins, originAllowed, parseContact } from "./validate";

const ok = { name: "Asha", email: "asha@example.com", message: "How do I connect my exchange account?" };

describe("parseContact", () => {
  it("accepts a valid request and trims it", () => {
    expect(parseContact({ ...ok, name: "  Asha  " })).toEqual({ ok: true, value: ok });
  });
  it("name is optional", () => {
    expect(parseContact({ ...ok, name: undefined }).ok).toBe(true);
  });
  it("requires a plausible email", () => {
    for (const email of ["", "nope", "a@b", "a b@c.com", "<x@y.com>", "a@b.c", 5, undefined]) expect(parseContact({ ...ok, email }).ok).toBe(false);
    expect(parseContact({ ...ok, email: "x".repeat(200) + "@example.com" }).ok).toBe(false);
  });
  it("enforces message and name length", () => {
    expect(parseContact({ ...ok, message: "short" }).ok).toBe(false);
    expect(parseContact({ ...ok, message: "m".repeat(2001) }).ok).toBe(false);
    expect(parseContact({ ...ok, message: "m".repeat(2000) }).ok).toBe(true);
    expect(parseContact({ ...ok, name: "n".repeat(81) }).ok).toBe(false);
  });
  it("a filled honeypot is flagged as spam, not as an error", () => {
    const r = parseContact({ ...ok, website: "http://spam.example" });
    expect(r).toEqual({ ok: true, spam: true });
  });
  it("an empty or whitespace honeypot is fine", () => {
    expect(parseContact({ ...ok, website: "   " }).ok).toBe(true);
    const r = parseContact({ ...ok, website: "" });
    expect(r.ok && !("spam" in r)).toBe(true);
  });
  it("rejects non-objects", () => {
    for (const v of [null, undefined, "x", 3]) expect(parseContact(v).ok).toBe(false);
  });
  it("strips control characters and flattens the name", () => {
    const r = parseContact({ ...ok, name: "A\nsha\u0007", message: "line one\r\nline two\u0000 here ok" });
    expect(r.ok && r.value?.name).toBe("A sha");
    expect(r.ok && r.value?.message).toBe("line one\nline two here ok");
  });
});

describe("origins", () => {
  it("uses CONTACT_ALLOWED_ORIGINS and the landing origin, normalised", () => {
    expect(allowedOrigins({ CONTACT_ALLOWED_ORIGINS: "https://a.example/, junk", NEXT_PUBLIC_HOME_URL: "https://site.example/path" })).toEqual(["https://a.example", "https://site.example"]);
    expect(allowedOrigins({})).toEqual([]);
  });
  it("allows a listed origin and no-origin callers, refuses others", () => {
    const env = { NEXT_PUBLIC_HOME_URL: "https://site.example" };
    expect(originAllowed("https://site.example", env)).toBe(true);
    expect(originAllowed(null, env)).toBe(true);
    expect(originAllowed("https://evil.example", env)).toBe(false);
    expect(originAllowed("https://site.example.evil.com", env)).toBe(false);
    expect(originAllowed("https://anything.example", {})).toBe(false);
  });
});
