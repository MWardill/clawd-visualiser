// The tray's icon choice, tooltip and menu, as data. Main turns the template into a Menu and the file
// name into an image. Nothing here loads Electron at run time (only its types are imported), so this is tested without Electron.
import type { MenuItemConstructorOptions } from "electron";
import { statusText, type HostState } from "./agent-host";
import type { View } from "./desktop-state";

/** The icon for a waiting count: the badged ICO while any session waits. Windows picks the size from the file. */
export function trayIconFile(waiting: number): string {
  return waiting > 0 ? "tray-waiting.ico" : "tray.ico";
}

/** The tooltip: the status line with the app's version after it (design §11). The window title keeps the status line alone. */
export function trayTooltip(state: HostState, version: string): string {
  return `${statusText(state)} · v${version}`;
}

export type TrayActions = {
  open(): void;
  /** Brings the widgets forward. Offered in widget view only. */
  showWidgets(): void;
  settings(): void;
  setOpenAtLogin(on: boolean): void;
  quit(): void;
};

/** Show widgets (in widget view), Open, Settings, Start on login, Quit. Open is the full window in either view. */
export function trayMenuTemplate(openAtLogin: boolean, actions: TrayActions, view: View = "window"): MenuItemConstructorOptions[] {
  return [
    ...(view === "widgets" ? [{ label: "Show widgets", click: () => actions.showWidgets() }] : []),
    { label: "Open", click: () => actions.open() },
    { label: "Settings", click: () => actions.settings() },
    { label: "Start on login", type: "checkbox", checked: openAtLogin, click: () => actions.setOpenAtLogin(!openAtLogin) },
    { type: "separator" },
    { label: "Quit", click: () => actions.quit() },
  ];
}
