import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { distPaths } from "./paths";

describe("distPaths", () => {
  it("names the four directories beside the bundle", () => {
    const dist = join("C:", "app", "dist");
    expect(distPaths(dist)).toEqual({
      renderer: join(dist, "renderer"),
      tray: join(dist, "tray"),
      settings: join(dist, "settings"),
      hooks: join(dist, "hooks"),
    });
  });
});
