import { BrowserWindow } from "electron";
import type { Bounds } from "./desktop-state";
import { sameOrigin } from "./navigation";
import { SETTINGS_URL } from "./scheme";

export const WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The scene's night background, so the window never flashes white before the page paints. */
export const BACKGROUND = "#0a0b10";

type WindowSpec = { url: string; title: string; size: { width: number; height: number }; bounds?: Bounds | null; preload?: string };

/**
 * Every window the app makes: sandboxed, no Node access, its title set by main, no new windows, and
 * no navigation away from the origin it was loaded from. The one copy of the hardening.
 */
function createHardenedWindow(spec: WindowSpec): BrowserWindow {
  const win = new BrowserWindow({
    ...(spec.bounds ?? spec.size),
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: spec.title,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, ...(spec.preload === undefined ? {} : { preload: spec.preload }) },
  });
  // A page's <title> replaces the window's by default; main sets the title instead.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(spec.url, target)) event.preventDefault();
  });
  void win.loadURL(spec.url);
  return win;
}

/**
 * The one visualiser window: a web page that talks to the agent over HTTP, as a browser tab does,
 * with no preload. `bounds` puts it back where it was, and `maximized` how it was; without bounds it
 * opens at the default size, centred.
 */
export function createMainWindow(url: string, title: string, bounds: Bounds | null, maximized: boolean): BrowserWindow {
  const win = createHardenedWindow({ url, title, size: WINDOW_SIZE, bounds });
  if (maximized) win.maximize();
  return win;
}

export const SETTINGS_SIZE = { width: 560, height: 720 } as const;

/**
 * The settings window, with a preload: the one place the app gives a page a way to ask main for
 * something. It loads app://settings/ and nothing else.
 */
export function createSettingsWindow(preload: string): BrowserWindow {
  return createHardenedWindow({ url: SETTINGS_URL, title: "Clawd Visualiser settings", size: SETTINGS_SIZE, preload });
}
