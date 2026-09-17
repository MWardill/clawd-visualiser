import { describe, expect, it } from "vitest";
import { APP_ID, appUserModelId, loginItemTarget, loginOnLaunch } from "./login";

describe("APP_ID", () => {
  it("is the design's appId", () => {
    expect(APP_ID).toBe("io.github.mwardill.clawd-visualiser");
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
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: false })).toBe("enableFirstRun");
    expect(loginOnLaunch({ packaged: false, remembered: undefined, registered: false })).toBe("none");
  });

  it("writes the entry again when the user wants it and Windows has none for this path, packaged only", () => {
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: false })).toBe("reapply");
    expect(loginOnLaunch({ packaged: false, remembered: true, registered: false })).toBe("none");
  });

  it("leaves an entry Windows already has, and a choice of off, alone", () => {
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: true })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: false, registered: false })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: false, registered: true })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: true })).toBe("enableFirstRun");
  });
});
