// Claude Code's hooks run under the app's own binary: with ELECTRON_RUN_AS_NODE=1 it is plain Node
// and ignores the app. That prefix is what the installer writes into the settings file, so the
// commands follow the app wherever its folder is. This module also decides what the hooks' status
// is: it reads the config, the settings file and the installed scripts, so main only wires it.
// Electron-free, so every classification is tested.
import { HOOK_SCRIPTS, hookStatus, installedRuntimeExe, isJsonObject, nodeRuntime, readConfig, readJsonFile, type AgentConfig, type AgentPaths, type HookStatus, type Logger } from "@clawd/agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The command prefix that runs a script under this app's binary. */
export function runtimePrefix(execPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 ${nodeRuntime(execPath)}`;
}

export type RepairInput = {
  status: HookStatus;
  packaged: boolean;
  /** The executable the installed SessionStart command names, or null when there is no command of ours. */
  installedExe: string | null;
  /** Whether that executable exists on disk; ignored when `installedExe` is null. */
  installedExeExists: boolean;
  /** This app's own executable, `process.execPath`. */
  thisExe: string;
};

/** Paths compared the way Windows does: slashes either way, no case, no trailing slash. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Whether the packaged app rewrites the hooks at launch. Only `stale` is ever repaired, and only when
 * the repair is ours to make: the installed command names this exe (so what drifted is the port, the
 * token, the status line or a script), or an exe that no longer exists (the folder moved or was
 * deleted), or there is no command of ours at all. A command naming another exe that still exists
 * is a live install, the CLI's or another copy's, and is left alone: the settings window shows
 * `stale` and offers Reinstall, and no two installs take turns rewriting the file. A development run
 * never repairs unattended (stage 6).
 */
export function repairOnLaunch(input: RepairInput): boolean {
  if (!input.packaged || input.status !== "stale") return false;
  if (input.installedExe === null) return true;
  if (samePath(input.installedExe, input.thisExe)) return true;
  return !input.installedExeExists;
}

/** The executable the installed SessionStart command names, read from the settings file; null when the file is missing, unreadable or has none of ours. */
export async function installedExe(settingsPath: string): Promise<string | null> {
  const file = await readJsonFile(settingsPath).catch(() => null);
  if (file === null || !file.found || !file.ok || !isJsonObject(file.value)) return null;
  return installedRuntimeExe(file.value);
}

export type LaunchRepairDeps = {
  packaged: boolean;
  /** This app's own executable, `process.execPath`. */
  thisExe: string;
  /** The hooks' status now. Main calls this after the host's first start has settled, so a config that start created is seen. */
  status(): Promise<HookStatus>;
  /** The executable the installed SessionStart command names, or null. */
  installedExe(): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  install(): Promise<{ ok: boolean }>;
  log: Logger;
};

/**
 * The repair a packaged launch makes on its own: read the status, decide with `repairOnLaunch`
 * whether stale hooks are this app's to rewrite, rewrite them, and log which way it went. Nothing is
 * read in development. Never rejects.
 */
export async function launchRepair(deps: LaunchRepairDeps): Promise<"none" | "repaired" | "failed"> {
  if (!deps.packaged) return "none";
  try {
    const status = await deps.status();
    if (status !== "stale") return "none";
    const named = await deps.installedExe();
    const namedExists = named !== null && (await deps.exists(named));
    if (!repairOnLaunch({ status, packaged: true, installedExe: named, installedExeExists: namedExists, thisExe: deps.thisExe })) return "none";
    if ((await deps.install()).ok) {
      deps.log("desktop.hooksRepaired");
      return "repaired";
    }
  } catch {
    // Logged below, as a refused install is.
  }
  deps.log("desktop.hooksFailed", { repair: true });
  return "failed";
}

export type ConfigRead = { kind: "ok"; config: AgentConfig } | { kind: "missing" } | { kind: "unreadable" };

/** The config, telling a file that does not exist from one that exists but cannot be used. */
export async function readConfigState(paths: AgentPaths): Promise<ConfigRead> {
  try {
    const config = await readConfig(paths);
    return config === null ? { kind: "missing" } : { kind: "ok", config };
  } catch {
    return { kind: "unreadable" };
  }
}

/** Whether every script in the bin directory is byte for byte the shipped one; false when one is missing. */
export async function scriptsMatch(hooksDir: string, binDir: string): Promise<boolean> {
  for (const script of HOOK_SCRIPTS) {
    const [shipped, installed] = await Promise.all([readFile(join(hooksDir, script)).catch(() => null), readFile(join(binDir, script)).catch(() => null)]);
    if (shipped === null || installed === null || !shipped.equals(installed)) return false;
  }
  return true;
}

export type HookStatusDeps = { config: ConfigRead; settingsPath: string; runtime: string; binDir: string; hooksDir: string };

/**
 * The hooks' status now. `unreadable`: the config exists but cannot be used, or the settings file
 * exists but is not a JSON object. `missing`: no config yet, no settings file, or nothing of ours in
 * it. Otherwise the file is compared with what an install would write, and then the installed
 * scripts with the shipped ones, so an update that changed a script reads `stale` and is repaired.
 */
export async function currentHookStatus(deps: HookStatusDeps): Promise<HookStatus> {
  if (deps.config.kind === "unreadable") return "unreadable";
  if (deps.config.kind === "missing") return "missing";
  const file = await readJsonFile(deps.settingsPath).catch(() => null);
  if (file === null || (file.found && !file.ok)) return "unreadable";
  if (file.found && !isJsonObject(file.value)) return "unreadable";
  const settings = file.found && isJsonObject(file.value) ? file.value : null;
  const status = hookStatus(settings, { runtime: deps.runtime, binDir: deps.binDir, port: deps.config.config.port, token: deps.config.config.token });
  if (status !== "current") return status;
  return (await scriptsMatch(deps.hooksDir, deps.binDir)) ? "current" : "stale";
}

export type { HookStatus };
