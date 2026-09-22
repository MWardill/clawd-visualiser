import { describe, expect, it } from "vitest";
import { distPaths } from "./paths";

describe("distPaths", () => {
  it("in development, finds everything beside the bundle", () => {
    const dir = "C:\\repo\\apps\\desktop\\dist";
    expect(distPaths(dir, dir)).toEqual({
      renderer: "C:\\repo\\apps\\desktop\\dist\\renderer",
      settings: "C:\\repo\\apps\\desktop\\dist\\settings",
      widget: "C:\\repo\\apps\\desktop\\dist\\widget",
      tray: "C:\\repo\\apps\\desktop\\dist\\tray",
      hooks: "C:\\repo\\apps\\desktop\\dist\\hooks",
      appIcon: "C:\\repo\\apps\\desktop\\dist\\tray\\app.ico",
    });
  });

  it("packaged, keeps the pages in the archive and looks for the icons and the scripts beside it", () => {
    expect(distPaths("C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist", "C:\\Apps\\Clawd Visualiser\\resources")).toEqual({
      renderer: "C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist\\renderer",
      settings: "C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist\\settings",
      widget: "C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist\\widget",
      tray: "C:\\Apps\\Clawd Visualiser\\resources\\tray",
      hooks: "C:\\Apps\\Clawd Visualiser\\resources\\hooks",
      appIcon: "C:\\Apps\\Clawd Visualiser\\resources\\tray\\app.ico",
    });
  });
});
