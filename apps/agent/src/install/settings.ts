import type { WrappedStatusLine } from "../config";

export type JsonObject = Record<string, unknown>;

/** The events the agent models (spec §9.2). MessageDisplay and Notification carry content and change no state. */
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
] as const;

/** Seconds. Claude Code's default is 600, which would let a hung agent stall a session. */
export const HOOK_TIMEOUT_S = 2;
export const HOOK_SCRIPT = "clawd-hook.mjs";
export const STATUS_SCRIPT = "clawd-statusline.mjs";
export const HOOK_SCRIPTS = ["clawd-lib.mjs", HOOK_SCRIPT, STATUS_SCRIPT] as const;
export const TOKEN_HEADER = "x-clawd-token";

const OUR_HOOK_URL = /^http:\/\/127\.0\.0\.1:\d+\/ingest\/hook$/;

/** Settings whose shape the installer will not guess at. The message is the path, never a value. */
export class SettingsShapeError extends Error {
  override readonly name = "SettingsShapeError";
}

/** `runtime` is the whole command prefix that runs a script: a quoted Node path, or the desktop's Electron prefix. */
export type InstallOptions = { port: number; token: string; binDir: string; runtime: string };
export type HookStatus = "missing" | "current" | "stale" | "unreadable";
export type InstallResult = {
  settings: JsonObject;
  /** The user's status line, when this install wrapped it; null when there was none or it was already ours. */
  newlyWrapped: WrappedStatusLine | null;
  statusLine: "wrapped" | "added" | "kept";
  events: readonly string[];
};

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const forwardSlashes = (p: string): string => p.replace(/\\/g, "/");

/** The CLI's prefix: the Node binary, quoted, with forward slashes. */
export const nodeRuntime = (nodePath: string): string => `"${forwardSlashes(nodePath)}"`;

function scriptCommand(opts: InstallOptions, script: string): string {
  return `${opts.runtime} "${forwardSlashes(opts.binDir).replace(/\/+$/, "")}/${script}"`;
}

export const hookCommand = (opts: InstallOptions): string => scriptCommand(opts, HOOK_SCRIPT);
export const statusCommand = (opts: InstallOptions): string => scriptCommand(opts, STATUS_SCRIPT);

export function isOurHook(hook: unknown): boolean {
  if (!isJsonObject(hook)) return false;
  if (hook.type === "http") return typeof hook.url === "string" && OUR_HOOK_URL.test(hook.url);
  if (hook.type === "command") return typeof hook.command === "string" && hook.command.includes(HOOK_SCRIPT);
  return false;
}

export function isOurStatusLine(value: unknown): boolean {
  return isJsonObject(value) && typeof value.command === "string" && value.command.includes(STATUS_SCRIPT);
}

/** What identifies one of our hooks: its kind, where it points, the token it carries and its timeout. */
function hookKey(hook: JsonObject): string {
  const headers = isJsonObject(hook.headers) ? hook.headers : {};
  return JSON.stringify([hook.type, hook.url ?? hook.command ?? null, headers[TOKEN_HEADER] ?? null, hook.timeout ?? null]);
}

/** Our hooks in a settings file, keyed by event, and our status line's command; empty and null when absent. */
function ourInstalled(settings: JsonObject): { byEvent: Map<string, Set<string>>; status: string | null } {
  const byEvent = new Map<string, Set<string>>();
  if (isJsonObject(settings.hooks)) {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue;
        for (const hook of group.hooks) {
          if (!isOurHook(hook)) continue;
          const keys = byEvent.get(event) ?? new Set<string>();
          keys.add(hookKey(hook as JsonObject));
          byEvent.set(event, keys);
        }
      }
    }
  }
  const status = isOurStatusLine(settings.statusLine) ? (settings.statusLine as { command: string }).command : null;
  return { byEvent, status };
}

/**
 * Whether the settings file already holds everything an install with these options would write: the
 * http hook for each event with its port and token, the SessionStart command, and the status line.
 * `stale` is ours present with any part different or missing: a moved folder, an edited port, a
 * recreated token, or a status line removed by hand. `unreadable` is decided by the caller, which
 * reads the file. Hooks that are not ours are ignored.
 */
export function hookStatus(settings: JsonObject | null, opts: InstallOptions): HookStatus {
  if (settings === null) return "missing";
  const have = ourInstalled(settings);
  if (have.byEvent.size === 0 && have.status === null) return "missing";
  const want = ourInstalled(applyInstall({}, opts).settings);
  if (have.status !== want.status || have.byEvent.size !== want.byEvent.size) return "stale";
  for (const [event, keys] of want.byEvent) {
    const installed = have.byEvent.get(event);
    if (installed === undefined || installed.size !== keys.size) return "stale";
    for (const key of keys) if (!installed.has(key)) return "stale";
  }
  return "current";
}

/** Remove our hooks; drop groups and events that only we filled. Anything else is left as found. */
function withoutOurHooks(hooks: JsonObject): JsonObject {
  const pairs: [string, unknown][] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      pairs.push([event, groups]);
      continue;
    }
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!isJsonObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const inner = (group.hooks as unknown[]).filter((hook) => !isOurHook(hook));
      if (inner.length === group.hooks.length) kept.push(group);
      else if (inner.length > 0) kept.push({ ...group, hooks: inner });
    }
    if (kept.length > 0 || groups.length === 0) pairs.push([event, kept]);
  }
  return Object.fromEntries(pairs);
}

export function applyInstall(settings: JsonObject, opts: InstallOptions): InstallResult {
  const current = settings.hooks;
  if (current !== undefined && !isJsonObject(current)) throw new SettingsShapeError("hooks");
  const hooks = withoutOurHooks(current ?? {});
  const http = { type: "http", url: `http://127.0.0.1:${opts.port}/ingest/hook`, headers: { [TOKEN_HEADER]: opts.token }, timeout: HOOK_TIMEOUT_S };
  for (const event of HOOK_EVENTS) {
    const existing = hooks[event];
    if (existing !== undefined && !Array.isArray(existing)) throw new SettingsShapeError(`hooks.${event}`);
    const groups: unknown[] = Array.isArray(existing) ? existing : [];
    const ours = event === "SessionStart" ? [http, { type: "command", command: hookCommand(opts), timeout: HOOK_TIMEOUT_S }] : [http];
    hooks[event] = [...groups, { hooks: ours }];
  }

  const line = settings.statusLine;
  if (line !== undefined && !isJsonObject(line)) throw new SettingsShapeError("statusLine");
  let newlyWrapped: WrappedStatusLine | null = null;
  let statusLine: InstallResult["statusLine"] = "added";
  if (isJsonObject(line)) {
    if (isOurStatusLine(line)) {
      statusLine = "kept";
    } else {
      if (typeof line.command !== "string" || line.command.length === 0) throw new SettingsShapeError("statusLine.command");
      newlyWrapped = { ...line, command: line.command };
      statusLine = "wrapped";
    }
  }
  const nextStatusLine = { ...(isJsonObject(line) ? line : {}), type: "command", command: statusCommand(opts) };
  return { settings: { ...settings, hooks, statusLine: nextStatusLine }, newlyWrapped, statusLine, events: HOOK_EVENTS };
}

export function applyUninstall(settings: JsonObject, wrapped: WrappedStatusLine | undefined): JsonObject {
  const out: JsonObject = { ...settings };
  if (settings.hooks !== undefined) {
    if (!isJsonObject(settings.hooks)) throw new SettingsShapeError("hooks");
    const hooks = withoutOurHooks(settings.hooks);
    if (Object.keys(hooks).length === 0 && Object.keys(settings.hooks).length > 0) delete out.hooks;
    else out.hooks = hooks;
  }
  if (isOurStatusLine(settings.statusLine)) {
    if (wrapped) out.statusLine = wrapped;
    else delete out.statusLine;
  }
  return out;
}
