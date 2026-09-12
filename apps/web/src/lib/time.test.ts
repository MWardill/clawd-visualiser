import { describe, expect, it } from "vitest";
import { hhmmss } from "./time";

describe("hhmmss", () => {
  it("formats local wall-clock time with two digits each", () => {
    expect(hhmmss(new Date(2026, 8, 12, 9, 5, 7))).toBe("09:05:07");
    expect(hhmmss(new Date(2026, 8, 12, 23, 59, 59).getTime())).toBe("23:59:59");
  });

  it("shows dashes for a timestamp that does not parse", () => {
    expect(hhmmss("not a date")).toBe("--:--:--");
  });
});
