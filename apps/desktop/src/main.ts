// The main process: the one Node program in the app. It owns the lifecycle, the window and the tray,
// and runs the agent itself; Chromium draws, in a sandboxed renderer process per window.
import {
  AGENT_VERSION,
  DEFAULT_PORT,
  agentPaths,
  createLogger,
  defaultHome,
  defaultSettingsPath,
  detailLevel,
  installHooks,
  saveDetail,
  setAllowlist,
  startAgent,
  uninstallHooks,
} from "@clawd/agent";
import { Menu, Tray, app, dialog, ipcMain, nativeImage, protocol, screen, shell, type BrowserWindow, type NativeImage, type OpenDialogOptions } from "electron";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { checkToken, fetchCounts, probeHealth } from "./agent-client";
import { createAgentHost, statusText, type HostState } from "./agent-host";
import { ownArgs, parseArgs, resolveRendererUrl } from "./args";
import { restoredBounds } from "./bounds";
import { createDesktopStore, desktopStatePath } from "./desktop-state";
import { currentHookStatus, installedExe, launchRepair, readConfigState, runtimePrefix } from "./hooks";
import { isQuitShortcut } from "./keys";
import { createFileSink, readRetentionDays } from "./log";
import { appUserModelId, loginItemTarget, loginOnLaunch } from "./login";
import { distPaths } from "./paths";
import { createQuitHandler, settleWithin } from "./quit";
import { APP_SCHEME, APP_URL, createSchemeHandler } from "./scheme";
import { settingsState, type SettingsState } from "./settings-state";
import { createSettingsActions } from "./settings/actions";
import { createCoalescer } from "./settings/coalesce";
import { CHANNELS, createHandlers } from "./settings/ipc";
import { trayIconFile, trayMenuTemplate, trayTooltip } from "./tray";
import { createMainWindow, createSettingsWindow } from "./window";

// One copy of the app per user. The first launch holds the lock; a second one hands its command
// line to the first, through `second-instance`, and exits here before doing anything else.
if (app.requestSingleInstanceLock()) run();
else app.exit(0);

function run(): void {
  const args = parseArgs(ownArgs(process.argv, app.isPackaged));
  const url = resolveRendererUrl(args, process.env, app.isPackaged, APP_URL);
  const home = defaultHome();

  // The id matches electron-builder.yml's appId, but for the dir and zip targets electron-builder
  // does not set an AppUserModelId itself: this call is what names the login item's Run value and
  // groups the app in the taskbar. A development run uses its own name, so the two never share an entry.
  app.setAppUserModelId(appUserModelId(app.isPackaged));

  // A custom scheme is declared before `ready`, with what it may do. `standard` makes app://clawd/
  // behave like http: relative and root-relative URLs resolve under it and the page's origin is
  // app://clawd. `secure` makes the page a secure context. `supportFetchAPI` lets fetch reach the scheme,
  // which the CSP's connect-src allows for the page's own files.
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

  // The agent's own logger, writing to a dated file: codes and numbers only. In development the
  // lines also reach the terminal that ran the dev command.
  const sink = createFileSink(agentPaths(home).logs, { now: Date.now, retentionDays: () => readRetentionDays(home) });
  const log = createLogger((line) => {
    sink.write(line);
    if (!app.isPackaged) process.stdout.write(line);
  });

  const store = createDesktopStore(desktopStatePath(home, app.isPackaged));
  const login = loginItemTarget(app.isPackaged, process.execPath, app.getAppPath());
  // Packaged, the bundle and the pages are inside resources/app.asar and the icons and scripts beside it.
  const dist = distPaths(__dirname, app.isPackaged ? process.resourcesPath : __dirname);
  const settingsPath = defaultSettingsPath();
  const runtime = runtimePrefix(process.execPath);

  let win: BrowserWindow | null = null;
  let settingsWin: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let trayFile = "";
  // Set once quitting has begun, so that closing the window really closes it rather than hiding it.
  let quitting = false;

  // The host's change callback fires on every snapshot the agent produces, and building the state
  // reads two files and asks Electron for the login item synchronously, on the same event loop the
  // agent runs on. A burst of snapshots is collapsed into one rebuild rather than one each.
  const STATE_COALESCE_MS = 150;
  /** How long the launch repair waits for the host's first start; an agent starts in well under a second. */
  const FIRST_START_CAP_MS = 10_000;
  const pushStateSoon = createCoalescer(STATE_COALESCE_MS, pushState);

  const host = createAgentHost({
    // Packaged, the agent accepts this app's page and whatever the config lists, and not the dev
    // server's origins: a teammate's machine has no dev server of ours on port 3000.
    start: (onSnapshot) => startAgent({ home, log, onSnapshot, devOrigins: !app.isPackaged }),
    probe: (port) => probeHealth(port),
    counts: (port) => fetchCounts(port),
    log,
    onChange: (state) => {
      if (win !== null && !win.isDestroyed()) win.setTitle(statusText(state));
      refreshTray(state);
      pushStateSoon.ask();
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

  const version = app.getVersion();
  let trayTip = "";
  /** The two images, loaded once: a waiting flip swaps them rather than reading the ICO again. */
  const trayImages = new Map<string, NativeImage>();
  function trayImage(file: string): NativeImage {
    let image = trayImages.get(file);
    if (image === undefined) {
      image = nativeImage.createFromPath(join(dist.tray, file));
      trayImages.set(file, image);
    }
    return image;
  }

  /** The host's change callback fires on every snapshot; the tray is touched only when its text or its image changes. */
  function refreshTray(state: HostState): void {
    if (tray === null) return;
    const tip = trayTooltip(state, version);
    if (tip !== trayTip) {
      trayTip = tip;
      tray.setToolTip(tip);
    }
    const file = trayIconFile(state.waiting);
    if (file !== trayFile) {
      trayFile = file;
      tray.setImage(trayImage(file));
    }
  }

  function openAtLogin(): boolean {
    return app.getLoginItemSettings(login).openAtLogin;
  }

  function applyOpenAtLogin(on: boolean): void {
    app.setLoginItemSettings({ ...login, openAtLogin: on });
    store.update({ openAtLogin: on });
    refreshMenu();
  }

  /** The menu is rebuilt whenever the login checkbox could have changed. */
  function refreshMenu(): void {
    tray?.setContextMenu(
      Menu.buildFromTemplate(
        trayMenuTemplate(openAtLogin(), { open: showWindow, settings: showSettings, setOpenAtLogin: (on: boolean) => { applyOpenAtLogin(on); pushState(); }, quit: () => app.quit() }),
      ),
    );
  }

  /** The state the page renders, from one read of the config. */
  async function currentState(): Promise<SettingsState> {
    const read = await readConfigState(agentPaths(home));
    const config = read.kind === "ok" ? read.config : null;
    return settingsState({
      host: host.state(),
      agentVersion: AGENT_VERSION,
      appVersion: app.getVersion(),
      exe: process.execPath,
      allowlist: config?.allowlist ?? [],
      hooks: await currentHookStatus({ config: read, settingsPath, runtime, binDir: agentPaths(home).bin, hooksDir: dist.hooks }),
      detail: detailLevel(config ?? {}),
      openAtLogin: openAtLogin(),
      logDir: agentPaths(home).logs,
      notice: null,
    });
  }

  // Everything these depend on (home, the store's login item, dist, settingsPath, runtime, host, log)
  // is already in scope here, and each call reads it fresh, so the actions can be built once, ahead
  // of the settings window that is their only caller.
  const settingsActions = createSettingsActions({
    state: currentState,
    async pickFolder() {
      // The picker belongs to the settings window, so it is modal to it and a second click cannot open another.
      const options: OpenDialogOptions = { properties: ["openDirectory"], title: "Watch a folder" };
      const parent = settingsWin !== null && !settingsWin.isDestroyed() ? settingsWin : null;
      const picked = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    hostMode: () => host.state().mode,
    hasConfig: async () => (await readConfigState(agentPaths(home))).kind === "ok",
    tokenCheck: async () => {
      const read = await readConfigState(agentPaths(home));
      const port = host.state().port;
      return read.kind === "ok" && port !== null ? checkToken(port, read.config.token) : "unknown";
    },
    restartAgent: () => host.restart(),
    retryAgent: () => host.retry(),
    setAllowlist: (change) => setAllowlist({ home, cwd: home, ...("add" in change ? { add: [change.add] } : { remove: change.remove }) }),
    installHooks: () => installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now }),
    uninstallHooks: () => uninstallHooks({ home, settingsPath, now: Date.now }),
    saveDetail: (level) => saveDetail({ home, level }),
    applyOpenAtLogin,
    openLogs: () => shell.openPath(agentPaths(home).logs).then(() => {}),
    log,
  });

  // A push main makes on its own (a host snapshot, the tray's login toggle) carries whatever notice
  // the last action left, so it never erases a refusal or ATTACHED_NOTICE the page has not shown yet.
  function pushState(): void {
    if (settingsWin === null || settingsWin.isDestroyed()) return;
    void settingsActions.pushedState().then((state) => {
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
    protocol.handle(APP_SCHEME, createSchemeHandler({ dirs: { clawd: dist.renderer, settings: dist.settings }, port: () => host.state().port ?? DEFAULT_PORT, fallbackPort: DEFAULT_PORT }));
    log("desktop.started", { packaged: app.isPackaged });
    host.start();
    await store.load();

    // Quitting began while desktop.json was loading: build nothing more.
    if (quitting) return;

    // The tray has to stay referenced for as long as the app runs; `tray` in this closure is that reference.
    trayFile = trayIconFile(0);
    tray = new Tray(trayImage(trayFile));
    tray.on("click", () => showWindow());

    const fallback = await currentState();
    for (const [channel, handler] of Object.entries(createHandlers(settingsActions, fallback))) {
      ipcMain.handle(channel, (_event, arg: unknown) => handler(arg));
    }

    refreshTray(host.state());
    refreshMenu();

    // Decided once the host's first start has settled, and not awaited, so the window is not held up.
    // That start writes config.json when there is none; hooks left from before then carry the old
    // token, which only a status read after the write can see as stale.
    void settleWithin(host.settled(), FIRST_START_CAP_MS)
      .then(() =>
        quitting
          ? ("none" as const)
          : launchRepair({
              packaged: app.isPackaged,
              thisExe: process.execPath,
              status: async () => currentHookStatus({ config: await readConfigState(agentPaths(home)), settingsPath, runtime, binDir: agentPaths(home).bin, hooksDir: dist.hooks }),
              installedExe: () => installedExe(settingsPath),
              exists: (path) =>
                access(path).then(
                  () => true,
                  () => false,
                ),
              install: () => installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now }),
              log,
            }),
      )
      .then((outcome) => {
        if (outcome !== "none") pushState();
      });

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
    // A rebuild waiting on the coalescer would only build state for a window that is going away.
    pushStateSoon.cancel();
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
