import type { AllowlistResult, HooksResult, LogFields, UninstallResult } from "@clawd/agent";
import { describe, expect, it } from "vitest";
import type { TokenCheck } from "../agent-client";
import type { HostMode } from "../agent-host";
import type { SettingsState } from "../settings-state";
import { ATTACHED_NOTICE, CONFIG_GONE_NOTICE, NO_CONFIG_NOTICE, NO_CONFIG_TO_CHANGE, OTHER_HOME_NOTICE, VIEW_NOT_REMEMBERED, createSettingsActions, type ActionDeps } from "./actions";

const STATE: SettingsState = {
  agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 0, waiting: 0, error: null },
  app: { version: "0.1.0", exe: "C:\\app.exe" },
  allowlist: [],
  hooks: "current",
  detail: "none",
  openAtLogin: false,
  view: "window",
  logDir: "C:\\logs",
  notice: null,
};

const OK_HOOKS: HooksResult = { ok: true, statusLine: "added", events: [], backup: null, port: 4750 };

function harness(over: Partial<ActionDeps> & { mode?: HostMode; config?: boolean; token?: TokenCheck } = {}) {
  const calls: string[] = [];
  const codes: string[] = [];
  const fields: LogFields[] = [];
  const deps: ActionDeps = {
    state: async () => STATE,
    pickFolder: async () => "C:\\repos\\one",
    hostMode: () => over.mode ?? "own",
    hasConfig: async () => over.config ?? true,
    tokenCheck: async () => over.token ?? "held",
    restartAgent: () => void calls.push("restart"),
    retryAgent: () => void calls.push("retry"),
    setAllowlist: async (change) => {
      calls.push("add" in change ? `add ${change.add}` : `remove ${change.remove}`);
      return { ok: true, allowlist: [] } satisfies AllowlistResult;
    },
    installHooks: async () => {
      calls.push("install");
      return OK_HOOKS;
    },
    uninstallHooks: async () => {
      calls.push("uninstall");
      return { ok: true, outcome: "removed", backup: null } satisfies UninstallResult;
    },
    saveDetail: async (level) => void calls.push(`detail ${level}`),
    applyOpenAtLogin: (on) => void calls.push(`login ${on}`),
    applyView: (view) => {
      calls.push(`view ${view}`);
      return true;
    },
    openLogs: async () => void calls.push("logs"),
    log: (code, logFields = {}) => {
      codes.push(code);
      fields.push(logFields);
    },
    ...over,
  };
  return { calls, codes, fields, actions: createSettingsActions(deps) };
}

describe("createSettingsActions", () => {
  it("adds the picked folder, restarts the agent it owns, and answers with the state and no notice", async () => {
    const { calls, actions } = harness();
    expect(await actions.addFolder()).toEqual(STATE);
    expect(calls).toEqual(["add C:\\repos\\one", "restart"]);
  });

  it("does nothing when the picker is cancelled", async () => {
    const { calls, actions } = harness({ pickFolder: async () => null });
    expect(await actions.addFolder()).toEqual(STATE);
    expect(calls).toEqual([]);
  });

  it("says where to look, and adds nothing, when the picker itself throws", async () => {
    const { calls, codes, actions } = harness({
      pickFolder: async () => {
        throw new Error("dialog crashed");
      },
    });
    expect((await actions.addFolder()).notice).toContain("see the log");
    expect(calls).toEqual([]);
    expect(codes).toEqual(["desktop.folderFailed"]);
  });

  it("puts the installer's refusal in the notice, logs it, and does not restart", async () => {
    const { calls, codes, actions } = harness({ setAllowlist: async () => ({ ok: false, message: "refusing to allow a whole filesystem root: C:\\" }) });
    expect((await actions.addFolder()).notice).toBe("refusing to allow a whole filesystem root: C:\\");
    expect(calls).toEqual([]);
    expect(codes).toEqual(["desktop.folderFailed"]);
  });

  it("says a write failed, and where to look, when the installer throws", async () => {
    const { codes, actions } = harness({
      setAllowlist: async () => {
        throw new Error("EPERM");
      },
    });
    expect((await actions.removeFolder("C:\\repos\\one")).notice).toContain("see the log");
    expect(codes).toEqual(["desktop.folderFailed"]);
  });

  it("saves but does not restart while attached, and says the attached agent keeps its own settings", async () => {
    const { calls, codes, actions } = harness({ mode: "attached" });
    expect((await actions.addFolder()).notice).toBe(ATTACHED_NOTICE);
    expect((await actions.setDetail("paths")).notice).toBe(ATTACHED_NOTICE);
    expect(calls).toEqual(["add C:\\repos\\one", "detail paths"]);
    expect(codes).toEqual(["desktop.attachedChange", "desktop.attachedChange"]);
  });

  it("removes nothing when there is no config to change", async () => {
    const { calls, actions } = harness({ config: false });
    expect((await actions.removeFolder("C:\\repos\\one")).notice).toBe(NO_CONFIG_TO_CHANGE);
    expect(calls).toEqual([]);
  });

  it("installs the hooks and clears the notice, or carries the installer's message", async () => {
    const good = harness();
    expect((await good.actions.installHooks()).notice).toBeNull();
    expect(good.calls).toEqual(["install"]);
    const refused = harness({ installHooks: async () => ({ ok: false, message: "settings.json is not a JSON object; nothing was changed" }) });
    expect((await refused.actions.installHooks()).notice).toContain("not a JSON object");
    expect(refused.codes).toEqual(["desktop.hooksFailed"]);
  });

  it("refuses to install hooks while attached with no config of its own, and installs when there is one", async () => {
    const none = harness({ mode: "attached", config: false });
    expect((await none.actions.installHooks()).notice).toBe(NO_CONFIG_NOTICE);
    expect(none.calls).toEqual([]);
    expect(none.codes).toEqual(["desktop.hooksFailed"]);
    const some = harness({ mode: "attached", config: true });
    expect((await some.actions.installHooks()).notice).toBeNull();
    expect(some.calls).toEqual(["install"]);
  });

  it("logs the fields that tell an attached hooks refusal apart from an ordinary hooks failure", async () => {
    const none = harness({ mode: "attached", config: false });
    await none.actions.installHooks();
    expect(none.fields).toEqual([{ repair: false, attached: true }]);

    const refused = harness({ installHooks: async () => ({ ok: false, message: "settings.json is not a JSON object; nothing was changed" }) });
    await refused.actions.installHooks();
    expect(refused.fields).toEqual([{ repair: false }]);
  });

  it("never mints a config from the settings window: with none, it restarts the agent it is not attached to, so one is written, and says to install again", async () => {
    for (const mode of ["own", "starting", "restarting", "failed"] as const) {
      const t = harness({ mode, config: false });
      expect((await t.actions.installHooks()).notice, mode).toBe(CONFIG_GONE_NOTICE);
      expect(t.calls, mode).toEqual(["restart"]);
      expect(t.fields, mode).toEqual([{ repair: false, noConfig: true }]);
    }
  });

  it("asks the serving agent about the token first: attached to one that refuses it, nothing is written and the page says why", async () => {
    const other = harness({ mode: "attached", token: "refused" });
    expect((await other.actions.installHooks()).notice).toBe(OTHER_HOME_NOTICE);
    expect(other.calls).toEqual([]);
    expect(other.codes).toEqual(["desktop.hooksFailed"]);
    expect(other.fields).toEqual([{ repair: false, attached: true, otherHome: true }]);
  });

  it("restarts its own agent when that agent refuses the token on disk, then installs, since the restart reads the config the hooks will carry", async () => {
    const own = harness({ mode: "own", token: "refused" });
    expect((await own.actions.installHooks()).notice).toBeNull();
    expect(own.calls).toEqual(["restart", "install"]);
    expect(own.codes).toEqual([]);
  });

  it("installs without a restart when the agent holds the token, or does not say", async () => {
    for (const token of ["held", "unknown"] as const) {
      for (const mode of ["own", "attached"] as const) {
        const t = harness({ mode, token });
        expect((await t.actions.installHooks()).notice).toBeNull();
        expect(t.calls).toEqual(["install"]);
      }
    }
  });

  it("says what uninstall found", async () => {
    expect((await harness().actions.uninstallHooks()).notice).toBeNull();
    const nothing = harness({ uninstallHooks: async () => ({ ok: true, outcome: "nothing", backup: null }) });
    expect((await nothing.actions.uninstallHooks()).notice).toContain("no hooks of ours");
    const shape = harness({ uninstallHooks: async () => ({ ok: false, reason: "shape", at: "hooks.Stop" }) });
    expect((await shape.actions.uninstallHooks()).notice).toContain("hooks.Stop");
    expect(shape.codes).toEqual(["desktop.hooksFailed"]);
  });

  it("saves the level and restarts, or logs and says so when the save throws", async () => {
    const good = harness();
    expect((await good.actions.setDetail("hints")).notice).toBeNull();
    expect(good.calls).toEqual(["detail hints", "restart"]);
    const bad = harness({
      saveDetail: async () => {
        throw new Error("EPERM");
      },
    });
    expect((await bad.actions.setDetail("hints")).notice).toContain("see the log");
    expect(bad.calls).toEqual([]);
    expect(bad.codes).toEqual(["desktop.detailFailed"]);
  });

  it("applies the login choice once and answers with one state, retries the agent, and opens the logs", async () => {
    const { calls, actions } = harness();
    expect(await actions.setOpenAtLogin(true)).toEqual(STATE);
    await actions.retryAgent();
    await actions.openLogs();
    expect(calls).toEqual(["login true", "retry", "logs"]);
  });

  it("pins the fresh state's pushedState before any action", async () => {
    const { actions } = harness();
    expect(await actions.pushedState()).toEqual(STATE);
  });

  it("carries a refused action's notice to a push main makes on its own, across repeated pushes", async () => {
    const { actions } = harness({ setAllowlist: async () => ({ ok: false, message: "refusing to allow a whole filesystem root: C:\\" }) });
    await actions.addFolder();
    expect(await actions.pushedState()).toEqual({ ...STATE, notice: "refusing to allow a whole filesystem root: C:\\" });
    expect((await actions.pushedState()).notice).toBe("refusing to allow a whole filesystem root: C:\\");
  });

  it("clears the pushed notice once a following action answers with none", async () => {
    const { actions } = harness({ setAllowlist: async () => ({ ok: false, message: "refusing to allow a whole filesystem root: C:\\" }) });
    await actions.addFolder();
    await actions.setOpenAtLogin(true);
    expect((await actions.pushedState()).notice).toBeNull();
  });

  it("clears the pushed notice once the page asks for state again", async () => {
    const { actions } = harness({ setAllowlist: async () => ({ ok: false, message: "refusing to allow a whole filesystem root: C:\\" }) });
    await actions.addFolder();
    await actions.getState();
    expect((await actions.pushedState()).notice).toBeNull();
  });

  it("carries the attached notice to a push main makes on its own", async () => {
    const { actions } = harness({ mode: "attached" });
    await actions.addFolder();
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
  });

  it("forgets the attached notice once this app's own agent has taken over, and stays forgotten if the host reads attached again", async () => {
    let mode: HostMode = "attached";
    const { actions } = harness({ hostMode: () => mode });
    await actions.addFolder();
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
    mode = "own";
    expect((await actions.pushedState()).notice).toBeNull();
    mode = "attached";
    expect((await actions.pushedState()).notice).toBeNull();
  });

  it("keeps the attached notice while the takeover is under way, since the other agent may answer again", async () => {
    let mode: HostMode = "attached";
    const { actions } = harness({ hostMode: () => mode });
    await actions.addFolder();
    // One missed health probe: the host tries to take the port, and the attached agent answers it
    // again. Nothing has read the saved config, so the notice still holds.
    mode = "starting";
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
    mode = "attached";
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
  });

  it("keeps the attached notice when the takeover leaves the agent restarting or failed", async () => {
    let mode: HostMode = "attached";
    const { actions } = harness({ hostMode: () => mode });
    await actions.addFolder();
    mode = "restarting";
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
    mode = "failed";
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
  });

  it("judges a change made between agents when the host settles: attached means it was not applied, said once", async () => {
    let mode: HostMode = "restarting";
    const { actions, calls, codes } = harness({ hostMode: () => mode });
    expect((await actions.setDetail("hints")).notice).toBeNull();
    expect(calls).toEqual(["detail hints", "restart"]);
    expect((await actions.pushedState()).notice).toBeNull();

    mode = "attached";
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
    expect(codes).toEqual(["desktop.attachedChange"]);

    mode = "own";
    expect((await actions.pushedState()).notice).toBeNull();
  });

  it("says nothing about a change made between agents once this app's own agent has it, even if the host attaches later", async () => {
    let mode: HostMode = "starting";
    const { actions, codes } = harness({ hostMode: () => mode });
    await actions.addFolder();
    mode = "own";
    expect((await actions.pushedState()).notice).toBeNull();
    mode = "attached";
    expect((await actions.pushedState()).notice).toBeNull();
    expect(codes).toEqual([]);
  });

  it("says why, and logs it, when the login choice cannot be applied", async () => {
    const { codes, actions } = harness({
      applyOpenAtLogin: () => {
        throw new Error("the Run key is denied");
      },
    });
    expect((await actions.setOpenAtLogin(true)).notice).toContain("see the log");
    expect(codes).toEqual(["desktop.loginFailed"]);
  });

  it("says why, and logs it, when the agent cannot be retried", async () => {
    const { codes, actions } = harness({
      retryAgent: () => {
        throw new Error("boom");
      },
    });
    expect((await actions.retryAgent()).notice).toContain("see the log");
    expect(codes).toEqual(["desktop.agentFailed"]);
  });

  it("does not drop a refusal's notice when the host stops being attached", async () => {
    let mode: HostMode = "attached";
    const { actions } = harness({
      hostMode: () => mode,
      setAllowlist: async () => ({ ok: false, message: "refusing to allow a whole filesystem root: C:\\" }),
    });
    await actions.addFolder();
    mode = "own";
    expect((await actions.pushedState()).notice).toBe("refusing to allow a whole filesystem root: C:\\");
  });

  it("applies the view, logs which it is, and restarts nothing: the agent is not involved", async () => {
    const { calls, codes, fields, actions } = harness();
    expect(await actions.setView("widgets")).toEqual(STATE);
    expect(calls).toEqual(["view widgets"]);
    expect(codes).toEqual(["desktop.viewChanged"]);
    expect(fields).toEqual([{ widgets: true, remembered: true }]);
  });

  it("says so when the view holds for this run only, because desktop.json could not be read", async () => {
    const { fields, actions } = harness({ applyView: () => false });
    expect((await actions.setView("window")).notice).toBe(VIEW_NOT_REMEMBERED);
    expect(fields).toEqual([{ widgets: false, remembered: false }]);
  });

  it("says where to look when the view could not be changed", async () => {
    const { fields, actions } = harness({
      applyView: () => {
        throw new Error("no display");
      },
    });
    expect((await actions.setView("widgets")).notice).toContain("see the log");
    expect(fields).toEqual([{ widgets: true, failed: true }]);
  });
});
