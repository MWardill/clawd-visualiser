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

export type UninstallRequest = { home: string; settingsPath: string; now: () => number; print: Print };

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

/** Saves the allowlist, and the port when one is given. The agent reads the config at startup. */
export async function setAllowlist(req: AllowlistRequest): Promise<AllowlistResult> {
  const paths = agentPaths(req.home);
  const base: AgentConfig = (await readConfig(paths)) ?? defaultConfig();
  const added = mergeAllowlist(req.remove === undefined ? base.allowlist : removeFromAllowlist(base.allowlist, req.remove), req.add ?? [], req.cwd);
  if (!added.ok) return added;
  await saveConfig(paths, { ...base, port: req.port ?? base.port, allowlist: added.allowlist });
  return added;
}

export type HooksRequest = {
  home: string;
  settingsPath: string;
  /** The command prefix the written hooks run: a Node path, or the desktop's Electron prefix. */
  runtime: string;
  /** Where the hook scripts are copied from: apps/agent/hooks, or the app's dist/hooks. */
  hooksDir: string;
  port?: number;
  dryRun?: boolean;
  now: () => number;
};
export type HooksResult =
  | {
      ok: true;
      statusLine: InstallResult["statusLine"];
      events: readonly string[];
      backup: string | null;
      /** The allowlist as read at the top of this call, before it. A caller that has just saved a
       * new allowlist should read the config again rather than trust this. */
      allowlist: string[];
      port: number;
    }
  | { ok: false; message: string };

/**
 * Copies the scripts to `<home>/bin` and writes Claude Code's settings file, backing up what was
 * there. The config is saved first, so the token the new hooks carry is on disk before they exist.
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
  if (req.dryRun === true) return { ok: true, statusLine: result.statusLine, events: result.events, backup: null, allowlist: base.allowlist, port };

  await mkdir(paths.bin, { recursive: true });
  for (const script of HOOK_SCRIPTS) await copyFile(join(req.hooksDir, script), join(paths.bin, script));
  const wrapped = result.statusLine === "wrapped" ? result.newlyWrapped : result.statusLine === "kept" ? base.wrappedStatusLine : undefined;
  const { wrappedStatusLine: _wrapped, ...baseWithoutWrapped } = base;
  await saveConfig(paths, { ...baseWithoutWrapped, port, ...(wrapped ? { wrappedStatusLine: wrapped } : {}) });
  const saved = read.kind === "ok" ? await backup(req.settingsPath, req.now()) : null;
  await writeJsonAtomic(req.settingsPath, result.settings);
  return { ok: true, statusLine: result.statusLine, events: result.events, backup: saved, allowlist: base.allowlist, port };
}

/** The CLI's install: the check, then the allowlist, then the hooks, then the report the user reads. */
export async function install(req: InstallRequest): Promise<number> {
  const common = {
    home: req.home,
    settingsPath: req.settingsPath,
    runtime: req.runtime,
    hooksDir: req.hooksDir,
    ...(req.port === undefined ? {} : { port: req.port }),
    now: req.now,
  };
  // A dry run writes nothing, so this reads and validates the settings file before anything is saved.
  const check = await installHooks({ ...common, dryRun: true });
  if (!check.ok) {
    req.print(check.message);
    return 1;
  }
  const allow = req.dryRun
    ? mergeAllowlist((await readConfig(agentPaths(req.home)))?.allowlist ?? [], req.allow, req.cwd)
    : await setAllowlist({ home: req.home, add: req.allow, cwd: req.cwd, ...(req.port === undefined ? {} : { port: req.port }) });
  if (!allow.ok) {
    req.print(allow.message);
    return 1;
  }
  if (req.dryRun) {
    req.print(`dry run: would add hooks to ${req.settingsPath} for ${check.events.join(", ")}`);
    req.print(`dry run: would ${STATUS_WORDS[check.statusLine]}`);
    req.print(`dry run: the allowlist would be ${allow.allowlist.join(", ")}`);
    return 0;
  }
  const hooks = await installHooks(common);
  if (!hooks.ok) {
    req.print(hooks.message);
    return 1;
  }
  req.print(`installed the Clawd hooks into ${req.settingsPath}; ${STATUS_DONE[hooks.statusLine]}`);
  req.print(hooks.backup ? `backup of the previous settings: ${hooks.backup}` : "there were no previous settings to back up");
  req.print(`allowlist: ${allow.allowlist.join(", ")}`);
  const running = await (req.probe ?? probeAgent)(hooks.port);
  req.print(running ? `an agent is running on port ${hooks.port}; restart it to pick up these changes` : "start the agent with: pnpm --filter @clawd/agent start");
  return 0;
}

export async function uninstall(req: UninstallRequest): Promise<number> {
  const paths = agentPaths(req.home);
  const config = await readConfig(paths);
  const read = await readSettings(req.settingsPath);
  if (read.kind === "missing") {
    req.print(`${req.settingsPath} does not exist; nothing to uninstall`);
    return 0;
  }
  if (read.kind === "invalid") {
    req.print(`${req.settingsPath} is not a JSON object; nothing was changed`);
    return 1;
  }
  let next: JsonObject;
  try {
    next = applyUninstall(read.value, config?.wrappedStatusLine);
  } catch (err) {
    if (!(err instanceof SettingsShapeError)) throw err;
    req.print(`${req.settingsPath} has an unexpected shape at ${err.message}; nothing was changed`);
    return 1;
  }
  if (JSON.stringify(next) === JSON.stringify(read.value)) {
    req.print("no Clawd hooks or status line were found; nothing was changed");
    return 0;
  }
  const saved = await backup(req.settingsPath, req.now());
  await writeJsonAtomic(req.settingsPath, next);
  if (config?.wrappedStatusLine) {
    const { wrappedStatusLine: _wrapped, ...rest } = config;
    await saveConfig(paths, rest);
  }
  req.print(`removed the Clawd hooks from ${req.settingsPath}`);
  req.print(`backup of the previous settings: ${saved}`);
  req.print(`${paths.home} was left in place`);
  return 0;
}
