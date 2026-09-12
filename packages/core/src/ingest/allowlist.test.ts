import { describe, expect, it } from "vitest";
import { isAllowed } from "./allowlist";

describe("isAllowed", () => {
  const list = ["C:\\mw", "/home/me/oss"];

  it("allows a directory or anything beneath it", () => {
    expect(isAllowed("C:\\mw\\visualiser", list)).toBe(true);
    expect(isAllowed("c:/mw", list)).toBe(true);
    expect(isAllowed("/home/me/oss/thing/sub", list)).toBe(true);
  });

  it("rejects siblings, prefixes that are not path segments, and everything when the list is empty", () => {
    expect(isAllowed("C:\\git\\b2b", list)).toBe(false);
    expect(isAllowed("C:\\mwx\\repo", list)).toBe(false);
    expect(isAllowed("C:\\mw\\visualiser", [])).toBe(false);
  });

  it("ignores empty or blank entries instead of admitting every path", () => {
    expect(isAllowed("/home/me/x", [""])).toBe(false);
    expect(isAllowed("/home/me/x", ["  "])).toBe(false);
    expect(isAllowed("C:\\mw\\x", ["", " C:\\mw "])).toBe(true);
  });

  it("admits everything beneath a root entry", () => {
    expect(isAllowed("/home/me/x", ["/"])).toBe(true);
    expect(isAllowed("/", ["/"])).toBe(true);
    expect(isAllowed("C:\\mw\\x", ["C:\\"])).toBe(true);
  });
});
