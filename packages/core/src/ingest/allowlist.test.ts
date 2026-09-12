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
});
