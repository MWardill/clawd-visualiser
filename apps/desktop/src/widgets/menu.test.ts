import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { widgetMenuTemplate } from "./menu";

const click = (item: MenuItemConstructorOptions | undefined): void => (item?.click as (() => void) | undefined)?.();

describe("widgetMenuTemplate", () => {
  it("is Pin on top as a checkbox, a separator, Open full window, then Settings", () => {
    const calls: string[] = [];
    const actions = { togglePin: () => void calls.push("pin"), openWindow: () => void calls.push("window"), settings: () => void calls.push("settings") };
    const menu = widgetMenuTemplate(true, actions);
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Pin on top", "separator", "Open full window", "Settings"]);
    expect(menu[0]).toMatchObject({ type: "checkbox", checked: true });
    expect(widgetMenuTemplate(false, actions)[0]).toMatchObject({ checked: false });
    click(menu[0]);
    click(menu[2]);
    click(menu[3]);
    expect(calls).toEqual(["pin", "window", "settings"]);
  });

  it("has no pin for a temporary widget: Open full window, then Settings", () => {
    const calls: string[] = [];
    const actions = { togglePin: () => void calls.push("pin"), openWindow: () => void calls.push("window"), settings: () => void calls.push("settings") };
    const menu = widgetMenuTemplate(false, actions, true);
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Open full window", "Settings"]);
    click(menu[0]);
    click(menu[1]);
    expect(calls).toEqual(["window", "settings"]);
  });
});
