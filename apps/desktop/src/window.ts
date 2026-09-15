import { BrowserWindow } from "electron";
import type { Bounds } from "./desktop-state";
import { sameOrigin } from "./navigation";

export const WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The scene's night background, so the window never flashes white before the page paints. */
export const BACKGROUND = "#0a0b10";

/**
 * The one visualiser window. The renderer is sandboxed with no Node access and no preload: a web
 * page that talks to the agent over HTTP, as a browser tab does. It may not open windows and may
 * not navigate away from the origin it was loaded from. `bounds` puts it back where it was; without
 * them it opens at the default size, centred.
 */
export function createMainWindow(url: string, title: string, bounds: Bounds | null): BrowserWindow {
  const win = new BrowserWindow({
    ...(bounds ?? WINDOW_SIZE),
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // A page's <title> replaces the window's by default; main sets the title from the agent's state instead.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(url, target)) event.preventDefault();
  });
  void win.loadURL(url);
  return win;
}
