import { describe, expect, it } from "vitest";
import { normalisePath, paneKey } from "./pane";

describe("paneKey", () => {
  it("normalises separators, case and trailing slashes", () => {
    expect(normalisePath("C:\\mw\\Visualiser\\")).toBe("c:/mw/visualiser");
    expect(normalisePath("/home/me/repo")).toBe("/home/me/repo");
    expect(normalisePath("/")).toBe("/");
  });

  it("hashes to 16 hex characters, stable for equivalent paths", () => {
    const a = paneKey("C:\\mw\\visualiser");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(paneKey("c:/mw/visualiser/")).toBe(a);
    expect(paneKey("c:/mw/other")).not.toBe(a);
  });

  it("matches the reference FNV-1a 64 value for an ASCII path", () => {
    // FNV-1a 64 of the bytes of "a" is af63dc4c8601ec8c.
    expect(paneKey("a")).toBe("af63dc4c8601ec8c");
  });

  it("does not contain the path", () => {
    expect(paneKey("c:/mw/visualiser")).not.toContain("visualiser");
  });
});
