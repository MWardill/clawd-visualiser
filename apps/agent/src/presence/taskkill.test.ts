import { describe, expect, it } from "vitest";
import { taskkillPath } from "./taskkill";

describe("taskkillPath", () => {
  it("is taskkill.exe under System32 of the system root, never a bare name Windows would search for", () => {
    expect(taskkillPath({ SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\taskkill.exe");
    expect(taskkillPath({ windir: "E:\\Windows" })).toBe("E:\\Windows\\System32\\taskkill.exe");
    expect(taskkillPath({})).toBe("C:\\Windows\\System32\\taskkill.exe");
  });
});
