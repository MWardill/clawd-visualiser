import { describe, expect, it } from "vitest";
import { paneName } from "./pane";

describe("paneName", () => {
  it("keeps only the last segment of a directory, as written", () => {
    expect(paneName("C:\\mw\\visualiser")).toBe("visualiser");
    expect(paneName("c:/mw/Visualiser-Agent/")).toBe("Visualiser-Agent");
    expect(paneName("/home/me/work/repo")).toBe("repo");
    expect(paneName("C:\\mw\\visualiser\\\\")).toBe("visualiser");
  });

  it("names nothing for a bare root, an empty path or an impossibly long segment", () => {
    for (const cwd of ["C:\\", "C:", "/", "", "\\\\"]) expect(paneName(cwd)).toBeNull();
    expect(paneName(`C:/work/${"x".repeat(256)}`)).toBeNull();
  });
});
