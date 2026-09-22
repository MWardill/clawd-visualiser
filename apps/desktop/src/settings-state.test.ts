import { describe, expect, it } from "vitest";
import type { HostState } from "./agent-host";
import { settingsState } from "./settings-state";

const HOST: HostState = { mode: "own", port: 4750, sessions: 3, waiting: 1, error: null };
const INPUT = {
  host: HOST,
  agentVersion: "0.1.0",
  appVersion: "0.1.0",
  exe: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe",
  allowlist: ["C:\\repos\\one"],
  hooks: "current" as const,
  detail: "none" as const,
  openAtLogin: false,
  view: "widgets" as const,
  finishedPopup: true,
  logDir: "C:\\Users\\me\\.clawd\\logs",
  notice: null,
};

describe("settingsState", () => {
  it("carries the agent, the app, the folders, the hooks, the level and the login choice", () => {
    expect(settingsState(INPUT)).toEqual({
      agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 3, waiting: 1, error: null },
      app: { version: "0.1.0", exe: INPUT.exe },
      allowlist: ["C:\\repos\\one"],
      hooks: "current",
      detail: "none",
      openAtLogin: false,
      view: "widgets",
      finishedPopup: true,
      logDir: INPUT.logDir,
      notice: null,
    });
  });

  it("reports the agent's default port until one is known, and keeps every mode", () => {
    expect(settingsState({ ...INPUT, host: { ...HOST, mode: "starting", port: null } }).agent).toMatchObject({ mode: "starting", port: 4750 });
    for (const mode of ["own", "attached", "restarting", "failed"] as const) {
      expect(settingsState({ ...INPUT, host: { ...HOST, mode } }).agent.mode).toBe(mode);
    }
  });

  it("carries the failed agent's reason and a notice", () => {
    expect(settingsState({ ...INPUT, host: { ...HOST, mode: "failed", error: "config.json is invalid at: port" } }).agent.error).toBe("config.json is invalid at: port");
    expect(settingsState({ ...INPUT, notice: "saved" }).notice).toBe("saved");
  });
});
