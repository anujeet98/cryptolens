import { describe, expect, it } from "vitest";
import { adminEmails, isAdmin, isStatus } from "./admin";

const env = { ADMIN_EMAILS: " Me@Example.com , second@example.com ,, " };

describe("isAdmin", () => {
  it("parses the list: trims, lowercases, drops blanks", () => {
    expect(adminEmails(env)).toEqual(["me@example.com", "second@example.com"]);
    expect(adminEmails({})).toEqual([]);
  });
  it("allows a listed, verified email (case-insensitive)", () => {
    expect(isAdmin({ email: "ME@example.COM", emailVerified: true }, env)).toBe(true);
  });
  it("refuses an unverified email even if it is on the list", () => {
    expect(isAdmin({ email: "me@example.com", emailVerified: false }, env)).toBe(false);
    expect(isAdmin({ email: "me@example.com" }, env)).toBe(false);
  });
  it("refuses unlisted, missing and everyone when the list is empty", () => {
    expect(isAdmin({ email: "other@example.com", emailVerified: true }, env)).toBe(false);
    expect(isAdmin(null, env)).toBe(false);
    expect(isAdmin({ email: "", emailVerified: true }, env)).toBe(false);
    expect(isAdmin({ email: "me@example.com", emailVerified: true }, {})).toBe(false);
  });
});

describe("isStatus", () => {
  it("accepts only known statuses", () => {
    expect(isStatus("planned")).toBe(true);
    expect(isStatus("deleted")).toBe(false);
    expect(isStatus(1)).toBe(false);
  });
});
