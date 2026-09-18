import { normalisePath } from "@clawd/core";
import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { request } from "node:http";
import { join, parse, resolve } from "node:path";
import { agentPaths, defaultConfig, readConfig, saveConfig, type AgentConfig } from "../config";
import { isErrno, readJsonFile, writeJsonAtomic } from "../json-file";
import { fileStamp } from "../stamp";
import { HOOK_SCRIPTS, SettingsShapeError, applyInstall, applyUninstall, isJsonObject, type InstallResult, type JsonObject } from "./settings";

export type Print = (line: string) => void;

export type InstallRequest = {
  home: string;
  settingsPath: string;
  allow: readonly string[];
  port?: number;
  dryRun: boolean;
  /** Where the hook scripts are copied from: apps/agent/hooks. */
  hooksDir: string;
  /** The directory the command was typed in, for relative --allow values. */
  cwd: string;
  /** The command prefix the written hooks run. */
  runtime: string;
  now: () => number;
  print: Print;
  probe?: (port: number) => Promise<boolean>;
};

export function mergeAllowlist(existing: readonly string[], additions: readonly string[], cwd: string): { ok: true; allowlist: string[] } | { ok: false; message: string } {
  const merged = [...existing];
  for (const raw of additions) {
    const trimmed = raw.trim();
    if (trimmed === "") return { ok: false, message: "an --allow directory is blank" };
    const dir = resolve(cwd, trimmed);
    if (parse(dir).root === dir) return { ok: false, message: `refusing to allow a whole filesystem root: ${dir}` };
    if (!merged.some((d) => normalisePath(d) === normalisePath(dir))) merged.push(dir);
  }
  if (merged.length === 0) return { ok: false, message: "the allowlist is empty; pass --allow <dir> for each directory whose sessions should appear" };
  return { ok: true, allowlist: merged };
}

/** True when something answers GET /api/health on the port within the timeout. */
export function probeAgent(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((done) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs }, (res) => {
      res.resume();
      done(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      done(false);
    });
    req.on("error", () => done(false));
    req.end();
  });
}

type SettingsRead = { kind: "missing" } | { kind: "invalid" } | { kind: "ok"; value: JsonObject };

async function readSettings(path: string): Promise<SettingsRead> {
  const file = await readJsonFile(path);
  if (!file.found) return { kind: "missing" };
  return file.ok && isJsonObject(file.value) ? { kind: "ok", value: file.value } : { kind: "invalid" };
}

/** Copy the file beside itself under a name no earlier backup has taken. */
async function backup(path: string, now: number): Promise<string> {
  const base = `${path}.clawd-backup-${fileStamp(now)}`;
  for (let n = 1; ; n++) {
    const target = n === 1 ? base : `${base}-${n}`;
    try {
      await copyFile(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (err) {
      if (!isErrno(err, "EEXIST")) throw err;
    }
  }
}

const STATUS_WORDS: Record<InstallResult["statusLine"], string> = {
  wrapped: "wrap the existing status line",
  added: "add a status line",
  kept: "keep the Clawd status line already installed",
};

const STATUS_DONE: Record<InstallResult["statusLine"], string> = {
  wrapped: "wrapped the existing status line",
  added: "added a status line",
  kept: "kept the Clawd status line already installed",
};

export type AllowlistRequest = {
  home: string;
  /** Directories to add, resolved against `cwd`. */
  add?: readonly string[];
  /** A directory to remove, compared after normalising. */
  remove?: string;
  cwd: string;
  port?: number;
};
export type AllowlistResult = { ok: true; allowlist: string[] } | { ok: false; message: string };

/** Drop a directory from an allowlist, comparing the way the agent does. */
export function removeFromAllowlist(existing: readonly string[], dir: string): string[] {
  return existing.filter((d) => normalisePath(d) !== normalisePath(dir));
}

/**
 * Saves the allowlist, and the port when one is given. The agent reads the config at startup.
 *
 * An empty result is refused only when `add` is asking to add directories (via `mergeAllowlist`'s
 * own guard); watching no folders at all is a legitimate thing to save here, e.g. the settings
 * window removing the last one. `install()` is the one place a caller must have at least one
 * folder, and it enforces that itself before calling this.
 */
export async function setAllowlist(req: AllowlistRequest): Promise<AllowlistResult> {
  const paths = agentPaths(req.home);
  const base: AgentConfig = (await readConfig(paths)) ?? defaultConfig();
  const starting = req.remove === undefined ? base.allowlist : removeFromAllowlist(base.allowlist, req.remove);
  const result: AllowlistResult = req.add !== undefined && req.add.length > 0 ? mergeAllowlist(starting, req.add, req.cwd) : { ok: true, allowlist: starting };
  if (!result.ok) return result;
  await saveConfig(paths, { ...base, port: req.port ?? base.port, allowlist: result.allowlist });
  return result;
}

export type HooksRequest = {
  home: string;
  settingsPath: string;
  /** The command prefix the written hooks run: a Node path, or the desktop's Electron prefix. */
  runtime: string;
  /** Where the hook scripts are copied from: apps/agent/hooks, or the app's resources/hooks. */
  hooksDir: string;
  port?: number;
  /** An allowlist to save with the port, when the caller has merged one; otherwise the config's stays. */
  allowlist?: readonly string[];
  dryRun?: boolean;
  now: () => number;
};
export type HooksResult = { ok: true; statusLine: InstallResult["statusLine"]; events: readonly string[]; backup: string | null; port: number } | { ok: false; message: string };

/**
 * Validates the settings file, copies the scripts to `<home>/bin`, saves the config, then writes the
 * settings file with a backup of what was there. In that order: a settings file that cannot be used
 * changes nothing, and a copy that fails leaves the config as it was. The config is saved before the
 * settings file so the token the new hooks carry is on disk before they exist. A settings file that
 * already holds exactly what would be written is left alone, with no backup.
 */
export async function installHooks(req: HooksRequest): Promise<HooksResult> {
  const paths = agentPaths(req.home);
  const base: AgentConfig = (await readConfig(paths)) ?? defaultConfig();
  const port = req.port ?? base.port;
  const read = await readSettings(req.settingsPath);
  if (read.kind === "invalid") return { ok: false, message: `${req.settingsPath} is not a JSON object; nothing was changed` };
  let result: InstallResult;
  try {
    result = applyInstall(read.kind === "ok" ? read.value : {}, { port, token: base.token, binDir: paths.bin, runtime: req.runtime });
  } catch (err) {
    if (!(err instanceof SettingsShapeError)) throw err;
    return { ok: false, message: `${req.settingsPath} has an unexpected shape at ${err.message}; nothing was changed` };
  }
  if (req.dryRun === true) return { ok: true, statusLine: result.statusLine, events: result.events, backup: null, port };

  await mkdir(paths.bin, { recursive: true });
  for (const script of HOOK_SCRIPTS) await copyFile(join(req.hooksDir, script), join(paths.bin, script));
  const wrapped = result.statusLine === "wrapped" ? result.newlyWrapped : result.statusLine === "kept" ? base.wrappedStatusLine : undefined;
  const { wrappedStatusLine: _wrapped, ...baseWithoutWrapped } = base;
  await saveConfig(paths, { ...baseWithoutWrapped, port, allowlist: req.allowlist === undefined ? base.allowlist : [...req.allowlist], ...(wrapped ? { wrappedStatusLine: wrapped } : {}) });
  const unchanged = read.kind === "ok" && JSON.stringify(read.value) === JSON.stringify(result.settings);
  if (unchanged) return { ok: true, statusLine: result.statusLine, events: result.events, backup: null, port };
  const saved = read.kind === "ok" ? await backup(req.settingsPath, req.now()) : null;
  await writeJsonAtomic(req.settingsPath, result.settings);
  return { ok: true, statusLine: result.statusLine, events: result.events, backup: saved, port };
}

/** The CLI's install: the allowlist merged, then one installHooks call, then the report the user reads. */
export async function install(req: InstallRequest): Promise<number> {
  // The command, unlike setAllowlist, insists on at least one folder: an empty --allow with an empty
  // (or absent) config means the user named nothing to watch.
  const existing = (await readConfig(agentPaths(req.home)))?.allowlist ?? [];
  const merged = mergeAllowlist(existing, req.allow, req.cwd);
  if (!merged.ok) {
    req.print(merged.message);
    return 1;
  }
  const hooks = await installHooks({
    home: req.home,
    settingsPath: req.settingsPath,
    runtime: req.runtime,
    hooksDir: req.hooksDir,
    ...(req.port === undefined ? {} : { port: req.port }),
    allowlist: merged.allowlist,
    dryRun: req.dryRun,
    now: req.now,
  });
  if (!hooks.ok) {
    req.print(hooks.message);
    return 1;
  }
  if (req.dryRun) {
    req.print(`dry run: would add hooks to ${req.settingsPath} for ${hooks.events.join(", ")}`);
    req.print(`dry run: would ${STATUS_WORDS[hooks.statusLine]}`);
    req.print(`dry run: the allowlist would be ${merged.allowlist.join(", ")}`);
    return 0;
  }
  req.print(`installed the Clawd hooks into ${req.settingsPath}; ${STATUS_DONE[hooks.statusLine]}`);
  req.print(hooks.backup ? `backup of the previous settings: ${hooks.backup}` : "the settings already held these hooks, or there were none to back up");
  req.print(`allowlist: ${merged.allowlist.join(", ")}`);
  const running = await (req.probe ?? probeAgent)(hooks.port);
  req.print(running ? `an agent is running on port ${hooks.port}; restart it to pick up these changes` : "start the agent with: pnpm --filter @clawd/agent start");
  return 0;
}

export type UninstallRequest = { home: string; settingsPath: string; now: () => number };
export type UninstallResult =
  | { ok: true; outcome: "missing" | "nothing" | "removed"; backup: string | null }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "shape"; at: string };

/** Removes our hooks and puts a wrapped status line back. The result says what was found; nothing is printed. */
export async function uninstallHooks(req: UninstallRequest): Promise<UninstallResult> {
  const paths = agentPaths(req.home);
  const config = await readConfig(paths);
  const read = await readSettings(req.settingsPath);
  if (read.kind === "missing") return { ok: true, outcome: "missing", backup: null };
  if (read.kind === "invalid") return { ok: false, reason: "invalid" };
  let next: JsonObject;
  try {
    next = applyUninstall(read.value, config?.wrappedStatusLine);
  } catch (err) {
    if (!(err instanceof SettingsShapeError)) throw err;
    return { ok: false, reason: "shape", at: err.message };
  }
  if (JSON.stringify(next) === JSON.stringify(read.value)) return { ok: true, outcome: "nothing", backup: null };
  const saved = await backup(req.settingsPath, req.now());
  await writeJsonAtomic(req.settingsPath, next);
  if (config?.wrappedStatusLine) {
    const { wrappedStatusLine: _wrapped, ...rest } = config;
    await saveConfig(paths, rest);
  }
  return { ok: true, outcome: "removed", backup: saved };
}

/** The CLI's uninstall: the result above, printed. */
export async function uninstall(req: UninstallRequest & { print: Print }): Promise<number> {
  const result = await uninstallHooks(req);
  if (!result.ok) {
    req.print(result.reason === "invalid" ? `${req.settingsPath} is not a JSON object; nothing was changed` : `${req.settingsPath} has an unexpected shape at ${result.at}; nothing was changed`);
    return 1;
  }
  if (result.outcome === "missing") req.print(`${req.settingsPath} does not exist; nothing to uninstall`);
  else if (result.outcome === "nothing") req.print("no Clawd hooks or status line were found; nothing was changed");
  else {
    req.print(`removed the Clawd hooks from ${req.settingsPath}`);
    req.print(`backup of the previous settings: ${result.backup}`);
    req.print(`${agentPaths(req.home).home} was left in place`);
  }
  return 0;
}
