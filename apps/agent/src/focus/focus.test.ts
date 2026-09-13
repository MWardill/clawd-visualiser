import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { FocusTarget } from "../presence/poller";
import { FOCUS_SCRIPT } from "./focus-script";
import { createFocus, encodeScript, exitToResult, folderName, powershellFocus, type FocusResult, type RunFocusScript } from "./focus";

describe("focus helpers", () => {
  it("takes the last segment of a directory", () => {
    expect(folderName("C:\\work\\visualiser")).toBe("visualiser");
    expect(folderName("C:\\work\\visualiser\\")).toBe("visualiser");
    expect(folderName("/home/me/proj")).toBe("proj");
    expect(folderName("")).toBe("");
  });

  it("maps the script's exit codes", () => {
    expect(exitToResult(0)).toBe("raised");
    expect(exitToResult(2)).toBe("flashed");
    expect(exitToResult(3)).toBe("noWindow");
    expect(exitToResult(1)).toBe("failed");
    expect(exitToResult(null)).toBe("failed");
  });

  it("encodes the script for -EncodedCommand as UTF-16LE base64", () => {
    expect(Buffer.from(encodeScript("exit 3"), "base64").toString("utf16le")).toBe("exit 3");
  });

  it("interpolates nothing: the script reads its inputs from the environment only", () => {
    expect(FOCUS_SCRIPT).toContain("$env:CLAWD_FOCUS_PID");
    expect(FOCUS_SCRIPT).toContain("$env:CLAWD_FOCUS_FOLDER");
  });
});

describe("createFocus", () => {
  function setup(platform: NodeJS.Platform = "win32", result: FocusResult = "raised") {
    const targets = new Map<string, FocusTarget>();
    const poller = { lookup: vi.fn((id: string) => targets.get(id) ?? null), pollOnce: vi.fn(async () => true) };
    const run = vi.fn<RunFocusScript>(async () => result);
    const log = vi.fn();
    return { targets, poller, run, log, focus: createFocus({ poller, run, platform, log }) };
  }

  it("raises a listed session's window by pid and folder name", async () => {
    const t = setup();
    t.targets.set("s1", { pid: 4242, cwd: "C:\\work\\visualiser" });
    await t.focus("s1");
    expect(t.run).toHaveBeenCalledWith({ pid: 4242, folder: "visualiser" });
    expect(t.poller.pollOnce).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledWith("focus.raised");
  });

  it("polls once when the latest poll does not have the session", async () => {
    const t = setup();
    t.poller.pollOnce.mockImplementationOnce(async () => {
      t.targets.set("s1", { pid: 7, cwd: "C:/work/repo" });
      return true;
    });
    await t.focus("s1");
    expect(t.poller.pollOnce).toHaveBeenCalledTimes(1);
    expect(t.run).toHaveBeenCalledWith({ pid: 7, folder: "repo" });
  });

  it("gives up when the session is still not listed", async () => {
    const t = setup();
    await t.focus("s1");
    expect(t.run).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledWith("focus.notListed");
  });

  it.each([
    ["flashed", "focus.flashed"],
    ["noWindow", "focus.noWindow"],
    ["failed", "focus.failed"],
  ] as const)("logs a %s result", async (result, code) => {
    const t = setup("win32", result);
    t.targets.set("s1", { pid: 1, cwd: "C:/r" });
    await t.focus("s1");
    expect(t.log).toHaveBeenCalledWith(code);
  });

  it("only logs on other platforms", async () => {
    const t = setup("linux");
    t.targets.set("s1", { pid: 1, cwd: "/r" });
    await t.focus("s1");
    expect(t.run).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledWith("focus.unsupported");
  });
});

describe.runIf(process.platform === "win32")("focus script on Windows", () => {
  it("parses without errors", () => {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:CLAWD_SCRIPT, [ref]$null, [ref]$errors); $errors.Count"],
      { env: { ...process.env, CLAWD_SCRIPT: FOCUS_SCRIPT }, encoding: "utf8", windowsHide: true },
    );
    expect(out.trim()).toBe("0");
  }, 30_000);

  it("compiles its helpers and finds no window for a process that does not exist", async () => {
    expect(await powershellFocus({ pid: 4_294_967_000, folder: "nothing-here" })).toBe("noWindow");
  }, 30_000);
});
