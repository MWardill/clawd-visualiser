import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { TRAY_ICONS } from "./icons";
import { trayIconFile, trayMenuTemplate, trayTooltip } from "./tray";

const click = (item: MenuItemConstructorOptions | undefined): void => (item?.click as (() => void) | undefined)?.();

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      open: () => void calls.push("open"),
      showWidgets: () => void calls.push("widgets"),
      settings: () => void calls.push("settings"),
      setOpenAtLogin: (on: boolean) => void calls.push(`login ${on}`),
      quit: () => void calls.push("quit"),
    },
  };
}

describe("trayIconFile", () => {
  it("is the badged icon while any session waits, and a file the icon build writes", () => {
    expect(trayIconFile(0)).toBe("tray.ico");
    expect(trayIconFile(1)).toBe("tray-waiting.ico");
    expect(trayIconFile(3)).toBe("tray-waiting.ico");
    const files = TRAY_ICONS.map((icon) => icon.file as string);
    expect(files).toContain(trayIconFile(0));
    expect(files).toContain(trayIconFile(1));
  });
});

describe("trayMenuTemplate", () => {
  it("is Open, Settings, Start on login as a checkbox, a separator, then Quit", () => {
    const { actions } = recorder();
    const menu = trayMenuTemplate(true, actions);
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Open", "Settings", "Start on login", "separator", "Quit"]);
    expect(menu[2]).toMatchObject({ type: "checkbox", checked: true });
    expect(trayMenuTemplate(false, actions)[2]).toMatchObject({ type: "checkbox", checked: false });
  });

  it("opens, opens settings, flips the login choice from what the menu showed, and quits", () => {
    const on = recorder();
    const menu = trayMenuTemplate(true, on.actions);
    click(menu[0]);
    click(menu[1]);
    click(menu[2]);
    click(menu[4]);
    expect(on.calls).toEqual(["open", "settings", "login false", "quit"]);

    const off = recorder();
    click(trayMenuTemplate(false, off.actions)[2]);
    expect(off.calls).toEqual(["login true"]);
  });

  it("puts Show widgets above Open in widget view only; Open is the full window in either", () => {
    const { calls, actions } = recorder();
    const menu = trayMenuTemplate(false, actions, "widgets");
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Show widgets", "Open", "Settings", "Start on login", "separator", "Quit"]);
    click(menu[0]);
    click(menu[1]);
    expect(calls).toEqual(["widgets", "open"]);
    expect(trayMenuTemplate(false, actions, "window").map((item) => item.label ?? item.type)).toEqual(["Open", "Settings", "Start on login", "separator", "Quit"]);
  });
});

describe("trayTooltip", () => {
  it("is the status line with the app's version after it", () => {
    expect(trayTooltip({ mode: "own", port: 4750, sessions: 2, waiting: 1, error: null }, "0.1.0")).toBe("Clawd Visualiser · 2 sessions · 1 waiting · v0.1.0");
  });
});
