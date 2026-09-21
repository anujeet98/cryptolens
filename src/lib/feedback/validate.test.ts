import { describe, expect, it } from "vitest";
import { LIMITS, parseFeedback } from "./validate";

const ok = { kind: "feature", title: "Dark mode charts", body: "Please add a light theme option too." };

describe("parseFeedback", () => {
  it("accepts a valid idea and trims it", () => {
    const r = parseFeedback({ ...ok, title: "  Dark mode charts  ", page: "/" });
    expect(r).toEqual({ ok: true, value: { kind: "feature", title: "Dark mode charts", body: ok.body, page: "/" } });
  });
  it("rejects non-objects and unknown kinds", () => {
    for (const v of [null, undefined, "x", 5, []]) expect(parseFeedback(v).ok).toBe(false);
    expect(parseFeedback({ ...ok, kind: "spam" }).ok).toBe(false);
    expect(parseFeedback({ ...ok, kind: 3 }).ok).toBe(false);
  });
  it("requires a title for ideas and bugs but not for messages", () => {
    expect(parseFeedback({ ...ok, title: "" }).ok).toBe(false);
    expect(parseFeedback({ ...ok, kind: "bug", title: "ab" }).ok).toBe(false);
    expect(parseFeedback({ kind: "message", body: "Hello, quick question about alerts." }).ok).toBe(true);
  });
  it("enforces body and title length limits", () => {
    expect(parseFeedback({ ...ok, body: "short" }).ok).toBe(false);
    expect(parseFeedback({ ...ok, body: "x".repeat(LIMITS.bodyMax + 1) }).ok).toBe(false);
    expect(parseFeedback({ ...ok, body: "x".repeat(LIMITS.bodyMax) }).ok).toBe(true);
    expect(parseFeedback({ ...ok, title: "t".repeat(LIMITS.titleMax + 1) }).ok).toBe(false);
  });
  it("strips control characters, normalises newlines, and flattens the title", () => {
    const r = parseFeedback({ ...ok, title: "Multi\nline\u0007 title", body: "line one\r\nline two\u0000 here" });
    expect(r.ok && r.value.title).toBe("Multi line title");
    expect(r.ok && r.value.body).toBe("line one\nline two here");
  });
  it("keeps only a same-site path for the page, without query or hash", () => {
    const page = (p: unknown) => { const r = parseFeedback({ ...ok, page: p }); return r.ok ? r.value.page : "ERR"; };
    expect(page("/account?token=abc#x")).toBe("/account");
    expect(page("https://evil.example/")).toBe("");
    expect(page("//evil.example")).toBe("");
    expect(page(42)).toBe("");
    expect(page(undefined)).toBe("");
  });
  it("treats the body as inert text: markup is kept verbatim, never interpreted", () => {
    const r = parseFeedback({ ...ok, body: "<script>alert(1)</script> is not run here" });
    expect(r.ok && r.value.body).toContain("<script>");
  });
});
