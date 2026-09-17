// Claude Code's hooks run under the app's own binary: with ELECTRON_RUN_AS_NODE=1 it is plain Node
// and ignores the app. That prefix is what the installer writes into the settings file, so the
// commands follow the app wherever its folder is. Electron-free, so the strings are tested.
import { hookCommand, hookStatus, nodeRuntime, statusCommand, type HookStatus, type InstallOptions } from "@clawd/agent";

/** The command prefix that runs a script under this app's binary. */
export function runtimePrefix(execPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 ${nodeRuntime(execPath)}`;
}

/** The two commands an install would write now, which say whether what is installed is current. */
export function expectedCommands(opts: InstallOptions): { hook: string; status: string } {
  return { hook: hookCommand(opts), status: statusCommand(opts) };
}

/**
 * Only our own hooks pointing elsewhere are rewritten, and only by the packaged app: on the
 * maintainer's machine the hooks may belong to the CLI's install or to another checkout, and a
 * development launch rewriting them unattended would flip them on every run and leave a backup each
 * time. A development run still shows `stale` in the settings window, where Reinstall is a choice.
 * Missing hooks wait for the settings window either way.
 */
export function repairOnLaunch(status: HookStatus, packaged: boolean): boolean {
  return packaged && status === "stale";
}

export { hookStatus, type HookStatus };
