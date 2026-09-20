import { describe, expect, it } from "vitest";
import { resolveHomeUrl } from "./home";

describe("resolveHomeUrl", () => {
  it("returns null when unset or blank, so self-hosted copies show no link", () => {
    expect(resolveHomeUrl(undefined)).toBeNull();
    expect(resolveHomeUrl(null)).toBeNull();
    expect(resolveHomeUrl("")).toBeNull();
    expect(resolveHomeUrl("   ")).toBeNull();
  });
  it("accepts absolute http and https URLs and trims whitespace", () => {
    expect(resolveHomeUrl("https://example.com")).toBe("https://example.com/");
    expect(resolveHomeUrl("  https://example.com/about  ")).toBe("https://example.com/about");
    expect(resolveHomeUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });
  it("rejects anything that is not a plain web URL", () => {
    expect(resolveHomeUrl("javascript:alert(1)")).toBeNull();
    expect(resolveHomeUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(resolveHomeUrl("ftp://example.com")).toBeNull();
    expect(resolveHomeUrl("example.com")).toBeNull(); // relative/no scheme
    expect(resolveHomeUrl("not a url")).toBeNull();
  });
});
