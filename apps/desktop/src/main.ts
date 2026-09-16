// The main process: the one Node program in the app. It owns the lifecycle, the window and the tray,
// and runs the agent itself; Chromium draws, in a sandboxed renderer process per window.
import {
  AGENT_VERSION,
  DEFAULT_PORT,
  agentPaths,
  createLogger,
  defaultHome,
  defaultSettingsPath,
  installHooks,
  readConfig,
  readJsonFile,
  setAllowlist,
  setDetail,
  startAgent,
  uninstall,
  type JsonObject,
} from "@clawd/agent";
import { Menu, Tray, app, dialog, ipcMain, nativeImage, protocol, screen, shell, type BrowserWindow, type NativeImage } from "electron";
import { join } from "node:path";
import { fetchCounts, probeHealth } from "./agent-client";
import { createAgentHost, statusText, type HostState } from "./agent-host";
import { ownArgs, parseArgs, resolveRendererUrl } from "./args";
import { restoredBounds } from "./bounds";
import { createDesktopStore, desktopStatePath } from "./desktop-state";
import { expectedCommands, hookStatus, repairOnLaunch, runtimePrefix, type HookStatus } from "./hooks";
import { isQuitShortcut } from "./keys";
import { createFileSink, readRetentionDays } from "./log";
import { APP_ID, loginItemTarget, loginOnLaunch } from "./login";
import { distPaths } from "./paths";
import { createQuitHandler } from "./quit";
import { APP_SCHEME, createSchemeHandler } from "./scheme";
import { settingsState, type SettingsState } from "./settings-state";
import { CHANNELS, createHandlers } from "./settings/ipc";
import { trayIconFile, trayMenuTemplate } from "./tray";
import { createMainWindow, createSettingsWindow } from "./window";

// One copy of the app per user. The first launch holds the lock; a second one hands its command
// line to the first, through `second-instance`, and exits here before doing anything else.
if (app.requestSingleInstanceLock()) run();
else app.exit(0);

function run(): void {
  const args = parseArgs(ownArgs(process.argv, app.isPackaged));
  const url = resolveRendererUrl(args, process.env);
  const home = defaultHome();

  // The id names the login item's Run key entry and groups the app in the taskbar. electron-builder
  // sets the same id in the packaged app.
  app.setAppUserModelId(APP_ID);

  // A custom scheme is declared before `ready`, with what it may do. `standard` makes app://clawd/
  // behave like http: relative and root-relative URLs resolve under it and the page's origin is
  // app://clawd. `secure` makes the page a secure context. `supportFetchAPI` lets fetch reach the scheme,
  // though the CSP's connect-src currently allows fetch to the agent only.
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

  // The agent's own logger, writing to a dated file: codes and numbers only. In development the
  // lines also reach the terminal that ran the dev command.
  const sink = createFileSink(agentPaths(home).logs, { now: Date.now, retentionDays: () => readRetentionDays(home) });
  const log = createLogger((line) => {
    sink.write(line);
    if (!app.isPackaged) process.stdout.write(line);
  });

  const store = createDesktopStore(desktopStatePath(home));
  const login = loginItemTarget(app.isPackaged, process.execPath, app.getAppPath());
  const dist = distPaths(__dirname);
  const settingsPath = defaultSettingsPath();
  const runtime = runtimePrefix(process.execPath);

  let win: BrowserWindow | null = null;
  let settingsWin: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let trayFile = "";
  // Set once quitting has begun, so that closing the window really closes it rather than hiding it.
  let quitting = false;

  const host = createAgentHost({
    start: (onSnapshot) => startAgent({ home, log, onSnapshot }),
    probe: (port) => probeHealth(port),
    counts: (port) => fetchCounts(port),
    log,
    onChange: (state) => {
      if (win !== null && !win.isDestroyed()) win.setTitle(statusText(state));
      refreshTray(state);
      pushState();
    },
  });

  // Without these, an error nothing caught ends the app behind Electron's crash dialog. The host
  // logs it by code and restarts the agent when the app owns it.
  process.on("uncaughtException", () => host.fault());
  process.on("unhandledRejection", () => host.fault());

  /** Shows the window, making it the first time; from the tray, a second launch, or startup. */
  function showWindow(): void {
    // Quitting has begun: neither a second launch nor startup may bring a window back while the app exits.
    if (quitting) return;
    if (win !== null) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const created = createMainWindow(url, statusText(host.state()), restoredBounds(store.get().bounds, workAreas));
    // Closing hides the window, and the app and its agent carry on in the tray. Once quitting has
    // begun the close goes through. Either way the bounds are remembered.
    created.on("close", (event) => {
      store.update({ bounds: created.getNormalBounds() });
      if (quitting) return;
      event.preventDefault();
      created.hide();
    });
    created.webContents.on("before-input-event", (event, input) => {
      if (!isQuitShortcut(input)) return;
      event.preventDefault();
      app.quit();
    });
    created.on("closed", () => {
      win = null;
    });
    win = created;
  }

  /** Electron loads the @2x file beside the named one on a display scaled to 200%. */
  function trayImage(file: string): NativeImage {
    return nativeImage.createFromPath(join(dist.tray, file));
  }

  function refreshTray(state: HostState): void {
    if (tray === null) return;
    tray.setToolTip(statusText(state));
    const file = trayIconFile(state.waiting);
    if (file !== trayFile) {
      trayFile = file;
      tray.setImage(trayImage(file));
    }
  }

  function openAtLogin(): boolean {
    return app.getLoginItemSettings(login).openAtLogin;
  }

  function setOpenAtLogin(on: boolean): void {
    app.setLoginItemSettings({ ...login, openAtLogin: on });
    store.update({ openAtLogin: on });
    refreshMenu();
    pushState();
  }

  /** The menu is rebuilt whenever the login checkbox could have changed. */
  function refreshMenu(): void {
    tray?.setContextMenu(
      Menu.buildFromTemplate(trayMenuTemplate(openAtLogin(), { open: showWindow, settings: showSettings, setOpenAtLogin, quit: () => app.quit() })),
    );
  }

  /** The agent's own installer options, which say what the hooks should run. */
  async function hookOptions(): Promise<{ runtime: string; binDir: string; port: number; token: string } | null> {
    const config = await readConfig(agentPaths(home)).catch(() => null);
    if (config === null) return null;
    return { runtime, binDir: agentPaths(home).bin, port: config.port, token: config.token };
  }

  async function currentHookStatus(): Promise<HookStatus> {
    const opts = await hookOptions();
    if (opts === null) return "missing";
    const file = await readJsonFile(settingsPath).catch(() => ({ found: false }) as const);
    const settings = file.found && file.ok ? (file.value as JsonObject) : null;
    return hookStatus(settings, expectedCommands(opts));
  }

  async function currentState(): Promise<SettingsState> {
    const config = await readConfig(agentPaths(home)).catch(() => null);
    return settingsState({
      host: host.state(),
      agentVersion: AGENT_VERSION,
      appVersion: app.getVersion(),
      exe: process.execPath,
      allowlist: config?.allowlist ?? [],
      hooks: await currentHookStatus(),
      detail: config?.detail ?? "none",
      openAtLogin: openAtLogin(),
      logDir: agentPaths(home).logs,
    });
  }

  /** After a config change the agent reads it again, and the page hears about the new state. */
  function pushState(): void {
    void currentState().then((state) => {
      if (settingsWin !== null && !settingsWin.isDestroyed()) settingsWin.webContents.send(CHANNELS.state, state);
    });
  }

  function showSettings(): void {
    if (settingsWin !== null && !settingsWin.isDestroyed()) {
      settingsWin.show();
      settingsWin.focus();
      return;
    }
    settingsWin = createSettingsWindow(join(dist.settings, "preload.js"));
    settingsWin.on("closed", () => {
      settingsWin = null;
    });
  }

  // `ready` fires once Electron has initialised; no window or tray can be made before it.
  const started = app.whenReady().then(async () => {
    // Every app:// request is answered from the export beside main.cjs, under a CSP that lets the
    // page reach only the agent in use.
    protocol.handle(APP_SCHEME, createSchemeHandler({ dirs: { clawd: dist.renderer, settings: dist.settings }, port: () => host.state().port ?? DEFAULT_PORT }));
    log("desktop.started", { packaged: app.isPackaged });
    host.start();
    await store.load();

    // Quitting began while desktop.json was loading: build nothing more.
    if (quitting) return;

    // The tray has to stay referenced for as long as the app runs; `tray` in this closure is that reference.
    trayFile = trayIconFile(0);
    tray = new Tray(trayImage(trayFile));
    tray.on("click", () => showWindow());
    refreshTray(host.state());
    refreshMenu();

    for (const [channel, handler] of Object.entries(
      createHandlers(
        {
          getState: currentState,
          async addFolder() {
            const picked = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Watch a folder" });
            const dir = picked.canceled ? null : (picked.filePaths[0] ?? null);
            if (dir !== null) {
              const saved = await setAllowlist({ home, add: [dir], cwd: home });
              if (saved.ok) host.restart();
            }
            return currentState();
          },
          async removeFolder(dir) {
            const config = await readConfig(agentPaths(home));
            if (config !== null) {
              const saved = await setAllowlist({ home, remove: dir, cwd: home });
              if (saved.ok) host.restart();
            }
            return currentState();
          },
          async installHooks() {
            await installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now });
            return currentState();
          },
          async uninstallHooks() {
            await uninstall({ home, settingsPath, now: Date.now, print: () => {} });
            return currentState();
          },
          async setDetail(level) {
            await setDetail({ home, level, print: () => {} });
            host.restart();
            return currentState();
          },
          async setOpenAtLogin(on) {
            setOpenAtLogin(on);
            return currentState();
          },
          async retryAgent() {
            host.retry();
            return currentState();
          },
          async openLogs() {
            await shell.openPath(agentPaths(home).logs);
          },
        },
        await currentState(),
      ),
    )) {
      ipcMain.handle(channel, (_event, arg: unknown) => handler(arg));
    }

    // Our hooks pointing at another folder are rewritten, so a moved app keeps receiving events.
    const status = await currentHookStatus();
    if (repairOnLaunch(status)) {
      await installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now });
      log("desktop.hooksRepaired");
    }

    const action = loginOnLaunch({ packaged: app.isPackaged, remembered: store.get().openAtLogin, registered: openAtLogin() });
    if (action !== "none") {
      app.setLoginItemSettings({ ...login, openAtLogin: true });
      store.update({ openAtLogin: true });
      refreshMenu();
    }
    if (action === "reapply") log("desktop.loginItemReapplied");

    if (!args.hidden) showWindow();
  });

  // A second launch. One started at login while the app already runs passes --hidden and changes
  // nothing; otherwise it shows the window once startup has loaded desktop.json and made the tray.
  app.on("second-instance", (_event, argv) => {
    if (parseArgs(argv).hidden) return;
    // A startup that failed was already reported once, through `started`, so it is not reported again here.
    void started.then(showWindow, () => {});
  });

  // The tray keeps the app running with no window open. Without a listener here, Electron would quit
  // as soon as the last window closed.
  app.on("window-all-closed", () => {});

  // Quitting, from the tray, Ctrl+Q or Ctrl+C in the terminal: set the flag so the window's close goes
  // through, and take the window and the tray icon away at once while the agent stops.
  app.on("before-quit", () => {
    quitting = true;
    win?.hide();
    tray?.destroy();
    tray = null;
  });

  // `will-quit` comes after every window has closed. The handler holds it until the agent has stopped
  // (at most five seconds), writes out the log and desktop.json, then exits.
  app.on("will-quit", createQuitHandler({ stop: () => host.stop(), flush: () => Promise.all([sink.flush(), store.flush()]).then(() => {}), exit: (code) => app.exit(code), log }));

  // Ctrl+C in the terminal asks for the same sequence.
  process.on("SIGINT", () => app.quit());
  process.on("SIGTERM", () => app.quit());
}
