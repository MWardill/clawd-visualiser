import { describe, expect, it } from "vitest";
import { DEFAULT_DEV_URL, ownArgs, parseArgs, resolveDevUrl } from "./args";

describe("parseArgs", () => {
  it("reads --hidden and --dev-url in both spellings, ignoring anything else", () => {
    expect(parseArgs([])).toEqual({ hidden: false, devUrl: null });
    expect(parseArgs(["--hidden"])).toEqual({ hidden: true, devUrl: null });
    expect(parseArgs(["--dev-url", "http://localhost:3001"])).toEqual({ hidden: false, devUrl: "http://localhost:3001" });
    expect(parseArgs(["--dev-url=http://localhost:3001", "--hidden", "--other"])).toEqual({ hidden: true, devUrl: "http://localhost:3001" });
    expect(parseArgs(["--dev-url"])).toEqual({ hidden: false, devUrl: null });
    expect(parseArgs(["--dev-url="])).toEqual({ hidden: false, devUrl: null });
  });
});

describe("ownArgs", () => {
  it("drops the executable, and the app path too in development", () => {
    expect(ownArgs(["C:/app/Clawd Visualiser.exe", "--hidden"], true)).toEqual(["--hidden"]);
    expect(ownArgs(["C:/x/electron.exe", ".", "--hidden"], false)).toEqual(["--hidden"]);
    expect(ownArgs(["C:/x/electron.exe"], false)).toEqual([]);
  });
});

describe("resolveDevUrl", () => {
  it("prefers the flag, then the environment, then the Next dev server", () => {
    expect(resolveDevUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" })).toBe("http://a");
    expect(resolveDevUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "http://b" })).toBe("http://b");
    expect(resolveDevUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "  " })).toBe(DEFAULT_DEV_URL);
    expect(resolveDevUrl({ hidden: false, devUrl: null }, {})).toBe("http://localhost:3000");
  });
});
