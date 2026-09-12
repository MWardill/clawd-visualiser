import { describe, expect, it } from "vitest";
import { fileStamp } from "./stamp";

describe("fileStamp", () => {
  it("is UTC YYYYMMDDHHmmss", () => {
    expect(fileStamp(Date.UTC(2026, 8, 12, 7, 5, 9, 999))).toBe("20260912070509");
  });
});
