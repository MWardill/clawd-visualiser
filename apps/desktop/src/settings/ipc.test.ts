import { describe, expect, it } from "vitest";
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

// Distinct from STATE (different logDir) so a test can tell "the seed main started with" apart
// from "a state a handler actually tracked."
const SEED: SettingsState = { ...STATE, logDir: "C:\\seed-logs" };

function actions(over: Partial<SettingsActions> = {}, fallback: SettingsState = STATE) {
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
  return { calls, handlers: createHandlers(base, fallback) };
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

  it("answers with the last state it built when the action and the refresh both fail", async () => {
    let broken = false;
    const { handlers } = actions(
      {
        getState: async () => {
          if (broken) throw new Error("cannot read the config");
          return STATE;
        },
        installHooks: async () => {
          throw new Error("boom");
        },
      },
      SEED,
    );
    // A correct implementation records STATE as the last state it built here.
    expect(await handlers[CHANNELS.getState]!(undefined)).toEqual(STATE);
    broken = true;
    // Both the action and the refresh fail now, so the answer must come from what was tracked
    // above (STATE), not from the seed it started with (SEED) and not from a refresh that failed.
    const result = await handlers[CHANNELS.installHooks]!(undefined);
    expect(result).toEqual(STATE);
    expect(result).not.toEqual(SEED);
  });

  it("answers with the fallback it was given when the action and the refresh both fail on the first call", async () => {
    const { handlers } = actions(
      {
        getState: async () => {
          throw new Error("cannot read the config");
        },
        installHooks: async () => {
          throw new Error("boom");
        },
      },
      SEED,
    );
    expect(await handlers[CHANNELS.installHooks]!(undefined)).toEqual(SEED);
  });

  it("still answers when a refused argument's refresh fails", async () => {
    const { calls, handlers } = actions(
      {
        getState: async () => {
          throw new Error("cannot read the config");
        },
      },
      SEED,
    );
    expect(await handlers[CHANNELS.removeFolder]!(42)).toEqual(SEED);
    expect(calls).toEqual([]);
  });

  it("opens the logs and answers with nothing", async () => {
    const { calls, handlers } = actions();
    expect(await handlers[CHANNELS.openLogs]!(undefined)).toBeUndefined();
    expect(calls).toEqual(["openLogs"]);
  });
});
