import { describe, expect, it } from "vitest";
import { expectedCommands, repairOnLaunch, runtimePrefix } from "./hooks";

const BIN = "C:\\Users\\me\\.clawd\\bin";

describe("runtimePrefix", () => {
  it("runs the app's own binary as Node, quoted, with forward slashes", () => {
    expect(runtimePrefix("C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe")).toBe('ELECTRON_RUN_AS_NODE=1 "C:/Apps/Clawd Visualiser/Clawd Visualiser.exe"');
  });
});

describe("expectedCommands", () => {
  it("are the hook and status line commands an install would write", () => {
    const runtime = runtimePrefix("C:\\Apps\\app.exe");
    expect(expectedCommands({ runtime, binDir: BIN, port: 4750, token: "a".repeat(64) })).toEqual({
      hook: `${runtime} "C:/Users/me/.clawd/bin/clawd-hook.mjs"`,
      status: `${runtime} "C:/Users/me/.clawd/bin/clawd-statusline.mjs"`,
    });
  });
});

describe("repairOnLaunch", () => {
  it("rewrites only hooks of ours that point somewhere else, and only from the packaged app", () => {
    expect(repairOnLaunch("stale", true)).toBe(true);
    expect(repairOnLaunch("current", true)).toBe(false);
    expect(repairOnLaunch("missing", true)).toBe(false);
    expect(repairOnLaunch("stale", false)).toBe(false);
  });
});
