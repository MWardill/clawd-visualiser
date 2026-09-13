import { spawn } from "node:child_process";
import type { LogCode, Logger } from "../log";
import type { PresencePoller } from "../presence/poller";
import { FOCUS_SCRIPT } from "./focus-script";

export type FocusResult = "raised" | "flashed" | "noWindow" | "failed";
export type RunFocusScript = (target: { pid: number; folder: string }) => Promise<FocusResult>;

export const FOCUS_TIMEOUT_MS = 10_000;

const RESULT_CODES: Readonly<Record<FocusResult, LogCode>> = {
  raised: "focus.raised",
  flashed: "focus.flashed",
  noWindow: "focus.noWindow",
  failed: "focus.failed",
};

export function folderName(cwd: string): string {
  return cwd.split(/[\\/]+/).filter((part) => part.length > 0).at(-1) ?? "";
}

export function exitToResult(code: number | null): FocusResult {
  return code === 0 ? "raised" : code === 2 ? "flashed" : code === 3 ? "noWindow" : "failed";
}

export function encodeScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Runs the constant script with the target in the environment; its output is discarded. */
export const powershellFocus: RunFocusScript = ({ pid, folder }) =>
  new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: FocusResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(result);
    };
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodeScript(FOCUS_SCRIPT)], {
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, CLAWD_FOCUS_PID: String(pid), CLAWD_FOCUS_FOLDER: folder },
    });
    timer = setTimeout(() => {
      child.kill();
      finish("failed");
    }, FOCUS_TIMEOUT_MS);
    child.on("error", () => finish("failed"));
    child.on("exit", (code) => finish(exitToResult(code)));
  });

/** Focus a session's window by session id (spec §10). Never throws. */
export function createFocus(deps: { poller: Pick<PresencePoller, "lookup" | "pollOnce">; run: RunFocusScript; platform: NodeJS.Platform; log: Logger }): (sessionId: string) => Promise<void> {
  return async (sessionId) => {
    if (deps.platform !== "win32") {
      deps.log("focus.unsupported");
      return;
    }
    let target = deps.poller.lookup(sessionId);
    if (target === null) {
      await deps.poller.pollOnce();
      target = deps.poller.lookup(sessionId);
    }
    if (target === null) {
      deps.log("focus.notListed");
      return;
    }
    deps.log(RESULT_CODES[await deps.run({ pid: target.pid, folder: folderName(target.cwd) })]);
  };
}
