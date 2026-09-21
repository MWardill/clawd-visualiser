import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ownArgs, parseArgs, resolveRendererUrl } from "./args";

describe("parseArgs", () => {
  it("reads --hidden and --dev-url in both spellings, ignoring anything else", () => {
    expect(parseArgs([])).toEqual({ hidden: false, devUrl: null });
    expect(parseArgs(["--hidden"])).toEqual({ hidden: true, devUrl: null });
    expect(parseArgs(["--dev-url", "http://localhost:3001"])).toEqual({ hidden: false, devUrl: "http://localhost:3001" });
    expect(parseArgs(["--dev-url=http://localhost:3001", "--hidden", "--other"])).toEqual({ hidden: true, devUrl: "http://localhost:3001" });
    expect(parseArgs(["--dev-url"])).toEqual({ hidden: false, devUrl: null });
    expect(parseArgs(["--dev-url="])).toEqual({ hidden: false, devUrl: null });
    expect(parseArgs(["--dev-url", "http://localhost:3000", "--dev-url", "http://localhost:3001"])).toEqual({ hidden: false, devUrl: "http://localhost:3001" });
  });
});

describe("ownArgs", () => {
  it("drops the executable, and the app path too in development", () => {
    expect(ownArgs(["C:/app/Clawd Visualiser.exe", "--hidden"], true)).toEqual(["--hidden"]);
    expect(ownArgs(["C:/x/electron.exe", ".", "--hidden"], false)).toEqual(["--hidden"]);
    expect(ownArgs(["C:/x/electron.exe"], false)).toEqual([]);
  });
});

describe("resolveRendererUrl", () => {
  const EXPORT = "app://clawd/";

  it("in development, prefers the flag, then the environment, then the export's URL it was given", () => {
    expect(resolveRendererUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" }, false, EXPORT)).toBe("http://a");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "http://b" }, false, EXPORT)).toBe("http://b");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "  " }, false, EXPORT)).toBe(EXPORT);
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, {}, false, EXPORT)).toBe(EXPORT);
  });

  it("packaged, loads the export whatever the flag or the environment says", () => {
    expect(resolveRendererUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" }, true, EXPORT)).toBe(EXPORT);
  });
});

describe("args.ts", () => {
  it("imports nothing, so the argument parser pulls no schema library or file system into itself", async () => {
    expect(await readFile(new URL("./args.ts", import.meta.url), "utf8")).not.toMatch(/^\s*import\s/m);
  });
});
