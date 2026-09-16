// Claude Code's hooks run under the app's own binary: with ELECTRON_RUN_AS_NODE=1 it is plain Node
// and ignores the app. That prefix is what the installer writes into the settings file, so the
// commands follow the app wherever its folder is. Electron-free, so the strings are tested.
import { hookCommand, hookStatus, statusCommand, type HookStatus, type InstallOptions } from "@clawd/agent";

const forwardSlashes = (p: string): string => p.replace(/\\/g, "/");

/** The command prefix that runs a script under this app's binary. */
export function runtimePrefix(execPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 "${forwardSlashes(execPath)}"`;
}

/** The two commands an install would write now, which say whether what is installed is current. */
export function expectedCommands(opts: InstallOptions): { hook: string; status: string } {
  return { hook: hookCommand(opts), status: statusCommand(opts) };
}

/** Only our own hooks pointing elsewhere are rewritten; missing hooks wait for the settings window. */
export function repairOnLaunch(status: HookStatus): boolean {
  return status === "stale";
}

export { hookStatus, type HookStatus };
