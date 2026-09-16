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
  it("rewrites only hooks of ours that point somewhere else", () => {
    expect(repairOnLaunch("stale")).toBe(true);
    expect(repairOnLaunch("current")).toBe(false);
    expect(repairOnLaunch("missing")).toBe(false);
  });
});
