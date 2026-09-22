// The main process: the one Node program in the app. It owns the lifecycle, the window, the widgets and the tray,
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
import { checkToken, fetchCounts, fetchSnapshot, probeHealth } from "./agent-client";
import { createAgentHost, statusText, type HostState } from "./agent-host";
import { ownArgs, parseArgs, resolveRendererUrl } from "./args";
import { restoredBounds } from "./bounds";
import { createAttachedFeed, feedPort } from "./attached-feed";
import { createDesktopStore, desktopStatePath, placementOf, withPlacement, type View } from "./desktop-state";
import { currentHookStatus, installedExe, launchRepair, readConfigState, runtimePrefix } from "./hooks";
import { isQuitShortcut } from "./keys";
import { createFileSink, readRetentionDays } from "./log";
import { appUserModelId, loginItemTarget, loginOnLaunch, shownAtLogin } from "./login";
import { sessionUrl } from "./navigation";
import { distPaths } from "./paths";
import { showOrCreate } from "./reveal";
import { createQuitHandler, settleWithin } from "./quit";
import { APP_SCHEME, APP_URL, createSchemeHandler } from "./scheme";
import { settingsState, type SettingsState } from "./settings-state";
import { createSettingsActions } from "./settings/actions";
import { createCoalescer } from "./settings/coalesce";
import { CHANNELS } from "./settings/channels";
import { createHandlers } from "./settings/ipc";
import { trayIconFile, trayMenuTemplate, trayTooltip } from "./tray";
import { createWidgetHandlers } from "./widget/ipc";
import { createWidgetController } from "./widgets/controller";
import { asWidgetWindow, createMainWindow, createSettingsWindow, createWidgetWindow } from "./window";

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

  const store = createDesktopStore(desktopStatePath(home, app.isPackaged), log);
  const login = loginItemTarget(app.isPackaged, process.execPath, app.getAppPath());
  /** The Run value's name, which is the AppUserModelId set above: how Electron names our entry in launchItems. */
  const loginName = appUserModelId(app.isPackaged);
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

  /** One window, or a widget per pane. Read fresh: the settings window changes it while the app runs. */
  const view = (): View => store.get().view ?? "window";

  // The widgets: one frameless window per pane. Every rule is in the controller; this hands it Electron.
  const widgets = createWidgetController({
    createWindow: (bounds) => asWidgetWindow(createWidgetWindow(join(dist.widget, "preload.js"), bounds, dist.appIcon)),
    // In the units setBounds takes. A page's own screenX is not, on a machine with two scale factors.
    cursor: () => screen.getCursorScreenPoint(),
    workAreas: () => screen.getAllDisplays().map((display) => display.workArea),
    primaryWorkArea: () => screen.getPrimaryDisplay().workArea,
    placement: (label) => placementOf(store.get(), label),
    savePlacement: (label, placement) => store.update({ widgets: withPlacement(store.get().widgets, label, placement) }),
    openSession: (alias) => showWindow(alias),
    openWindow: () => showWindow(),
    openSettings: () => showSettings(),
    log,
  });

  // The app's own agent hands main every snapshot. An agent it is only attached to does not, so
  // while widgets are shown it is asked once a second.
  const feed = createAttachedFeed({ fetch: (port) => fetchSnapshot(port), onSnapshot: (s, port) => widgets.setSnapshot(s, `attached:${port}`) });
  /** The port the feed is asking, or null; what it was last told, so a stop can be told from a repeat. */
  let feeding: number | null = null;
  const followFeed = (): void => {
    const port = quitting ? null : feedPort(host.state(), view());
    // Leaving widget view while attached stops the feed, and what the controller holds goes stale
    // from then on: forgotten now, so the next widget view opens from a fresh answer, not from minutes ago.
    if (port === null && feeding !== null && host.state().mode === "attached") widgets.noSource();
    feeding = port;
    feed.watch(port);
  };

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
    // `run` counts the host's starts: a new number is a new agent, and a new generation for the widgets.
    onSnapshot: (s, run) => widgets.setSnapshot(s, `own:${run}`),
    onChange: (state) => {
      if (win !== null && !win.isDestroyed()) win.setTitle(statusText(state));
      refreshTray(state);
      // A failed host has no agent to hear from; what the widgets show is stale.
      if (state.mode === "failed") widgets.noSource();
      followFeed();
      pushStateSoon.ask();
    },
  });

  // Without these, an error nothing caught ends the app behind Electron's crash dialog. The host
  // logs it by code and restarts the agent when the app owns it.
  process.on("uncaughtException", () => host.fault());
  process.on("unhandledRejection", () => host.fault());

  /** Shows the window, making it the first time; from the tray, a second launch, startup, or a Clawd clicked in a widget, which names the session to open it on. */
  function showWindow(alias?: string): void {
    const target = alias === undefined ? url : sessionUrl(url, alias);
    const existed = win !== null && !win.isDestroyed();
    win = showOrCreate(win, quitting, () => {
      const workAreas = screen.getAllDisplays().map((display) => display.workArea);
      const created = createMainWindow(target, statusText(host.state()), restoredBounds(store.get().bounds, workAreas), store.get().maximized === true, dist.appIcon);
      // Closing hides the window, and the app and its agent carry on in the tray. Once quitting has
      // begun the close goes through. Either way where it was, and whether it filled the screen, is remembered.
      created.on("close", (event) => {
        store.update({ bounds: created.getNormalBounds(), maximized: created.isMaximized() });
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
      return created;
    });
    // A window that was already showing the page: the same URL with another hash is a navigation
    // inside the document, so nothing reloads, the feed stays connected and the page hears `hashchange`.
    // A load that is superseded or fails rejects; an unhandled rejection here would fault the host.
    if (existed && alias !== undefined && !quitting && win !== null && !win.isDestroyed()) win.loadURL(target).catch(() => {});
  }

  /** What clicking the tray icon or launching the app a second time does: the widgets come forward in widget view, and the full window opens otherwise, or when no widget is open, so the click always does something. */
  function revealApp(): void {
    if (quitting) return;
    if (view() === "widgets" && widgets.showAll() > 0) return;
    showWindow();
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

  /** What the tray checkbox and the settings page show: off too when the entry is switched off in Task Manager. The launch rule below goes by the Run value alone, so it never re-enables an entry the user switched off there. */
  function openAtLogin(): boolean {
    return shownAtLogin(app.getLoginItemSettings(login), loginName);
  }

  function applyOpenAtLogin(on: boolean): void {
    app.setLoginItemSettings({ ...login, openAtLogin: on });
    store.update({ openAtLogin: on });
    refreshMenu();
  }

  /** The view, from the settings window: remembered, applied at once, and answered with whether it could be remembered. */
  function applyView(next: View): boolean {
    store.update({ view: next });
    widgets.setView(next);
    followFeed();
    refreshMenu();
    // Widgets off: the scene goes back where it was. Widgets on leaves the full window as it is.
    if (next === "window") showWindow();
    return store.usable();
  }

  /** The menu is rebuilt whenever the login checkbox or the view could have changed. */
  function refreshMenu(): void {
    tray?.setContextMenu(
      Menu.buildFromTemplate(
        trayMenuTemplate(
          openAtLogin(),
          { open: () => showWindow(), showWidgets: () => { if (widgets.showAll() === 0) showWindow(); }, settings: showSettings, setOpenAtLogin: (on: boolean) => { applyOpenAtLogin(on); pushState(); }, quit: () => app.quit() },
          view(),
        ),
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
      view: store.get().view ?? "window",
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
    applyView,
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
    settingsWin = showOrCreate(settingsWin, quitting, () => {
      const created = createSettingsWindow(join(dist.settings, "preload.js"), dist.appIcon);
      created.on("closed", () => {
        settingsWin = null;
      });
      return created;
    });
  }

  // `ready` fires once Electron has initialised; no window or tray can be made before it.
  const started = app.whenReady().then(async () => {
    // Every app:// request is answered from the export beside main.cjs, under a CSP that lets the
    // page reach only the agent in use.
    protocol.handle(APP_SCHEME, createSchemeHandler({ dirs: { clawd: dist.renderer, settings: dist.settings, widget: dist.widget }, port: () => host.state().port ?? DEFAULT_PORT, fallbackPort: DEFAULT_PORT }));
    log("desktop.started", { packaged: app.isPackaged });
    host.start();
    await store.load();

    // Quitting began while desktop.json was loading: build nothing more.
    if (quitting) return;

    // Every widget window sends on the same channels. The sender's id is the only thing that tells
    // them apart, and the only identity main trusts. `handle` answers; `on` does not.
    const widgetHandlers = createWidgetHandlers(widgets);
    for (const [channel, handler] of Object.entries(widgetHandlers.invoke)) ipcMain.handle(channel, (event, arg: unknown) => handler(event.sender.id, arg));
    for (const [channel, handler] of Object.entries(widgetHandlers.on)) ipcMain.on(channel, (event, arg: unknown) => handler(event.sender.id, arg));

    // desktop.json is read: the remembered view takes effect, and with it the question of whom to ask for snapshots.
    widgets.setView(view());
    followFeed();

    // The tray has to stay referenced for as long as the app runs; `tray` in this closure is that reference.
    trayFile = trayIconFile(0);
    tray = new Tray(trayImage(trayFile));
    tray.on("click", () => revealApp());

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

    // What Electron says about the entry, at every launch: numbers and booleans, so whether
    // `launchItems` can be trusted for a packaged path with spaces is on record from the first run.
    const item = app.getLoginItemSettings(login);
    log("desktop.loginItem", { openAtLogin: item.openAtLogin, willLaunch: item.executableWillLaunchAtLogin, items: item.launchItems.length, shown: shownAtLogin(item, loginName) });
    const action = loginOnLaunch({ packaged: app.isPackaged, remembered: store.get().openAtLogin, registered: item.openAtLogin, stateUsable: store.usable() });
    if (action !== "none") {
      app.setLoginItemSettings({ ...login, openAtLogin: true });
      store.update({ openAtLogin: true });
      refreshMenu();
    }
    if (action === "reapply") log("desktop.loginItemReapplied");

    // In widget view the widgets are the app's face, and they appear with the sessions; --hidden holds back only the full window.
    if (!args.hidden && view() === "window") showWindow();
  });

  // A second launch. One started at login while the app already runs passes --hidden and changes
  // nothing; otherwise it shows the window once startup has loaded desktop.json and made the tray.
  app.on("second-instance", (_event, argv) => {
    if (parseArgs(argv).hidden) return;
    // A startup that failed was already reported once, through `started`, so it is not reported again here.
    void started.then(revealApp, () => {});
  });

  // The tray keeps the app running with no window open. Without a listener here, Electron would quit
  // as soon as the last window closed.
  app.on("window-all-closed", () => {});

  // Quitting, from the tray, Ctrl+Q or Ctrl+C in the terminal: set the flag so the window's close goes
  // through, and take the window away at once. The tray icon goes in will-quit, once the quit is certain.
  app.on("before-quit", () => {
    quitting = true;
    // A rebuild waiting on the coalescer would only build state for a window that is going away.
    pushStateSoon.cancel();
    win?.hide();
    // The flag is set, so followFeed asks nobody; the widgets go with the window, and a snapshot
    // the agent still emits before it is stopped opens nothing.
    feed.stop();
    widgets.shutdown();
  });

  // `will-quit` comes after every window has closed. The handler holds it until the agent has stopped
  // (at most five seconds), writes out the log and desktop.json, then exits.
  app.on(
    "will-quit",
    createQuitHandler({
      begin: () => {
        tray?.destroy();
        tray = null;
      },
      stop: () => host.stop(),
      flush: () => Promise.all([sink.flush(), store.flush()]).then(() => {}),
      exit: (code) => app.exit(code),
      log,
    }),
  );

  // Ctrl+C in the terminal asks for the same sequence.
  process.on("SIGINT", () => app.quit());
  process.on("SIGTERM", () => app.quit());
}
