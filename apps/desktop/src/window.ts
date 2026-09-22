import { BrowserWindow, Menu, type BrowserWindowConstructorOptions } from "electron";
import type { Bounds } from "./desktop-state";
import { sameOrigin } from "./navigation";
import { SETTINGS_URL, WIDGET_URL } from "./scheme";
import { WIDGET_CHANNELS } from "./widget/channels";
import type { WidgetWindow } from "./widgets/controller";

export const WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The scene's night background, so the window never flashes white before the page paints. */
export const BACKGROUND = "#0a0b10";

type WindowSpec = {
  url: string;
  title: string;
  size: { width: number; height: number };
  /** The app's icon, by path. Packaged, the exe carries it anyway; a development run is electron.exe, which carries Electron's. */
  icon: string;
  bounds?: Bounds | null;
  preload?: string;
  /** What differs from an ordinary window: a widget's lack of a frame, a background and a taskbar entry. */
  chrome?: BrowserWindowConstructorOptions;
};

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
    icon: spec.icon,
    ...spec.chrome,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, ...(spec.preload === undefined ? {} : { preload: spec.preload }) },
  });
  // A page's <title> replaces the window's by default; main sets the title instead.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(spec.url, target)) event.preventDefault();
  });
  // A load that is superseded or fails rejects; an unhandled rejection here would fault the host.
  win.loadURL(spec.url).catch(() => {});
  return win;
}

/**
 * The one visualiser window: a web page that talks to the agent over HTTP, as a browser tab does,
 * with no preload. `bounds` puts it back where it was, and `maximized` how it was; without bounds it
 * opens at the default size, centred.
 */
export function createMainWindow(url: string, title: string, bounds: Bounds | null, maximized: boolean, icon: string): BrowserWindow {
  const win = createHardenedWindow({ url, title, size: WINDOW_SIZE, bounds, icon });
  if (maximized) win.maximize();
  return win;
}

export const SETTINGS_SIZE = { width: 560, height: 720 } as const;

/**
 * The settings window, with a preload: the one place the app gives a page a way to ask main for
 * something. It loads app://settings/ and nothing else.
 */
export function createSettingsWindow(preload: string, icon: string): BrowserWindow {
  return createHardenedWindow({ url: SETTINGS_URL, title: "Clawd Visualiser settings", size: SETTINGS_SIZE, preload, icon });
}

/**
 * A widget: no frame, no background, no shadow, no taskbar entry, and no way to resize, maximise or
 * minimise it by hand. `transparent` makes what the page does not paint the desktop; the background
 * colour has to be fully transparent too, or the window is filled before the page draws. Made
 * hidden: the controller shows it once its page has said what size it needs. `type: "toolbar"` is
 * Windows' tool-window style, which keeps the widget out of Alt+Tab as `skipTaskbar` keeps it off
 * the taskbar; this app builds for Windows only. Alt+F4 on a focused box closes it, which the
 * controller treats like any window the user closed, and the next snapshot brings it back;
 * `closable: false` was tried and dropped, since it also stops `win.close()` and with it every close
 * the controller makes and the quit itself.
 */
const WIDGET_CHROME: BrowserWindowConstructorOptions = {
  frame: false,
  transparent: true,
  backgroundColor: "#00000000",
  hasShadow: false,
  resizable: false,
  maximizable: false,
  minimizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  show: false,
  type: "toolbar",
};

export function createWidgetWindow(preload: string, bounds: Bounds, icon: string): BrowserWindow {
  const win = createHardenedWindow({ url: WIDGET_URL, title: "Clawd widget", size: bounds, bounds, preload, icon, chrome: WIDGET_CHROME });
  // The hidden default menu would otherwise still supply Ctrl+W, Ctrl+R and the zoom shortcuts to a
  // focused box, and zoom changes the size the page reports.
  win.setMenu(null);
  return win;
}

/**
 * A widget's BrowserWindow as the controller sees one. Every call checks the window is still there:
 * the controller may hold one a moment after it has gone.
 */
export function asWidgetWindow(win: BrowserWindow): WidgetWindow {
  // Read now: `webContents` cannot be touched once the window is destroyed.
  const id = win.webContents.id;
  let last: Bounds = win.getBounds();
  return {
    id,
    bounds: () => (win.isDestroyed() ? last : (last = win.getBounds())),
    setBounds: (bounds) => {
      if (!win.isDestroyed()) win.setBounds(bounds);
    },
    // Levels are bands, not nudges. "raised" is `screen-saver`, the highest, above a pinned widget,
    // a maximised window and the taskbar; "pinned" is `floating`, above ordinary windows; "normal" is
    // one of them. A raised widget is topmost, so it needs no toggle to come forward from the background.
    setLevel: (level) => {
      if (win.isDestroyed()) return;
      if (level === "normal") win.setAlwaysOnTop(false);
      else win.setAlwaysOnTop(true, level === "raised" ? "screen-saver" : "floating");
    },
    // On screen and above its neighbours, and the keyboard stays where it was. A plain move to the
    // top (`moveTop`) is refused by Windows for a process that is not in the foreground: only a
    // topmost window may sit above the active one. So an unpinned widget is made topmost and at once
    // not, which Windows answers by placing it above every non-topmost window, the active one
    // included, without activating it. A pinned or raised one is topmost already and only moves up its band.
    reveal: () => {
      if (win.isDestroyed()) return;
      win.showInactive();
      if (win.isAlwaysOnTop()) {
        win.moveTop();
        return;
      }
      win.setAlwaysOnTop(true, "floating");
      win.setAlwaysOnTop(false);
    },
    send: (state) => {
      if (!win.isDestroyed()) win.webContents.send(WIDGET_CHANNELS.state, state);
    },
    popupMenu: (template) => {
      if (!win.isDestroyed()) Menu.buildFromTemplate(template).popup({ window: win });
    },
    close: () => {
      if (!win.isDestroyed()) win.close();
    },
    // A load aborted because another superseded it (ERR_ABORTED) and a renderer that exited cleanly
    // both count as failures here, accepted: each costs one of the label's three tries, and only
    // when the close-ordering race hits.
    onFailed: (cb) => {
      win.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
        if (isMainFrame) cb();
      });
      win.webContents.on("render-process-gone", () => cb());
    },
    onClosed: (cb) => void win.on("closed", cb),
  };
}
