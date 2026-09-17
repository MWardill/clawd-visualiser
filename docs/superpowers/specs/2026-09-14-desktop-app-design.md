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
  electron-builder.yml    dir and zip targets, asar, fuses, extraResources for the icons and the scripts
  build/
    bundle.mjs            esbuild: main, preload, settings page script; copies the tray icons and the hook scripts
    clean.mjs             removes dist before every build
    icons.mjs             renders the canonical Clawd matrix to ICO files, dependency-free; --check compares them
    renderer.mjs          the Next static export, copied to dist/renderer
    smoke-packaged.mjs    runs the packaged app once against scratch folders
  src/
    main.ts               entry: lock, scheme, agent host, tray, window
    args.ts               --hidden, --dev-url; pure
    paths.ts              where the pages, the tray icons and the hook scripts are, in development and packaged
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
  resources/              the tray ICOs and the app icon, generated and checked in
  dist/                   build output, ignored; release/ is the packager's, also ignored
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
  the packaged app's `~/.clawd/desktop.json` and a development run's `desktop-dev.json` (§10).
- The window loads `--dev-url`, else `CLAWD_DESKTOP_URL`, else `app://clawd/`. The desktop
  package's `dev` script passes `--dev-url http://localhost:3000` for the hot-reload loop, and
  `start` loads the export (changed in the stage 3 plan, so the export runs before packaging).
  Packaged, both the flag and the variable are ignored and the export is loaded, so nothing in a
  teammate's environment can point the app elsewhere (stage 6).
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
  through `installHooks()` with the usual backup, logged as `desktop.hooksRepaired`. Only the
  packaged app rewrites unattended: on the maintainer's machine the hooks may belong to the CLI's
  install or to another checkout, and a development launch would otherwise flip them on every run
  and leave a backup each time. A development run still shows `stale` in the settings window, where
  Reinstall is a choice (stage 6). `missing`: nothing; the settings window offers to install. Until
  the app is launched from its new place the hooks fail quietly, as hooks always do, and events for
  that interval are missed.
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

- Tray icon: the canonical Clawd rendered from the matrix by `build/icons.mjs` into an ICO holding
  16, 20, 24 and 32 px images, so Windows picks a crisp one at 100, 125, 150 and 200% scaling, plus a
  variant with an amber dot for waiting above zero. The app's own icon is an ICO up to 256 px from
  the same sprite. `pnpm test` fails if a checked-in icon no longer matches the sprite. Tooltip:
  `Clawd Visualiser · 3 sessions · 1 waiting`, with `· agent attached` or `· agent failed` appended
  in those states. Menu: Open, Settings, Start on login (checkbox), Quit. Clicking the icon opens the
  window.
- Login item: `app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] })`. Turned on the first
  time the packaged app runs (a flag in `desktop.json`). The settings toggle and the tray checkbox
  read `getLoginItemSettings()`. On every launch, when it is on, `login.ts` applies it again so the
  registered path follows a moved folder. In development the Run value has its own name
  (`<appId>.dev`), its toggle is remembered in its own `desktop-dev.json`, and nothing is enabled or
  re-applied at launch, so a development run cannot disturb the packaged app's entry (stages 6 and
  6.1). `desktop.json` is version 2 since stage 6.1; a version 1 file, which only development runs
  before stage 6 wrote, reads as nothing remembered.
- Logs: `~/.clawd/logs/desktop-YYYY-MM-DD.log`, one JSON line per entry, written by the agent's
  `createLogger` with a file sink, so the codes-only rule holds for the desktop. New codes:
  `desktop.started`, `desktop.attached`, `desktop.takeover`, `desktop.agentFault`,
  `desktop.agentFailed`, `desktop.hooksRepaired`, `desktop.hooksFailed` (a hook write that failed or
  threw, with a boolean for whether it was a launch repair), `desktop.folderFailed` (a watched-folder
  change that was refused or threw), `desktop.loginItemReapplied`. Retention follows
  `logRetentionDays`.

## 11. Packaging and distribution

- electron-builder, configured in `electron-builder.yml`: `appId: io.github.mwardill.clawd-visualiser`,
  `win.target: ["dir", "zip"]`, output in `release/` (its default, `dist`, is the bundle's directory),
  asar on, `npmRebuild: false`, fuses `runAsNode: true`, `enableCookieEncryption: true`,
  `onlyLoadAppFromAsar: true`. The archive's `package.json` gets `productName: Clawd Visualiser`
  through `extraMetadata`, the only place the name is written, so the packaged app's name, and
  with it its profile folder under `%APPDATA%` and its single-instance lock, differ from a
  development run's `@clawd/desktop` and neither blocks the other from starting. The archive holds
  `dist/main.cjs`, `dist/renderer/` and `dist/settings/`, without source maps; the tray icons and the
  hook scripts go beside it through `extraResources`, under `resources/tray/` and `resources/hooks/`,
  because the tray loads its icon by path and the installer copies the scripts as files, and an asar
  is read-only and transparent only to Node's read calls. `paths.ts` finds them under
  `process.resourcesPath`. The artifact is `Clawd-Visualiser-<version>-win-x64.zip`, holding the
  unpacked folder's files; Windows' Extract All puts them in a folder named after the zip.
- `pnpm --filter @clawd/desktop package` runs the export, the bundle (§3) and electron-builder.
  `pnpm --filter @clawd/desktop smoke` runs the packaged app once against scratch folders: the exe
  as Node, the packaged start, the agent's health from the visualiser's origin. Its scratch home
  remembers the login item as off, so the packaged app's first-run rule writes no real Run value.
  The script reads that seed back and stops before starting the app if it would not hold. The smoke
  runs the app with its own profile directory (`--user-data-dir`), so an installed copy's
  single-instance lock is not its own. It waits for the log to say whether the app's agent started
  or attached to another one, and fails if it attached. It stops the app by ending its process tree,
  so a Claude CLI call still in flight cannot write into the scratch Claude folder after cleanup.
  `build/clean.mjs` removes `dist` before every development, start and package build, so nothing
  stale is bundled or packaged. The zip is shared by hand or attached to a GitHub release by the
  maintainer; nothing is automated.
- Version: `apps/desktop/package.json`, shown in the settings window and after the status in the
  tray tooltip.
- Updating: quit the app, unzip the new version over the folder, launch. The hooks and the login
  item point at the same path, so nothing is repaired. Unzipping to a new place is the moved-folder
  case in §8 and §10. When a new version changes the hook scripts, open Settings and choose
  Reinstall after updating: the scripts in `~/.clawd/bin` are only refreshed by an install.
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
| 6.1 Review fixes | The thirteen findings of the review of stage 6's merge (§12.1) | None new | Each is done or recorded with a reason |
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
  remove `apps/web/out` before building. Done in stage 6: the previous export is removed first and
  a spawn failure is printed.
- **Dev URLs in a packaged app.** `--dev-url` and `CLAWD_DESKTOP_URL` are honoured when packaged,
  while §7 means production to load `app://clawd/`. Ignore both when `app.isPackaged`, or record
  that they stay as a support tool. Done in stage 6: both are ignored when packaged.
- **The built-in `http://localhost:3000` origin.** It can no longer be removed through the config,
  so any local dev server on port 3000 can read the redacted stream and send focus commands, as
  default configs already allowed. Accept that in the decision log, or add an opt-out.
- **zod's eval probe.** zod tests for `Function("")` on every page load, which the CSP reports as
  an eval violation. It is harmless. Set `z.config({ jitless: true })` for the desktop target, or
  note it as expected in the desktop README.
- **Stage 3's manual check: done.** On 16 September 2026 the maintainer ran
  `pnpm --filter @clawd/desktop start` on the default port, and the page read live rather than
  simulated. Stage 3's automated smoke test had run on port 4751 because other processes held 4750
  and 3000.

Found in the reviews of stage 4 (15 September 2026). The first item blocks stage 6's "done when"
and is settled in its plan; the rest wait like the items above.

- **Development and packaged builds share one login item.** Both name the Run value after `APP_ID`
  and read `~/.clawd/desktop.json`. Once the packaged app has `openAtLogin: true`, a development run
  re-applies the login item to the repository's `electron.exe`, and the next packaged run points it
  back. Give development its own value name and login choice, or never re-apply when not packaged.
  Done in stage 6: a development run has its own value name, its toggle is not remembered, and
  nothing is applied at launch unless packaged. Stage 6.1 remembers that toggle too, in its own
  `desktop-dev.json`.
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
  choice; `executableWillLaunchAtLogin` or `launchItems[].enabled` would show it. Check them against
  the packaged app first: stage 6's automated walk saw `launchItems` empty and
  `executableWillLaunchAtLogin` false for the packaged exe, whose path has spaces, while the Run
  value was right and `openAtLogin` was true.
- **Ctrl+Q on other keyboard layouts.** `isQuitShortcut` matches `input.key`, so on a layout where
  that key types another letter the shortcut never fires. Also accept `input.code === "KeyQ"`.
- **Tearing the tray down before a quit is certain.** `before-quit` destroys the tray, so a quit
  cancelled by a page's `beforeunload` would leave the agent running with no tray icon. Nothing
  registers `beforeunload` today; destroying the tray in `will-quit` removes the risk.
- **Tray icon scaling.** At 125% and 150% display scaling Windows resamples the 16 or 32 px PNG and
  blurs the pixel art. An ICO with 16, 20, 24 and 32 px images fixes it, with stage 6's icons, along
  with a check that the checked-in icons still match the sprite. Done in stage 6: ICOs at 16, 20, 24
  and 32 px, and `pnpm test` checks the files against the sprite.
- **Stage 4's manual checks: done.** The maintainer walked them on 16 September 2026: the tray icon
  and its tooltip, clicking it, the menu's Open, Start on login and Quit, the waiting badge,
  unticking Start on login, and Ctrl+Q. Stage 4's automated run had already covered closing, second
  launches, bounds, `--hidden`, the login item's re-apply and the development loop. Worth repeating
  once stage 6 packages the app: a real sign-out and sign-in with the login item on, since the
  packaged entry differs from the development one.
- **Stage 6's manual checks: partly done.** On 17 September 2026 the maintainer marked a copy of the
  zip as downloaded, extracted it with Explorer and saw SmartScreen's warning, ran the app against
  scratch folders, set the hooks up from the settings window, saw a real Claude Code session's Clawd
  and its status line, and saw the tray icon crisp at 125% and 150% after relaunching at each scale.
  The same day an automated walk of the zip against scratch folders loaded the window and the
  settings page from inside the archive, moved the folder and saw the hooks and the login item
  repaired with the Run value quoted, ran a development run beside the packaged app without either
  disturbing the other, and removed the hooks with a backup left. One hook under the packaged exe
  took 85 to 87 ms, and the whole installed command about 140 to 190 ms through Git Bash; the exe
  starts as Node in about 85 ms once Windows has seen it, and took 593 ms on the first launch of a
  fresh build. Still to walk, on the next packaged install: a real sign-out and sign-in with the
  login item on, with Task Manager's Startup apps list, which is the only proof that Windows starts
  the app from the Run value; and deleting the folder while a session runs. That one is checked only
  at the command: a hook naming a missing exe fails in about 50 ms with exit code 127 and no dialog,
  which Claude Code treats as a non-blocking error.

Found in the reviews of stage 5 (16 September 2026).

- **A restart the user asked for clears the fault budget.** `agent-host.ts`'s `restart()`, which the
  settings window calls after a folder or detail-level change, resets the fault history, so the
  give-up path cannot fire while restarts keep arriving. That is deliberate: only the settings window
  calls it, nobody clicks faster than five crashes accumulate, and keeping the budget would deny a
  clean start to someone who has just fixed a bad config. Revisit it if anything else ever calls
  `restart()`, especially on a timer.
- **The settings actions are rules living in untested glue.** `main.ts`'s actions object decides
  things: save, then restart only when the save succeeded, and log a code when a write fails. That is
  where the last-folder defect lived and where two more were found in review. `createHandlers`
  already takes its actions injected, so a `createSettingsActions(deps)` factory could be tested with
  doubles and leave `main.ts` as the wiring the design intends.
- **The settings window does not get the app's font.** The build copies only the page's markup and
  stylesheet into its directory, and the settings origin may load only its own files, so the face the
  visualiser uses is out of reach and the window falls back to whatever the machine has. Ship the
  font beside the page, or accept the fallback deliberately.
- **A status line removed by hand is reinstated at every launch.** `hookStatus` calls our hook
  present with the status line missing `stale`, and launch repair now runs unattended, so it writes
  back something the user deleted. Decide whether that is repair or override; the same predicate also
  drives the settings window's Reinstall button, where writing it back is clearly right.
- **The preload carries the validation library.** The bridge script imports only the channel names,
  but the module holding them also builds a schema, and `@clawd/core` is not marked side-effect free,
  so the bundler keeps the whole barrel: roughly 750 kB loaded before every settings page. Mark the
  core package side-effect free, or move the channel names into a module of their own.
- **The hook check ignores the port and the token.** `hookStatus` compares only the command hook and
  the status line, not the HTTP hook that carries the agent's port and token. A settings file whose
  port was edited, or whose token no longer matches after `config.json` was recreated, still reports
  `current`: the launch repair never fires, the settings window says the hooks are installed, and
  events are lost with nothing said. Decide it together with the hand-deleted status line item above,
  since both are what `stale` should mean.
- **The bridge cannot tell the user an action was refused.** Every call answers with the whole state
  and nothing else, so a refusal — a drive root picked in the folder dialog, say — re-renders an
  identical page. Two defects have traced to this. The refusal now logs a code, which makes it
  diagnosable but not visible. Adding a message to the bridge's answers would breach this stage's rule
  that the list of calls does not grow, so it belongs to a stage that revisits the bridge.
- **The failed agent's reason is never shown.** The host keeps a message for an unusable config, which
  the design says the settings window should show beside the log directory and the retry button. The
  directory is now rendered, but the reason has no route to the page: it is not part of the state the
  bridge carries. Add it when the bridge next changes.

Found in the overall review of the desktop app at stage 5 (17 September 2026). Three were taken into
stage 6: the launch repair no longer runs unattended in development, the folder picker belongs to the
settings window, and the detail setter is caught and logged. The rest wait for the hardening pass.

- **Attached mode applies nothing.** `addFolder`, `removeFolder` and `setDetail` save the config and
  call `host.restart()`, but while the host is attached to another process's agent `release()` is a
  no-op and `attempt()` re-attaches, so the other agent keeps its allowlist and detail level while the
  page lists the change as applied, with no log code. Detect attached in the actions, log a code, and
  carry a notice into the state when the bridge next changes.
- **An unreadable config or settings file reads as "not installed".** `hookOptions()` maps a
  `ConfigError` to null, and `currentHookStatus()` maps that, an invalid-JSON settings file, or a
  settings file that is a JSON array (cast without `isJsonObject`) to `missing`. The page then hides
  Remove, the launch repair is skipped, and the offered Install fails silently. Add an `unreadable`
  status and use `isJsonObject` on the read.
- **`install()` saves the config before the hooks can still fail.** The allowlist and port are written
  through `setAllowlist()` before `installHooks()` copies the scripts and re-reads the settings file;
  a copy failure, or a settings file rewritten between the dry-run check and the real read, leaves
  the config changed while "nothing was changed" is printed, and a config change between the two reads
  can save the empty allowlist the pre-check meant to forbid. Save the config once inside
  `installHooks` after the copy, passing the merged allowlist in; that also removes the four config
  reads per install, the second merge, the unreachable guard after `setAllowlist`, and the unread
  `HooksResult.allowlist` field.
- **An install from the app can mint a token the serving agent lacks.** With no config in the app's
  home the installer falls back to a default config with a fresh token, and the agent is not
  restarted; attached to an agent running from a different home, the written hooks carry a token that
  agent refuses while the page says installed. Refuse or warn when installing hooks without owning the
  agent, and never create a config from the settings window.
- **The settings page rebuilds itself on every push.** `render()` replaces every node when the text
  differs, which is what drops the button's `aria-busy` guard (a second Add folder during the picker,
  now modal but still a second request once it closes), resets an in-flight radio for the moment
  between a coalesced push and the answer, wipes a text selection, and swallows a click split across
  old and new nodes. Patch counters and `checked` in place and rebuild only the folder list, with the
  page test harness this list already calls for.
- **Every state build reads the config twice.** `currentState()` reads and parses `config.json`, then
  `currentHookStatus()` reads it again before the settings file, in series; at startup the fallback
  build is followed by a second `currentHookStatus()` for the launch repair. Read once and pass the
  config into a `hookStatusFor(config)`, and reuse the startup state's `hooks` for the repair.
- **The login toggle from the page builds the state twice.** `setOpenAtLogin()` ends with
  `pushState()`, and the IPC action then returns a second `currentState()`; the page renders both.
  Split apply from push.
- **The bridge is typed by hand in three places.** `Api` in the page, `SettingsActions` in the
  handlers and an untyped literal in the preload, with nothing linking them; the unions copied into
  `settings/state.ts` are checked one way only. One `SettingsApi` in the import-free `settings/state.ts`,
  `satisfies` on the preload literal, and `Omit` for the actions.
- **Two copies of the window hardening and of show-or-create.** `createSettingsWindow` repeats
  `createMainWindow`'s options and guards, and `showWindow` and `showSettings` already diverge
  (`showSettings` has no quitting guard and no `restore()`). One hardened-window factory and one
  show-or-create helper.
- **The desktop calls the CLI-shaped uninstall with a no-op printer.** `uninstall()` returns 0 for
  three outcomes and reports refusals only through `print`, so the desktop cannot tell removed from
  nothing-to-remove or log which refusal happened. Split it the way install was: a result-returning
  core with the CLI's printing on top, and the same for `setDetail`.
- **Two host tables in `scheme.ts`.** Host to directory and host to policy are two ternaries, the URL
  is parsed twice per request, and `settingsPolicy()` rebuilds a constant. One per-host table
  consulted once, which is also where the "handler that can reject" item above belongs.
- **The detail default duplicates `detailLevel()`.** `currentState` writes `config?.detail ?? "none"`
  while the agent uses `detailLevel()`, which the agent package does not export. Export it and call it.

Found in the final review of stage 6 (17 September 2026). They wait for the hardening pass.

- **An update does not refresh the hook scripts.** An in-place update (quit, unzip over, launch)
  keeps `process.execPath`, the port and the token, so the hook status stays `current` and the
  launch repair finds nothing to do; the three scripts the installer copied into `~/.clawd/bin` are
  left at the old version. The real fix is to compare the scripts bundled beside the archive with
  the copies in `~/.clawd/bin` at launch, or stamp them with the version, and copy them again when
  they differ. Until then, the documents tell the maintainer to choose Reinstall from Settings after
  an update that changes the scripts.
- **The icon check compares bytes.** `build/icons.mjs --check` compares the checked-in ICOs with a
  fresh render byte for byte, and the PNGs inside come from `node:zlib`, so a Node upgrade that
  changes zlib's output fails `pnpm test` with no sprite change. Compare decoded pixels instead,
  which `icons.test.ts` already knows how to do. Done in stage 6.1: pixels, after vitest.
- **Two fuses the app does not need are still on.** `EnableNodeOptionsEnvironmentVariable` and
  `EnableNodeCliInspectArguments` are separate from `runAsNode`, so turning them off would not
  affect the hooks. Consider them with signing.
- **The smoke check can be answered by another agent.** If a CLI agent already holds the port, the
  packaged app attaches and the health answer comes from that agent. The app logs
  `desktop.attached` then, so the smoke script can fail or say so when the newest log contains it.
  Done in stage 6.1: it waits for the log to say which agent serves the port.

Found in the review of stage 6's merge (17 September 2026), and taken as stage 6.1.

- **A stale development login choice steered the packaged first run.** Development runs before
  stage 6 wrote `openAtLogin` into the one `desktop.json`, and this machine's held `false`, so the
  packaged app's first run would never have enabled the login item. Done: version 2, and
  `desktop-dev.json` for development.
- **A pre-stage-6 development Run value is orphaned by the `.dev` rename.** Nothing in the app can
  see it now. Recorded in the desktop README's development note with the one-line removal.
- **The smoke shared the installed app's lock and missed an early exit.** Done: its own profile
  directory, and the waits stop when the process exits.
- **The smoke's cleanup could throw out of its `finally`.** Done: `rm` retries and warns.
- **The smoke re-spelled five private formats.** Done: bundled from the TypeScript.
- **The smoke could be answered by another agent.** Done: the smoke waits for the log to say
  whether the app's agent started or attached, and fails if it attached.
- **The poller's stop left an in-flight CLI call running.** Done: stopping the poller, or its
  timeout, ends the command's whole process tree, since ending only the shell left the CLI the
  `.cmd` shim started. The smoke ends the app's own tree the same way, which is why its re-delete
  loop went.
- **The icon check compared bytes and gated the whole test run.** Done: pixels, after vitest.
- **The 2× renderer had no caller and its test compared it with itself.** Done: gone.
- **Three targeted `rm` calls instead of one clean step.** Done: `build/clean.mjs` first.
- **The product name was typed twice in `electron-builder.yml`.** Done: `extraMetadata` alone.
- **The tray was rebuilt on every snapshot.** Done: the tooltip is compared and the two images
  are cached.
- **The stage 4 README note still described PNG icons and the bare id.** Done.
- **`packaged` stands in for "the only installer on this machine".** The launch repair rewrites any
  hook of ours whose command is not this exe's, so two packaged copies, or a packaged app beside the
  CLI's install, take turns rewriting the hooks and leaving a backup each. Accepted for now: the
  package is for teammates without the CLI, and the maintainer's machine runs one or the other. The
  cure, if wanted, goes with stage 7's hook-status rework: repair only when the installed command's
  exe is this one or no longer exists, and otherwise show `stale` and offer Reinstall.
- **The `distPaths` tests spell Windows paths.** By the design's rule that nothing is tested
  elsewhere. Accepted.

Found while stage 6.1 was built, and done in it.

- **`exec`'s own timeout also ended only the shell.** Done with the same tree kill.
- **Decoding pixels made the icon check crash on a truncated file.** Done: a damaged or padded file
  reads as different.
- **The smoke's seed could fail silently, and the packaged app's first-run rule would then write a
  real Run value.** Done: the smoke reads the seed back and stops before starting the app.

Asked for while stage 5 was finishing (16 September 2026). Not a review finding; the shape below was
settled in conversation, so whoever picks it up does not have to decide it again.

- **A wait nobody answers should stop being shown.** `isShown` shows a waiting session for as long
  as it waits, so a permission prompt left unanswered keeps its Clawd on screen for days. It should
  be shown while waiting only until it has been waiting longer than a new `waitingHideMs` in
  `StateConfig`, default 36 hours, following its neighbours' naming and their strictly-less-than
  boundary. Past that the session falls through to the existing rules, which hide it whatever its
  prompt count, since a stale wait is not activity. Two decisions go with it. It stays `waiting` in
  the fleet rather than being re-stated as idle, so answering the prompt makes it working and it
  returns at once, and so a heavily used session does not linger on screen as idle instead. And the
  36 hours are measured from `since`, the moment it entered the state, not from its last activity,
  which a tool finishing or a subagent stopping elsewhere could otherwise push back. One condition
  in `visibility.ts` carries it: the snapshot format, the scene, the web app and the agent are all
  untouched, and both places that build a `StateConfig` spread the defaults, so a new field with a
  default reaches them. Hiding it also drops it from the tray badge, the window title and the status
  bar, which all read the snapshot, and a pane whose only session is a stale wait goes with it.
  Worth testing at either side of the boundary, with and without prompts, that an answer after the
  limit brings it back, and that the four committed golden snapshots do not move, since each replays
  a short captured run.

Skipped when the settings page's choices became radio groups (16 September 2026).

- **The settings page is no longer only glue, and nothing tests it.** The plan left `page.ts`
  untested because it only drew what main sent. It now decides four things: a push that changes
  nothing does not redraw, a redraw puts keyboard focus back on the control that had it, a slow
  answer to an earlier choice does not overwrite a later one, and a failed request redraws main's
  last state so a radio the browser already moved goes back. All four were checked once, by hand, in
  an offscreen Electron window with a stub bridge and real key presses; that script was not kept.
  The suggested fix is a DOM environment for vitest (happy-dom or jsdom, a new dev dependency) and a
  page test with a stub `window.clawd` covering those four. Arrow keys moving between radios are the
  browser's own and need no test.

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
