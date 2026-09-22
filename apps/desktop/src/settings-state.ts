// What the settings page shows. The design's §9 state, built from the host, the agent's config and
// the app itself. Pure, so the page's contents are tested without Electron.
import { DEFAULT_PORT } from "@clawd/agent";
import type { DetailLevel } from "@clawd/core";
import type { HostMode, HostState } from "./agent-host";
import type { View } from "./desktop-state";
import type { HookStatus } from "./hooks";
import type { SettingsState } from "./settings/state";
export type { SettingsState };

// The page's copy of these unions must keep matching the real ones; these lines fail to compile if not.
type Extends<A extends B, B> = true;
type ModeMatches = Extends<HostMode, SettingsState["agent"]["mode"]>;
type HooksMatch = Extends<HookStatus, SettingsState["hooks"]>;
type DetailMatches = Extends<DetailLevel, SettingsState["detail"]>;
type ViewMatches = Extends<View, SettingsState["view"]>;

export type SettingsInput = {
  host: HostState;
  agentVersion: string;
  appVersion: string;
  exe: string;
  allowlist: readonly string[];
  hooks: HookStatus;
  detail: DetailLevel;
  openAtLogin: boolean;
  view: View;
  finishedPopup: boolean;
  logDir: string;
  notice: string | null;
};

export function settingsState(input: SettingsInput): SettingsState {
  return {
    agent: { mode: input.host.mode, port: input.host.port ?? DEFAULT_PORT, version: input.agentVersion, sessions: input.host.sessions, waiting: input.host.waiting, error: input.host.error },
    app: { version: input.appVersion, exe: input.exe },
    allowlist: [...input.allowlist],
    hooks: input.hooks,
    detail: input.detail,
    openAtLogin: input.openAtLogin,
    view: input.view,
    finishedPopup: input.finishedPopup,
    logDir: input.logDir,
    notice: input.notice,
  };
}
