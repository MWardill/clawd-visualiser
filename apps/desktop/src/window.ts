import { BrowserWindow } from "electron";
import { sameOrigin } from "./navigation";

export const WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The scene's night background, so the window never flashes white before the page paints. */
export const BACKGROUND = "#0a0b10";

/**
 * The one visualiser window. The renderer is sandboxed with no Node access and no preload: a web
 * page that talks to the agent over HTTP, as a browser tab does. It may not open windows and may
 * not navigate away from the origin it was loaded from.
 */
export function createMainWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: "Clawd Visualiser",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(url, target)) event.preventDefault();
  });
  void win.loadURL(url);
  return win;
}
