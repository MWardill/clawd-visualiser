// The settings window's actions: what each bridge call does, as rules with tests. Save, then restart
// the agent this app owns only when the save succeeded; log a code when a write fails or is refused;
// say why in the state's notice, since the page shows the whole state and nothing else. Electron-free:
// main hands in the picker, the installer, the host and the log, and only wires.
import type { AllowlistResult, HooksResult, Logger, UninstallResult } from "@clawd/agent";
import type { DetailLevel } from "@clawd/core";
import type { TokenCheck } from "../agent-client";
import type { HostMode } from "../agent-host";
import type { View } from "../desktop-state";
import type { SettingsState } from "../settings-state";
import type { BridgeActions } from "./ipc";

export type ActionDeps = {
  /** The state the page renders, built fresh with no notice; the actions add one. */
  state(): Promise<SettingsState>;
  /** The folder picker; null when the user cancels. */
  pickFolder(): Promise<string | null>;
  hostMode(): HostMode;
  /** Whether this app's home has a usable config.json. */
  hasConfig(): Promise<boolean>;
  /** Whether the agent serving the port holds the token in this home's config, asked of that agent. `unknown` with no config, no port yet, or no answer. */
  tokenCheck(): Promise<TokenCheck>;
  restartAgent(): void;
  retryAgent(): void;
  setAllowlist(change: { add: string } | { remove: string }): Promise<AllowlistResult>;
  installHooks(): Promise<HooksResult>;
  uninstallHooks(): Promise<UninstallResult>;
  saveDetail(level: DetailLevel): Promise<void>;
  /** Registers or removes the login item and remembers the choice. Pushes nothing: the answer carries the state. */
  applyOpenAtLogin(on: boolean): void;
  /** Applies the view now and remembers it. False when desktop.json could not be read at launch: the choice then holds for this run only. */
  applyView(view: View): boolean;
  openLogs(): Promise<void>;
  log: Logger;
};

export const ATTACHED_NOTICE = "saved; the agent this app is attached to keeps its own settings until it is restarted";
export const NO_CONFIG_NOTICE = "this app is attached to another agent and has no config of its own, so it cannot write hooks that agent would accept";
export const CONFIG_GONE_NOTICE = "the agent's config file was missing, so the agent has been started again to write a new one; choose Install hooks again";
export const OTHER_HOME_NOTICE = "the agent this app is attached to was started from another home and would refuse these hooks; stop it and this app will start its own";
export const NO_CONFIG_TO_CHANGE = "there is no config to change yet";
export const VIEW_NOT_REMEMBERED = "applied for this run; desktop.json could not be read when the app started, so the choice will not be remembered";
export const SEE_LOG = "see the log";

export function createSettingsActions(deps: ActionDeps): BridgeActions {
  /**
   * The notice the last action's answer carried, which `pushedState` hands to a push main makes on
   * its own (a host snapshot, the tray's login toggle) so the push cannot erase a refusal or
   * ATTACHED_NOTICE before the page has shown it. It lasts until the next action answers (a success
   * clears it, a refusal or failure replaces it) or until the page loads again (`getState` answers
   * with none and so clears it).
   *
   * The one case `pushedState` itself forgets one: the notice is ATTACHED_NOTICE and this app's own
   * agent is running, so that agent has read the saved config and the change did apply. Every other
   * mode keeps it, because none of them has read the config: a takeover under way (`starting`), one
   * that faulted (`restarting`, `failed`), and `attached` itself, where the agent holding the port
   * is still the other one. A single missed health probe therefore cannot make the page stop saying
   * that a saved change has not been applied.
   *
   * `pushedState` also raises ATTACHED_NOTICE itself, once, when a change made between agents
   * (`unsettled`) is followed by the host settling as attached.
   */
  let lastNotice: string | null = null;
  const answer = async (notice: string | null = null): Promise<SettingsState> => {
    lastNotice = notice;
    return { ...(await deps.state()), notice };
  };

  /**
   * A change saved while the host was between agents (starting, restarting, failed): the restart it
   * queued has yet to settle, and may settle as attached, where the change was not applied. The next
   * push that finds the host settled decides, in `pushedState`.
   */
  let unsettled = false;

  /** After a successful save: the agent this app owns reads the config again; an attached one cannot be made to. */
  const applied = (): string | null => {
    const mode = deps.hostMode();
    if (mode === "attached") {
      deps.log("desktop.attachedChange");
      return ATTACHED_NOTICE;
    }
    deps.restartAgent();
    unsettled = mode !== "own";
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
      const mode = deps.hostMode();
      // Never mint a config here: the installer would fall back to a fresh token no running agent holds.
      if (!(await deps.hasConfig())) {
        if (mode === "attached") {
          deps.log("desktop.hooksFailed", { repair: false, attached: true });
          return answer(NO_CONFIG_NOTICE);
        }
        deps.log("desktop.hooksFailed", { repair: false, noConfig: true });
        // The agent's start writes the config; the next Install then carries the token it holds.
        deps.restartAgent();
        return answer(CONFIG_GONE_NOTICE);
      }
      if ((await deps.tokenCheck()) === "refused") {
        if (mode === "attached") {
          deps.log("desktop.hooksFailed", { repair: false, attached: true, otherHome: true });
          return answer(OTHER_HOME_NOTICE);
        }
        // This app's own agent started before the config now on disk was written. A restart reads it,
        // and the install below only reads the token, so the two cannot disagree.
        deps.restartAgent();
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
      try {
        deps.applyOpenAtLogin(on);
      } catch {
        deps.log("desktop.loginFailed");
        return answer(`the login setting could not be applied; ${SEE_LOG}`);
      }
      return answer();
    },
    async setView(view) {
      let remembered: boolean;
      try {
        remembered = deps.applyView(view);
      } catch {
        deps.log("desktop.viewChanged", { widgets: view === "widgets", failed: true });
        return answer(`the view could not be changed; ${SEE_LOG}`);
      }
      deps.log("desktop.viewChanged", { widgets: view === "widgets", remembered });
      return answer(remembered ? null : VIEW_NOT_REMEMBERED);
    },
    async retryAgent() {
      try {
        deps.retryAgent();
      } catch {
        deps.log("desktop.agentFailed", { retry: true });
        return answer(`the agent could not be started again; ${SEE_LOG}`);
      }
      return answer();
    },
    openLogs: () => deps.openLogs(),
    pushedState: async () => {
      const mode = deps.hostMode();
      if (mode === "attached" && unsettled) {
        unsettled = false;
        deps.log("desktop.attachedChange");
        lastNotice = ATTACHED_NOTICE;
      } else if (mode === "own") {
        unsettled = false;
        if (lastNotice === ATTACHED_NOTICE) lastNotice = null;
      }
      return { ...(await deps.state()), notice: lastNotice };
    },
  };
}
