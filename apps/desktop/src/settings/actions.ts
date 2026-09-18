// The settings window's actions: what each bridge call does, as rules with tests. Save, then restart
// the agent this app owns only when the save succeeded; log a code when a write fails or is refused;
// say why in the state's notice, since the page shows the whole state and nothing else. Electron-free:
// main hands in the picker, the installer, the host and the log, and only wires.
import type { AllowlistResult, HooksResult, Logger, UninstallResult } from "@clawd/agent";
import type { DetailLevel } from "@clawd/core";
import type { HostMode } from "../agent-host";
import type { SettingsState } from "../settings-state";
import type { SettingsActions } from "./ipc";

export type ActionDeps = {
  /** The state the page renders, built fresh with no notice; the actions add one. */
  state(): Promise<SettingsState>;
  /** The folder picker; null when the user cancels. */
  pickFolder(): Promise<string | null>;
  hostMode(): HostMode;
  /** Whether this app's home has a usable config.json. */
  hasConfig(): Promise<boolean>;
  restartAgent(): void;
  retryAgent(): void;
  setAllowlist(change: { add: string } | { remove: string }): Promise<AllowlistResult>;
  installHooks(): Promise<HooksResult>;
  uninstallHooks(): Promise<UninstallResult>;
  saveDetail(level: DetailLevel): Promise<void>;
  /** Registers or removes the login item and remembers the choice. Pushes nothing: the answer carries the state. */
  applyOpenAtLogin(on: boolean): void;
  openLogs(): Promise<void>;
  log: Logger;
};

export const ATTACHED_NOTICE = "saved; the agent this app is attached to keeps its own settings until it is restarted";
export const NO_CONFIG_NOTICE = "this app is attached to another agent and has no config of its own, so it cannot write hooks that agent would accept";
export const NO_CONFIG_TO_CHANGE = "there is no config to change yet";
export const SEE_LOG = "see the log";

export function createSettingsActions(deps: ActionDeps): SettingsActions {
  const answer = async (notice: string | null = null): Promise<SettingsState> => ({ ...(await deps.state()), notice });

  /** After a successful save: the agent this app owns reads the config again; an attached one cannot be made to. */
  const applied = (): string | null => {
    if (deps.hostMode() === "attached") {
      deps.log("desktop.attachedChange");
      return ATTACHED_NOTICE;
    }
    deps.restartAgent();
    return null;
  };

  const changeAllowlist = async (change: { add: string } | { remove: string }): Promise<SettingsState> => {
    try {
      const saved = await deps.setAllowlist(change);
      if (saved.ok) return answer(applied());
      deps.log("desktop.folderFailed");
      return answer(saved.message);
    } catch {
      deps.log("desktop.folderFailed");
      return answer(`the folder could not be saved; ${SEE_LOG}`);
    }
  };

  return {
    getState: () => answer(),
    async addFolder() {
      let dir: string | null;
      try {
        dir = await deps.pickFolder();
      } catch {
        deps.log("desktop.folderFailed");
        return answer(`the folder picker failed; ${SEE_LOG}`);
      }
      return dir === null ? answer() : changeAllowlist({ add: dir });
    },
    async removeFolder(dir) {
      // Saving with no config would create one with a fresh token; there is nothing to remove from anyway.
      if (!(await deps.hasConfig())) return answer(NO_CONFIG_TO_CHANGE);
      return changeAllowlist({ remove: dir });
    },
    async installHooks() {
      if (deps.hostMode() === "attached" && !(await deps.hasConfig())) {
        deps.log("desktop.hooksFailed", { repair: false, attached: true });
        return answer(NO_CONFIG_NOTICE);
      }
      try {
        const result = await deps.installHooks();
        if (result.ok) return answer();
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(result.message);
      } catch {
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(`the hooks could not be written; ${SEE_LOG}`);
      }
    },
    async uninstallHooks() {
      try {
        const result = await deps.uninstallHooks();
        if (result.ok) return answer(result.outcome === "removed" ? null : "no hooks of ours were found; nothing was changed");
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(result.reason === "invalid" ? "Claude Code's settings file is not a JSON object; nothing was changed" : `Claude Code's settings file has an unexpected shape at ${result.at}; nothing was changed`);
      } catch {
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(`the hooks could not be removed; ${SEE_LOG}`);
      }
    },
    async setDetail(level) {
      try {
        await deps.saveDetail(level);
        return answer(applied());
      } catch {
        deps.log("desktop.detailFailed");
        return answer(`the detail level could not be saved; ${SEE_LOG}`);
      }
    },
    async setOpenAtLogin(on) {
      deps.applyOpenAtLogin(on);
      return answer();
    },
    async retryAgent() {
      deps.retryAgent();
      return answer();
    },
    openLogs: () => deps.openLogs(),
  };
}
