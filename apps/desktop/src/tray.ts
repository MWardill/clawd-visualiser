// The tray's icon choice and menu, as data. Main turns the template into a Menu and the file name
// into an image; the tooltip is statusText from agent-host.ts. Only Electron's types are imported,
// so this is tested without Electron.
import type { MenuItemConstructorOptions } from "electron";

/** The icon for a waiting count: the amber-dot variant while any session waits. */
export function trayIconFile(waiting: number): string {
  return waiting > 0 ? "tray-waiting.png" : "tray.png";
}

export type TrayActions = {
  open(): void;
  settings(): void;
  setOpenAtLogin(on: boolean): void;
  quit(): void;
};

/** Open, Settings, Start on login, Quit. */
export function trayMenuTemplate(openAtLogin: boolean, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: "Open", click: () => actions.open() },
    { label: "Settings", click: () => actions.settings() },
    { label: "Start on login", type: "checkbox", checked: openAtLogin, click: () => actions.setOpenAtLogin(!openAtLogin) },
    { type: "separator" },
    { label: "Quit", click: () => actions.quit() },
  ];
}
