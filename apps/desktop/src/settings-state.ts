// What the settings page shows. The design's §9 state, built from the host, the agent's config and
// the app itself. Pure, so the page's contents are tested without Electron.
import { DEFAULT_PORT } from "@clawd/agent";
import type { DetailLevel } from "@clawd/core";
import type { HostMode, HostState } from "./agent-host";
import type { HookStatus } from "./hooks";

export type SettingsState = {
  agent: { mode: HostMode; port: number; version: string; sessions: number; waiting: number };
  app: { version: string; exe: string };
  allowlist: string[];
  hooks: HookStatus;
  detail: DetailLevel;
  openAtLogin: boolean;
  logDir: string;
};

export type SettingsInput = {
  host: HostState;
  agentVersion: string;
  appVersion: string;
  exe: string;
  allowlist: readonly string[];
  hooks: HookStatus;
  detail: DetailLevel;
  openAtLogin: boolean;
  logDir: string;
};

export function settingsState(input: SettingsInput): SettingsState {
  return {
    agent: { mode: input.host.mode, port: input.host.port ?? DEFAULT_PORT, version: input.agentVersion, sessions: input.host.sessions, waiting: input.host.waiting },
    app: { version: input.appVersion, exe: input.exe },
    allowlist: [...input.allowlist],
    hooks: input.hooks,
    detail: input.detail,
    openAtLogin: input.openAtLogin,
    logDir: input.logDir,
  };
}
