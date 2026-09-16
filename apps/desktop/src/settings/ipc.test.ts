import { describe, expect, it, vi } from "vitest";
import type { SettingsState } from "../settings-state";
import { CHANNELS, createHandlers, type SettingsActions } from "./ipc";

const STATE: SettingsState = {
  agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 0, waiting: 0 },
  app: { version: "0.1.0", exe: "C:\\app.exe" },
  allowlist: ["C:\\repos\\one"],
  hooks: "current",
  detail: "none",
  openAtLogin: false,
  logDir: "C:\\logs",
};

function actions(over: Partial<SettingsActions> = {}) {
  const calls: string[] = [];
  const base: SettingsActions = {
    getState: async () => STATE,
    addFolder: async () => {
      calls.push("addFolder");
      return STATE;
    },
    removeFolder: async (dir) => {
      calls.push(`removeFolder ${dir}`);
      return STATE;
    },
    installHooks: async () => {
      calls.push("installHooks");
      return STATE;
    },
    uninstallHooks: async () => {
      calls.push("uninstallHooks");
      return STATE;
    },
    setDetail: async (level) => {
      calls.push(`setDetail ${level}`);
      return STATE;
    },
    setOpenAtLogin: async (on) => {
      calls.push(`setOpenAtLogin ${on}`);
      return STATE;
    },
    retryAgent: async () => {
      calls.push("retryAgent");
      return STATE;
    },
    openLogs: async () => {
      calls.push("openLogs");
    },
    ...over,
  };
  return { calls, handlers: createHandlers(base) };
}

describe("createHandlers", () => {
  it("has one handler per channel of the bridge", () => {
    const { handlers } = actions();
    expect(Object.keys(handlers).sort()).toEqual(Object.values(CHANNELS).filter((c) => c !== CHANNELS.state).sort());
  });

  it("passes a valid argument through and answers with the state", async () => {
    const { calls, handlers } = actions();
    expect(await handlers[CHANNELS.getState]!(undefined)).toEqual(STATE);
    await handlers[CHANNELS.removeFolder]!("C:\\repos\\one");
    await handlers[CHANNELS.setDetail]!("paths");
    await handlers[CHANNELS.setOpenAtLogin]!(true);
    await handlers[CHANNELS.addFolder]!(undefined);
    await handlers[CHANNELS.installHooks]!(undefined);
    await handlers[CHANNELS.uninstallHooks]!(undefined);
    await handlers[CHANNELS.retryAgent]!(undefined);
    expect(calls).toEqual(["removeFolder C:\\repos\\one", "setDetail paths", "setOpenAtLogin true", "addFolder", "installHooks", "uninstallHooks", "retryAgent"]);
  });

  it("refuses an argument of the wrong shape, changes nothing and answers with the state", async () => {
    const { calls, handlers } = actions();
    expect(await handlers[CHANNELS.removeFolder]!(42)).toEqual(STATE);
    expect(await handlers[CHANNELS.removeFolder]!("")).toEqual(STATE);
    expect(await handlers[CHANNELS.setDetail]!("everything")).toEqual(STATE);
    expect(await handlers[CHANNELS.setOpenAtLogin]!("yes")).toEqual(STATE);
    expect(calls).toEqual([]);
  });

  it("answers with the state when an action throws, so the page is never left waiting", async () => {
    const { handlers } = actions({
      installHooks: async () => {
        throw new Error("boom");
      },
      getState: async () => STATE,
    });
    expect(await handlers[CHANNELS.installHooks]!(undefined)).toEqual(STATE);
  });

  it("opens the logs and answers with nothing", async () => {
    const { calls, handlers } = actions();
    expect(await handlers[CHANNELS.openLogs]!(undefined)).toBeUndefined();
    expect(calls).toEqual(["openLogs"]);
  });
});
