// Shared by the Clawd visualiser's Claude Code hook scripts. No dependencies: the installer copies
// these files to ~/.clawd/bin and they must run without this repository. Nothing here prints, logs
// or stores the payload it forwards; the agent redacts it at ingest.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";

export const POST_TIMEOUT_MS = 250;

/** Port and token from ../config.json beside the installed scripts, or null when unusable. */
export function readConfig(url = new URL("../config.json", import.meta.url)) {
  try {
    const config = JSON.parse(readFileSync(url, "utf8"));
    return config && Number.isInteger(config.port) && typeof config.token === "string" ? config : null;
  } catch {
    return null;
  }
}

export function readStdin(stream = process.stdin) {
  return new Promise((resolve) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

/** POST a body to the agent. Resolves on response, error or timeout; never rejects. */
export function post(config, path, body, timeoutMs = POST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      resolve();
      return;
    }
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    try {
      const req = request(
        { host: "127.0.0.1", port: config.port, path, method: "POST", headers: { "content-type": "application/json", "content-length": body.length, "x-clawd-token": config.token } },
        (res) => {
          res.resume();
          res.on("end", finish);
          res.on("error", finish);
        },
      );
      timer = setTimeout(() => {
        req.destroy();
        finish();
      }, timeoutMs);
      req.on("error", finish);
      req.end(body);
    } catch {
      finish();
    }
  });
}

/** The line shown when no wrapped status line produced one. */
export function defaultLine(payload) {
  const parts = ["clawd"];
  const model = payload?.model?.display_name;
  if (typeof model === "string" && model.length > 0) parts.push(model);
  const pct = payload?.context_window?.used_percentage;
  if (typeof pct === "number" && Number.isFinite(pct)) parts.push(`ctx ${Math.round(pct)}%`);
  return parts.join(" · ");
}

/**
 * Claude Code runs status lines through Git Bash on Windows, so a user's command may be bash. A bare
 * `bash` from PATH is avoided on Windows because it can be WSL's, which cannot run Windows paths.
 */
function bashPath() {
  const candidates = process.platform === "win32"
    ? [process.env.CLAUDE_CODE_GIT_BASH_PATH, "C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]
    : ["/bin/bash"];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  return null;
}

function runOnce(file, args, shell, input, timeoutMs) {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    let timer = null;
    const finish = (output) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(output);
    };
    let child;
    try {
      child = spawn(file, args, { shell, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      finish(null);
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    child.on("error", () => finish(null));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("close", (code) => finish(code === 0 && out.trim().length > 0 ? out : null));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Run the user's previous status line with the same stdin: its stdout, or null if it failed. */
export function runWrapped(command, input, timeoutMs = 5000) {
  const bash = bashPath();
  return bash ? runOnce(bash, ["-c", command], false, input, timeoutMs) : runOnce(command, [], true, input, timeoutMs);
}
