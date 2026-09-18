// Claude Code's hooks run under the app's own binary: with ELECTRON_RUN_AS_NODE=1 it is plain Node
// and ignores the app. That prefix is what the installer writes into the settings file, so the
// commands follow the app wherever its folder is. This module also decides what the hooks' status
// is: it reads the config, the settings file and the installed scripts, so main only wires it.
// Electron-free, so every classification is tested.
import { HOOK_SCRIPTS, hookStatus, isJsonObject, nodeRuntime, readConfig, readJsonFile, type AgentConfig, type AgentPaths, type HookStatus } from "@clawd/agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The command prefix that runs a script under this app's binary. */
export function runtimePrefix(execPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 ${nodeRuntime(execPath)}`;
}

/** Only our own hooks that differ are rewritten, and only by the packaged app (see stage 6); missing and unreadable wait for the settings window. */
export function repairOnLaunch(status: HookStatus, packaged: boolean): boolean {
  return packaged && status === "stale";
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
