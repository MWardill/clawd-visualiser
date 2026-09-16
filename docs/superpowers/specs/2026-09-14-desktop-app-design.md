# Desktop app design (`apps/desktop`)

14 September 2026. Approved in conversation. Builds on the local agent design
(`2026-09-12-local-agent-design.md`) and the web app design (`2026-09-12-web-app-design.md`).
The work is staged (§12): each stage is a working app that adds one Electron idea, because the
maintainer is learning Electron as it is built.

## 1. Scope

One Windows application that contains the agent and the visualiser, shipped as a folder in a zip
and run from wherever it is unzipped. Launching it starts the agent inside the app's main process,
opens the panes scene in a window and sits in the tray. Nothing else has to be started and nothing
is installed. Teammates unzip it and run it. The cloud deployment of `apps/web` is unchanged: the
same source with a different build flag.

In scope: package layout, startup and shutdown, the in-process agent supervisor, the static UI over
a custom scheme, the agent's origin changes, hooks that run under the app's own binary, the
settings window, tray and login item, packaging, tests, staging.

Out of scope: an installer, in-app updates and a release workflow (§11 records why and the route
if they are wanted later); macOS and Linux builds (focus is Windows-only already; nothing is built
or tested elsewhere); code signing; the detail levels themselves (the detail levels design,
`2026-09-14-detail-levels-design.md`, which the settings window exposes); remote viewing (M6).

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where the agent runs | In the main process, by calling `startAgent()` | One process, one click. A supervisor (§5) handles faults. Chosen over a utility process for fewer moving parts. |
| How the UI is served | Next static export over `app://clawd/` through `protocol.handle` | No Next server and no extra port. A sandboxed renderer with no preload. |
| Bundling | esbuild for main, preload and the settings page; electron-builder for the package | One bundle carries the agent and core, so the package has no runtime dependencies. |
| The hooks' Node | The app binary with `ELECTRON_RUN_AS_NODE=1` | Teammates need no Node install. Hooks run through bash on Windows (spike-hooks.md), so an environment prefix works. |
| Distribution | An unpacked folder, zipped: electron-builder's `dir` and `zip` targets | Nothing to install, sign or learn beyond packaging. A moved folder is repaired at the next launch (§8). electron-builder's `portable` target is ruled out: it unpacks to a fresh temp directory on every run, so a hook command could never point at the exe. |
| Updates | Manual: unzip the new version over the old folder | No outbound connection from the app and no updater to learn. |
| Settings UI | Plain HTML in the desktop package with a preload bridge | The Next app keeps zero desktop-specific code. |

## 3. Package layout

```
apps/desktop/
  package.json            @clawd/desktop. No dependencies. devDependencies: electron, electron-builder,
                          esbuild, vitest, typescript, @clawd/agent, @clawd/core
  electron-builder.yml
  build/
    bundle.mjs            esbuild: main, preload, settings page script; copies the Next export
    icons.mjs             renders the canonical Clawd matrix to PNG and ICO, dependency-free
  src/
    main.ts               entry: lock, scheme, agent host, tray, window
    args.ts               --hidden, --dev-url; pure
    paths.ts              home, logs, desktop.json, renderer directory
    log.ts                dated file sink for the agent's Logger (codes only)
    agent-host.ts         supervisor: starting, own, attached, restarting, failed
    scheme.ts             app:// handler: path mapping, MIME, CSP; a pure mapper and a thin handler
    window.ts             BrowserWindow, bounds persistence, hide on close
    tray.ts               icon, badge, tooltip, menu
    login.ts              setLoginItemSettings wrapper
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
   re-apply the login item and repair the hooks if the exe has moved (§8, §10), and create the
   window unless `--hidden`.
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
- The window loads `--dev-url`, else `CLAWD_DESKTOP_URL`, else `app://clawd/`. The desktop
  package's `dev` script passes `--dev-url http://localhost:3000` for the hot-reload loop, and
  `start` loads the export (changed in the stage 3 plan, so the export runs before packaging).
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

- The runtime prefix is `ELECTRON_RUN_AS_NODE=1 "<exe>"` where `<exe>` is `process.execPath`: the
  unzipped folder's `Clawd Visualiser.exe` when packaged, `node_modules/electron/dist/electron.exe`
  in development. Forward slashes and quotes as today; `isOurHook` still matches on the script name.
- The written SessionStart command hook reads `ELECTRON_RUN_AS_NODE=1 "C:/Users/<user>/Apps/Clawd
  Visualiser/Clawd Visualiser.exe" "C:/Users/<user>/.clawd/bin/clawd-hook.mjs"`, for a folder
  unzipped there; the status line likewise.
- Electron as Node skips Chromium. Startup is around 100 ms against Node's 40 ms, inside the two
  second hook timeout and the scripts' own guards. Stage 5 measures it on the machine. If the
  status line's refresh feels slow, the fallback is to ship `node.exe` as an extra resource and
  point the prefix at it, a configuration change only.
- The `runAsNode` fuse stays enabled (`electronFuses.runAsNode: true`). Turning it off would break
  every installed hook.
- On launch, `hooks.ts` reads the settings file. `current`: nothing. `stale` (our hook present with
  a different command, as after the folder moved or a new version was unzipped elsewhere): rewrite
  through `installHooks()` with the usual backup, logged as `desktop.hooksRepaired`. `missing`:
  nothing; the settings window offers to install. Until the app is launched from its new place the
  hooks fail quietly, as hooks always do, and events for that interval are missed.
- Uninstall from the app is the CLI's uninstall. Deleting the folder without it leaves the hooks
  pointing at nothing; they keep failing quietly, and the CLI's uninstall or a fresh install repairs
  the settings file.

## 9. Settings window

A second window, 560 by 720, loading `app://settings/`, with `preload.ts` exposing `window.clawd`:

```ts
type SettingsState = {
  agent: { mode: "starting" | "own" | "attached" | "restarting" | "failed"; port: number; version: string; sessions: number; waiting: number };
  app: { version: string; exe: string };
  allowlist: string[];
  hooks: "missing" | "current" | "stale";
  detail: "none" | "hints" | "paths";
  openAtLogin: boolean;
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
  openLogs(): Promise<void>;
  onState(cb: (s: SettingsState) => void): () => void;
};
```

Main validates every argument with zod. Folder edits and level changes save the config and restart
the agent in process, so the README's "restart the agent after changing the allowlist" happens for
the user. Sections, top to bottom: agent, this app (version and where it runs from), watched
folders, hooks, detail level, start on login. Text only, no framework; JetBrains Mono on black,
matching the app. The detail section is present only once the detail levels design has landed.

## 10. Tray, login item, logging

- Tray icon: the canonical Clawd at 16 and 32 px, rendered from the matrix by `build/icons.mjs`,
  plus a variant with an amber dot for waiting above zero. Tooltip: `Clawd Visualiser · 3 sessions ·
  1 waiting`, with `· agent attached` or `· agent failed` appended in those states. Menu: Open,
  Settings, Start on login (checkbox), Quit. Clicking the icon opens the window.
- Login item: `app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] })`. Turned on the first
  time the packaged app runs (a flag in `desktop.json`). The settings toggle and the tray checkbox
  read `getLoginItemSettings()`. On every launch, when it is on, `login.ts` applies it again so the
  registered path follows a moved folder.
- Logs: `~/.clawd/logs/desktop-YYYY-MM-DD.log`, one JSON line per entry, written by the agent's
  `createLogger` with a file sink, so the codes-only rule holds for the desktop. New codes:
  `desktop.started`, `desktop.attached`, `desktop.takeover`, `desktop.agentFault`,
  `desktop.agentFailed`, `desktop.hooksRepaired`, `desktop.loginItemReapplied`. Retention follows
  `logRetentionDays`.

## 11. Packaging and distribution

- electron-builder: `appId: io.github.mwardill.clawd-visualiser`, `productName: Clawd Visualiser`,
  `win.target: ["dir", "zip"]`, `files: ["dist/**"]`, asar on, fuses `runAsNode: true`,
  `enableCookieEncryption: true`, `onlyLoadAppFromAsar: true`. The artifact is
  `Clawd-Visualiser-<version>-win-x64.zip`, holding one folder with `Clawd Visualiser.exe` and its
  resources.
- `pnpm --filter @clawd/desktop package` runs the bundle (§3) and electron-builder. The zip is
  shared by hand or attached to a GitHub release by the maintainer; nothing is automated.
- Version: `apps/desktop/package.json`, shown in the settings window and the tray tooltip on hover.
- Updating: quit the app, unzip the new version over the folder, launch. The hooks and the login
  item point at the same path, so nothing is repaired. Unzipping to a new place is the moved-folder
  case in §8 and §10.
- Signing: none. SmartScreen warns once for an exe extracted from a downloaded zip. An enterprise
  policy that blocks unsigned executables in user-writable directories blocks this too; a
  certificate is the fix, not a code change.
- Ruled out, with the route if wanted later. The `portable` target unpacks to a temp directory per
  run and cannot host the hooks. An NSIS per-user installer would pin the path under the user's
  local programs folder and enable electron-updater against GitHub Releases; that is a separate
  spec, not a change to anything here.

## 12. Stages

| Stage | Delivers | Electron ideas | Done when |
| --- | --- | --- | --- |
| 1 Window | The `apps/desktop` scaffold, the esbuild bundle, a window on the dev server | Main versus renderer, the app lifecycle, `BrowserWindow`, the sandbox defaults, the dev loop | `pnpm --filter @clawd/desktop dev` opens the visualiser against a CLI-started agent |
| 2 Agent inside | The agent host with attach, own and restart, the file logger, clean quit, `onSnapshot` | The main process is Node; the quit sequence; error handling | With the CLI agent stopped, launching the app shows live sessions and no other process runs |
| 3 Packaged UI | The static export, the `app://` handler, CSP, the desktop origin, the private-network header, the smoke test | Custom protocols, origins, CSP | The app shows the scene with no dev server running |
| 4 Tray | Tray, badge, tooltip, hide on close, the single-instance lock, `--hidden`, the login item | `Tray`, `Menu`, the single-instance lock, login items | Closing the window keeps the agent up; the app returns hidden at login |
| 5 Settings | The settings window, preload, IPC, the folder picker, hook install and repair with the runtime prefix | Preload, `contextBridge`, `ipcMain`, dialogs, process-model security | A fresh machine is set up from the app alone |
| 6 Package | Icons, electron-builder with the `dir` and `zip` targets, fuses | Packaging, asar, fuses, `process.execPath` in a packaged app | A teammate unzips the folder, runs the exe, and sets up hooks from the settings window; moving the folder and relaunching repairs the hooks and the login item |
| Post-dev Hardening | The fixes and checks deferred from the stage reviews (§12.1) | None new | Each item in §12.1 is fixed, or dropped with a reason in the decision log |

Each stage has its own plan and branch and is merged before the next starts. Stage 5's detail
section lands with whichever of stage 5 and the detail levels design is later.

### 12.1 Post-dev hardening

Found in the reviews of stage 3 (15 September 2026), and left out of that stage because none of
them breaks the app on the default port. A later stage that touches the same code may take an item
early; otherwise they are done after stage 6.

- **Attaching to an agent that refuses the page.** The health probe (`agent-client.ts`) sends no
  `Origin`, so the host attaches to any agent that answers, including one started before stage 3
  that refuses `app://clawd` with 403. The title then says `agent attached` while the page stays
  simulated. Probe with `Origin: app://clawd`, treat a 403 as an incompatible agent, log a code
  for it, and say so in the title and the tray tooltip. Until then, the desktop README warns the
  maintainer to restart such an agent.
- **Windows device names in `app://` paths.** The scheme mapper accepts segments such as `CON.txt`,
  `NUL.js` or `COM1.json`. On Windows 11 they are ordinary missing files; on Windows 10 they are
  devices, and reading `CON` can hang the request. Refuse any segment whose name before the first
  dot is a reserved device name, with tests, before teammates on Windows 10 run the app.
- **One source for the agent's port.** The first page's CSP is written before the host knows the
  agent's port, so it names `DEFAULT_PORT` for the life of that page, and the export's agent URL
  is fixed at build time. Neither matters on 4750. Before any stage lets the port vary, feed the
  CSP and the page's agent URL from the same configured port, or reload the window once it is known.
- **`connect-src 'self'`.** The policy does not let the page fetch its own `app://` files, and today
  nothing does: the web app has one route and no client navigation. Add `'self'`, with a test, in
  the change that adds `next/link` or router calls.
- **A handler that can reject.** `createSchemeHandler` calls `port()` outside its `try`, so a
  throwing port getter rejects the request. Main's getter cannot throw. Build the policy inside the
  guard with a fallback port, and add a test with a rejecting `readFile`.
- **The 404 body.** Unknown paths get a plain-text `not found` rather than the export's `404.html`.
  Harmless with one route; serve `404.html` once there are more.
- **`args.ts` depends on `scheme.ts`.** It imports `./scheme` only for `APP_URL`, which pulls core,
  zod and `fs` into the pure argument parser. Move the URL to a small constants module, or pass the
  fallback in.
- **The export build.** `build/renderer.mjs` exits without a message when the Next build cannot be
  spawned, and a stale `apps/web/out/index.html` would pass its check. Print the spawn error, and
  remove `apps/web/out` before building.
- **Dev URLs in a packaged app.** `--dev-url` and `CLAWD_DESKTOP_URL` are honoured when packaged,
  while §7 means production to load `app://clawd/`. Ignore both when `app.isPackaged`, or record
  that they stay as a support tool.
- **The built-in `http://localhost:3000` origin.** It can no longer be removed through the config,
  so any local dev server on port 3000 can read the redacted stream and send focus commands, as
  default configs already allowed. Accept that in the decision log, or add an opt-out.
- **zod's eval probe.** zod tests for `Function("")` on every page load, which the CSP reports as
  an eval violation. It is harmless. Set `z.config({ jitless: true })` for the desktop target, or
  note it as expected in the desktop README.
- **Checks still owed from stage 3.** `pnpm --filter @clawd/desktop start` on the default port with
  no dev server, opening a session's detail sheet with no `Refused to` lines in DevTools; hot reload
  in the `dev` loop; a real Claude Code prompt setting a Clawd working in the packaged UI. Stage 3's
  smoke test ran on port 4751 because other processes held 4750 and 3000.

Found in the reviews of stage 4 (15 September 2026). The first item blocks stage 6's "done when"
and is settled in its plan; the rest wait like the items above.

- **Development and packaged builds share one login item.** Both name the Run value after `APP_ID`
  and read `~/.clawd/desktop.json`. Once the packaged app has `openAtLogin: true`, a development run
  re-applies the login item to the repository's `electron.exe`, and the next packaged run points it
  back. Give development its own value name and login choice, or never re-apply when not packaged.
- **An unreadable `desktop.json`.** A read that fails for a reason other than a missing file counts
  as nothing remembered, so the next change overwrites the real file, and a packaged first run would
  turn the login item on against a stored off. A failed write is dropped with no log code. Tell
  unreadable from missing, skip writes and the first-run enable after an unreadable load, and log a
  code for a failed write.
- **Restored bounds.** Bounds saved on a large display are restored at full size on a smaller one,
  the maximised state is not kept, and a title strip across the seam of two displays counts as off
  every display. Clamp the size to the chosen work area.
- **The Start on login checkbox and Task Manager.** The tray checkbox reads `openAtLogin`, which
  ignores an entry disabled in Task Manager's startup list. Stage 5's settings toggle faces the same
  choice; `executableWillLaunchAtLogin` or `launchItems[].enabled` would show it.
- **Ctrl+Q on other keyboard layouts.** `isQuitShortcut` matches `input.key`, so on a layout where
  that key types another letter the shortcut never fires. Also accept `input.code === "KeyQ"`.
- **Tearing the tray down before a quit is certain.** `before-quit` destroys the tray, so a quit
  cancelled by a page's `beforeunload` would leave the agent running with no tray icon. Nothing
  registers `beforeunload` today; destroying the tray in `will-quit` removes the risk.
- **Tray icon scaling.** At 125% and 150% display scaling Windows resamples the 16 or 32 px PNG and
  blurs the pixel art. An ICO with 16, 20, 24 and 32 px images fixes it, with stage 6's icons, along
  with a check that the checked-in icons still match the sprite.
- **Checks still owed from stage 4.** The tray icon and its tooltip; clicking it; the menu's Open,
  Start on login and Quit; the waiting badge with a real permission prompt; unticking Start on
  login; a physical Ctrl+Q; and a real sign-out and sign-in with the login item on, confirming
  Windows does not report the app holding the sign-out up. Stage 4's automated run covered closing,
  second launches, bounds, `--hidden`, the login item's re-apply and the development loop.

## 13. Tests

- Unit tests in `apps/desktop` with vitest: `args`; `scheme` mapping, MIME and CSP text;
  `agent-host` transitions with a fake `startAgent`, probe and clock; `hooks` status and command
  building; `tray` tooltip text; `settings/ipc` handlers with a fake agent and installer; `icons`
  output sizes.
- Agent tests: the built-in origins, the private-network preflight, `onSnapshot`, the installer
  split, `hookStatus`, the runtime prefix in the written command.
- A manual checklist per stage, kept in that stage's plan: the "done when" column above, plus for
  stage 3 the event stream connecting from `app://clawd` in the packaged app, for stage 5 the hook
  and status line latency under the Electron binary, and for stage 6 unzip and run on a second
  Windows account, move the folder and relaunch, remove the hooks from settings, delete the folder.

## 14. Documents

PRD: the architecture gains the desktop app as a fourth component; a Deployment note; milestone
M8 Desktop with the six stages; a decision log row for 14 September 2026 (agent in the main
process; static UI over a custom scheme; hooks under the app binary; a zipped folder, no installer,
`portable` ruled out). README: a Run section pointing at the zip. Agent README: the runtime prefix
and the built-in origins.
