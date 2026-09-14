# Desktop app design (`apps/desktop`)

14 September 2026. Approved in conversation. Builds on the local agent design
(`2026-09-12-local-agent-design.md`) and the web app design (`2026-09-12-web-app-design.md`).
The work is staged (§12): each stage is a working app that adds one Electron idea, because the
maintainer is learning Electron as it is built.

## 1. Scope

One Windows application, installed per user, that contains the agent and the visualiser. Launching
it starts the agent inside the app's main process, opens the panes scene in a window and sits in
the tray. Nothing else has to be started. Teammates install it from a GitHub release. The cloud
deployment of `apps/web` is unchanged: the same source with a different build flag.

In scope: package layout, startup and shutdown, the in-process agent supervisor, the static UI over
a custom scheme, the agent's origin changes, hooks that run under the app's own binary, the
settings window, tray and login item, packaging, updates and release, tests, staging.

Out of scope: macOS and Linux builds (focus is Windows-only already; nothing is built or tested
elsewhere), code signing beyond a configured slot, the detail levels themselves (the detail levels
design, `2026-09-14-detail-levels-design.md`, which the settings window exposes), remote viewing (M6).

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where the agent runs | In the main process, by calling `startAgent()` | One process, one click. A supervisor (§5) handles faults. Chosen over a utility process for fewer moving parts. |
| How the UI is served | Next static export over `app://clawd/` through `protocol.handle` | No Next server and no extra port. A sandboxed renderer with no preload. |
| Bundling | esbuild for main, preload and the settings page; electron-builder for the installer | One bundle carries the agent and core, so the package has a single runtime dependency (electron-updater). |
| The hooks' Node | The app binary with `ELECTRON_RUN_AS_NODE=1` | Teammates need no Node install. Hooks run through bash on Windows (spike-hooks.md), so an environment prefix works. |
| Installer | NSIS, per user, one click | No admin rights. A fixed install path, so hook commands survive updates. |
| Updates | electron-updater against GitHub Releases | The repository lives on GitHub; no infrastructure. Applied only when asked. |
| Settings UI | Plain HTML in the desktop package with a preload bridge | The Next app keeps zero desktop-specific code. |

## 3. Package layout

```
apps/desktop/
  package.json            @clawd/desktop. dependencies: electron-updater. devDependencies: electron,
                          electron-builder, esbuild, vitest, typescript, @clawd/agent, @clawd/core
  electron-builder.yml
  build/
    bundle.mjs            esbuild: main, preload, settings page script; copies the Next export
    icons.mjs             renders the canonical Clawd matrix to PNG and ICO, dependency-free
  src/
    main.ts               entry: lock, scheme, agent host, tray, window, updater
    args.ts               --hidden, --dev-url; pure
    paths.ts              home, logs, desktop.json, renderer directory
    log.ts                dated file sink for the agent's Logger (codes only)
    agent-host.ts         supervisor: starting, own, attached, restarting, failed
    scheme.ts             app:// handler: path mapping, MIME, CSP; a pure mapper and a thin handler
    window.ts             BrowserWindow, bounds persistence, hide on close
    tray.ts               icon, badge, tooltip, menu
    login.ts              setLoginItemSettings wrapper
    updater.ts            electron-updater wiring and its state
    hooks.ts              hook status (missing, current, stale), repair, the runtime prefix
    settings/
      preload.ts          the contextBridge API
      ipc.ts              ipcMain handlers, zod-validated
      page.html, page.ts  the settings window
  resources/              generated icons, checked in
  dist/                   build output, ignored
```

Main-process code stays thin. Anything with logic (path mapping, supervisor transitions, the hook
command, tooltip text, argument parsing) is a pure module with tests, as in the agent.

## 4. Startup and shutdown

1. `app.requestSingleInstanceLock()`. A second instance exits; the first receives its arguments
   and shows the window.
2. Before `ready`: `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard:
   true, secure: true, supportFetchAPI: true } }])`.
3. On `ready`: register the scheme handler (§7), start the agent host (§5), create the tray (§10),
   create the window unless `--hidden`, start the updater (§11).
4. Closing the window hides it. Quit (tray menu or Ctrl+Q) sets a quitting flag, hides the window,
   awaits `host.stop()` and calls `app.exit(0)`. `will-quit` is held until the stop resolves, capped
   at five seconds.
5. `uncaughtException` and `unhandledRejection` in main are logged by code and handed to the host
   (§5). The app never shows Electron's crash dialog.

## 5. Agent host

Wraps `startAgent({ home: defaultHome(), log, onSnapshot })` (§6 adds the option).

States: `starting → own | attached | failed`; `own → restarting → own | failed`; `attached → own`.

- **own.** `startAgent` resolved; the app holds the `RunningAgent`.
- **attached.** `startAgent` threw `PortInUseError` and a health probe on the port answered within
  500 ms: another agent (the CLI's, say) is serving. The host polls health every 10 s and, when it
  stops answering, starts its own (takeover).
- **restarting.** A fault while own. The host stops what it can and calls `startAgent` again after a
  backoff of 1, 2, 4, 8 then 16 s. Five faults inside five minutes lead to failed.
- **failed.** The tray shows the error state; the settings window shows the log directory and a
  Retry button, which returns to starting.

Faults: `startAgent` rejecting with anything but `PortInUseError` or `ConfigError`; an
`uncaughtException` or `unhandledRejection` reaching main. A `ConfigError` (an unusable
`config.json`) goes straight to failed with the CLI's message, which names a field and never a value.

Counts for the tray come from `onSnapshot` when own, and from `GET /api/snapshot` every 10 s when
attached.

## 6. Agent changes

- `AgentOptions.onSnapshot?: (s: Snapshot) => void`, wired as one more host listener. Nothing else
  changes for hosting; the CLI's `serve` calls the same function.
- `DESKTOP_ORIGIN = "app://clawd"` in core's `schema/transport.ts`.
- `BUILTIN_ORIGINS` in the agent: `http://localhost:3000`, `http://127.0.0.1:3000` and
  `DESKTOP_ORIGIN`. `checkOrigin` receives the built-ins plus `config.corsOrigins`; the config
  default becomes `[]`. Existing config files that list the localhost origins keep working.
- A preflight from an allowed origin carrying `Access-Control-Request-Private-Network: true` is
  answered with `Access-Control-Allow-Private-Network: true`.
- The installer's `InstallOptions.node` becomes `runtime`: the exact command prefix. The CLI passes
  the quoted Node path; the desktop passes the prefix in §8. `install()` splits into
  `setAllowlist()` and `installHooks()`; the CLI composes them as today and the settings window
  calls them separately. `hookStatus(settingsPath, expectedCommand)` returns `missing`, `current`
  or `stale`.

## 7. Renderer

- One `BrowserWindow`: 1280 by 800, black background, `autoHideMenuBar`, `webPreferences: {
  sandbox: true, contextIsolation: true, nodeIntegration: false }`, no preload. Bounds persist in
  `~/.clawd/desktop.json`.
- Production loads `app://clawd/`. Development loads `--dev-url`, else `CLAWD_DESKTOP_URL`, else
  `http://localhost:3000`.
- The scheme handler maps `app://clawd/<path>` to `<renderer dir>/<path>` and `/` to `index.html`.
  The mapper is pure: it decodes, normalises, refuses `..` and absolute paths, and returns null for
  anything outside the renderer directory. MIME comes from a fixed table (html, js, css, json, png,
  ico, svg, woff2, txt, map); anything else is 404.
- Every response carries `Content-Security-Policy: default-src 'self'; script-src 'self'
  'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
  connect-src http://127.0.0.1:<port> http://localhost:<port>; frame-ancestors 'none'`, with the
  agent's port. Inline is allowed because Next's export emits inline scripts; the renderer is
  sandboxed and the network is limited to the agent, which is where the policy earns its keep.
- `app://settings/` serves the settings page from `<dist>/settings/` in a window with the preload (§9).
- Next: `output: "export"` and `images: { unoptimized: true }` when `CLAWD_TARGET=desktop`. The web
  app's source is otherwise untouched.
- Private network checks. Stage 3 starts with a packaged smoke test that the event stream connects
  from `app://clawd`. If Chromium prompts, main grants the permission for the app origin in
  `session.setPermissionRequestHandler`. If it still blocks, main calls
  `app.commandLine.appendSwitch("disable-features",
  "PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks")`
  before `ready`. Each step is tried in that order and the one that works is kept.

## 8. Hooks under the app's binary

- The runtime prefix when packaged is `ELECTRON_RUN_AS_NODE=1
  "C:/Users/<user>/AppData/Local/Programs/Clawd Visualiser/Clawd Visualiser.exe"`. In development it
  is the same with `node_modules/electron/dist/electron.exe`. Forward slashes and quotes as today;
  `isOurHook` still matches on the script name.
- The written SessionStart command hook reads `ELECTRON_RUN_AS_NODE=1 ".../Clawd Visualiser.exe"
  "C:/Users/<user>/.clawd/bin/clawd-hook.mjs"`; the status line likewise.
- Electron as Node skips Chromium. Startup is around 100 ms against Node's 40 ms, inside the two
  second hook timeout and the scripts' own guards. Stage 5 measures it on the machine. If the
  status line's refresh feels slow, the fallback is to ship `node.exe` as an extra resource and
  point the prefix at it, a configuration change only.
- The `runAsNode` fuse stays enabled (`electronFuses.runAsNode: true`). Turning it off would break
  every installed hook.
- On launch, `hooks.ts` reads the settings file. `current`: nothing. `stale` (our hook present with
  a different command, as after the install directory moved): rewrite through `installHooks()`
  with the usual backup, logged as `desktop.hooksRepaired`. `missing`: nothing; the settings
  window offers to install.
- Uninstall from the app is the CLI's uninstall.

## 9. Settings window

A second window, 560 by 720, loading `app://settings/`, with `preload.ts` exposing `window.clawd`:

```ts
type SettingsState = {
  agent: { mode: "starting" | "own" | "attached" | "restarting" | "failed"; port: number; version: string; sessions: number; waiting: number };
  allowlist: string[];
  hooks: "missing" | "current" | "stale";
  detail: "none" | "hints" | "paths";
  openAtLogin: boolean;
  update: { current: string; state: "idle" | "checking" | "available" | "downloading" | "ready" | "error"; latest?: string };
  logDir: string;
};

type ClawdSettingsApi = {
  getState(): Promise<SettingsState>;
  addFolder(): Promise<SettingsState>;          // opens the folder picker
  removeFolder(dir: string): Promise<SettingsState>;
  installHooks(): Promise<SettingsState>;
  uninstallHooks(): Promise<SettingsState>;
  setDetail(level: SettingsState["detail"]): Promise<SettingsState>;
  setOpenAtLogin(on: boolean): Promise<SettingsState>;
  retryAgent(): Promise<SettingsState>;
  checkForUpdates(): Promise<SettingsState>;
  restartToUpdate(): Promise<void>;
  openLogs(): Promise<void>;
  onState(cb: (s: SettingsState) => void): () => void;
};
```

Main validates every argument with zod. Folder edits and level changes save the config and restart
the agent in process, so the README's "restart the agent after changing the allowlist" happens for
the user. Sections, top to bottom: agent, watched folders, hooks, detail level, start on login,
updates. Text only, no framework; JetBrains Mono on black, matching the app. The detail section
is present only once the detail levels design has landed.

## 10. Tray, login item, logging

- Tray icon: the canonical Clawd at 16 and 32 px, rendered from the matrix by `build/icons.mjs`,
  plus a variant with an amber dot for waiting above zero. Tooltip: `Clawd Visualiser · 3 sessions ·
  1 waiting`, with `· agent attached` or `· agent failed` appended in those states. Menu: Open,
  Settings, Start on login (checkbox), Check for updates, Quit, and Restart to update when one is
  ready. Clicking the icon opens the window.
- Login item: `app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] })`. Turned on the first
  time the packaged app runs (a flag in `desktop.json`). The settings toggle and the tray checkbox
  read `getLoginItemSettings()`.
- Logs: `~/.clawd/logs/desktop-YYYY-MM-DD.log`, one JSON line per entry, written by the agent's
  `createLogger` with a file sink, so the codes-only rule holds for the desktop. New codes:
  `desktop.started`, `desktop.attached`, `desktop.takeover`, `desktop.agentFault`,
  `desktop.agentFailed`, `desktop.hooksRepaired`, `desktop.update`. Retention follows
  `logRetentionDays`.

## 11. Packaging, updates, release

- electron-builder: `appId: io.github.mwardill.clawd-visualiser`, `productName: Clawd Visualiser`,
  NSIS with `oneClick: true` and `perMachine: false`, `files: ["dist/**"]`, asar on, fuses
  `runAsNode: true`, `enableCookieEncryption: true`, `onlyLoadAppFromAsar: true`. Install path
  `%LOCALAPPDATA%\Programs\Clawd Visualiser`.
- Version: `apps/desktop/package.json`. The tag `desktop-v<version>` must match or the workflow fails.
- Updates: `autoUpdater` with the GitHub provider, `autoDownload: true`, `autoInstallOnAppQuit:
  false`. Checked 30 s after start and every six hours. When a download is ready the tray and the
  settings window offer Restart to update. Nothing restarts on its own, so sessions are never
  disturbed.
- Release: `.github/workflows/desktop-release.yml` on `push` of tags `desktop-v*`, on
  `windows-latest`, with pnpm: `pnpm --filter @clawd/desktop build`, then `electron-builder --win
  --publish always` with `GITHUB_TOKEN`. It creates a draft release the maintainer publishes.
- Signing: `win.certificateFile` and `certificatePassword` from repository secrets when present.
  Without them the installer is unsigned and SmartScreen warns on first run. Risk: an enterprise
  policy may block unsigned installers; a certificate is the fix, not a code change.

## 12. Stages

| Stage | Delivers | Electron ideas | Done when |
| --- | --- | --- | --- |
| 1 Window | The `apps/desktop` scaffold, the esbuild bundle, a window on the dev server | Main versus renderer, the app lifecycle, `BrowserWindow`, the sandbox defaults, the dev loop | `pnpm --filter @clawd/desktop dev` opens the visualiser against a CLI-started agent |
| 2 Agent inside | The agent host with attach, own and restart, the file logger, clean quit, `onSnapshot` | The main process is Node; the quit sequence; error handling | With the CLI agent stopped, launching the app shows live sessions and no other process runs |
| 3 Packaged UI | The static export, the `app://` handler, CSP, the desktop origin, the private-network header, the smoke test | Custom protocols, origins, CSP | The app shows the scene with no dev server running |
| 4 Tray | Tray, badge, tooltip, hide on close, the single-instance lock, `--hidden`, the login item | `Tray`, `Menu`, the single-instance lock, login items | Closing the window keeps the agent up; the app returns hidden at login |
| 5 Settings | The settings window, preload, IPC, the folder picker, hook install and repair with the runtime prefix | Preload, `contextBridge`, `ipcMain`, dialogs, process-model security | A fresh machine is set up from the app alone |
| 6 Ship | Icons, electron-builder, fuses, the updater, the release workflow | Packaging, asar, fuses, auto-update, signing | A teammate installs from a GitHub release and receives the next tag as an update |

Each stage has its own plan and branch and is merged before the next starts. Stage 5's detail
section lands with whichever of stage 5 and the detail levels design is later.

## 13. Tests

- Unit tests in `apps/desktop` with vitest: `args`; `scheme` mapping, MIME and CSP text;
  `agent-host` transitions with a fake `startAgent`, probe and clock; `hooks` status and command
  building; `tray` tooltip text; `settings/ipc` handlers with a fake agent and installer; `icons`
  output sizes.
- Agent tests: the built-in origins, the private-network preflight, `onSnapshot`, the installer
  split, `hookStatus`, the runtime prefix in the written command.
- A manual checklist per stage, kept in that stage's plan: the "done when" column above, plus for
  stage 3 the event stream connecting from `app://clawd` in the packaged app, for stage 5 the hook
  and status line latency under the Electron binary, and for stage 6 install, update and uninstall
  on a second Windows account.

## 14. Documents

PRD: the architecture gains the desktop app as a fourth component; a Deployment note; milestone
M8 Desktop with the six stages; a decision log row for 14 September 2026 (agent in the main
process; static UI over a custom scheme; hooks under the app binary). README: an Install section
pointing at releases. Agent README: the runtime prefix and the built-in origins.
