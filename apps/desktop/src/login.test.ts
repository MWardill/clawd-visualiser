import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { APP_ID, appUserModelId, loginItemTarget, loginOnLaunch, shownAtLogin } from "./login";

describe("APP_ID", () => {
  it("is the design's appId", () => {
    expect(APP_ID).toBe("io.github.mwardill.clawd-visualiser");
  });

  it("matches electron-builder.yml's appId", async () => {
    const yml = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
    const match = yml.match(/^appId:\s*(\S+)\s*$/m);
    expect(match?.[1]).toBe(APP_ID);
  });
});

describe("appUserModelId", () => {
  it("names the packaged app's Run entry after the id, and a development run's after its own name", () => {
    expect(appUserModelId(true)).toBe("io.github.mwardill.clawd-visualiser");
    expect(appUserModelId(false)).toBe("io.github.mwardill.clawd-visualiser.dev");
  });
});

describe("loginItemTarget", () => {
  it("starts the packaged exe hidden", () => {
    expect(loginItemTarget(true, "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe", "C:\\Apps\\Clawd Visualiser\\resources\\app.asar")).toEqual({
      path: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe",
      args: ["--hidden"],
    });
  });

  it("in development, starts Electron on the app's folder, then hidden", () => {
    expect(loginItemTarget(false, "C:\\repo\\node_modules\\electron\\dist\\electron.exe", "C:\\repo\\apps\\desktop")).toEqual({
      path: "C:\\repo\\node_modules\\electron\\dist\\electron.exe",
      args: ["C:\\repo\\apps\\desktop", "--hidden"],
    });
  });

  it("in development, passes a path with a space through untouched", () => {
    expect(loginItemTarget(false, "C:\\x\\electron.exe", "C:\\My Apps\\desktop")).toEqual({
      path: "C:\\x\\electron.exe",
      args: ["C:\\My Apps\\desktop", "--hidden"],
    });
  });
});

describe("loginOnLaunch", () => {
  it("turns the login item on at the packaged app's first run, and not in development", () => {
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: false, stateUsable: true })).toBe("enableFirstRun");
    expect(loginOnLaunch({ packaged: false, remembered: undefined, registered: false, stateUsable: true })).toBe("none");
  });

  it("writes the entry again when the user wants it and Windows has none for this path, packaged only", () => {
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: false, stateUsable: true })).toBe("reapply");
    expect(loginOnLaunch({ packaged: false, remembered: true, registered: false, stateUsable: true })).toBe("none");
  });

  it("leaves an entry Windows already has, and a choice of off, alone", () => {
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: true, stateUsable: true })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: false, registered: false, stateUsable: true })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: false, registered: true, stateUsable: true })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: true, stateUsable: true })).toBe("enableFirstRun");
  });

  it("touches nothing when the state file could not be read, since a stored choice of off may be in it", () => {
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: false, stateUsable: false })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: false, stateUsable: false })).toBe("none");
  });
});

describe("shownAtLogin", () => {
  const NAME = "io.github.mwardill.clawd-visualiser";

  it("is off when Windows has no entry for this exe", () => {
    expect(shownAtLogin({ openAtLogin: false, launchItems: [] }, NAME)).toBe(false);
    expect(shownAtLogin({ openAtLogin: false, launchItems: [{ name: NAME, enabled: true }] }, NAME)).toBe(false);
  });

  it("is off when our entry is there but switched off in Task Manager, and on when it is enabled", () => {
    expect(shownAtLogin({ openAtLogin: true, launchItems: [{ name: NAME, enabled: false }] }, NAME)).toBe(false);
    expect(shownAtLogin({ openAtLogin: true, launchItems: [{ name: NAME, enabled: true }] }, NAME)).toBe(true);
  });

  it("goes by the Run value when Electron reports no entry of ours, as it did for the packaged exe in stage 6", () => {
    expect(shownAtLogin({ openAtLogin: true, launchItems: [] }, NAME)).toBe(true);
    expect(shownAtLogin({ openAtLogin: true }, NAME)).toBe(true);
    expect(shownAtLogin({ openAtLogin: true, launchItems: [{ name: "some.other.app", enabled: false }] }, NAME)).toBe(true);
  });
});
