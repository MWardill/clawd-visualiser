# @clawd/desktop

The desktop app: the agent and the visualiser in one window and the tray, run from a folder.
Built in stages, one Electron idea at a time. Design:
`docs/superpowers/specs/2026-09-14-desktop-app-design.md`.

## Run

Build the web app into the desktop app and open it. Nothing else needs to be running:

```
pnpm --filter @clawd/desktop start
```

`start` builds the web app as a static export, copies it to `dist/renderer`, bundles `src/main.ts`
into `dist/main.cjs` and opens the window on `app://clawd/`. The agent runs inside the app. If an
agent is already serving its port (the CLI's `pnpm --filter @clawd/agent start`), the app attaches
to it instead and starts its own when that one stops; the window title says which. The app's log is
`~/.clawd/logs/desktop-YYYY-MM-DD.log`, and in development the same lines print to the terminal.

The export talks to the agent at `http://127.0.0.1:4750`, unless `NEXT_PUBLIC_AGENT_URL` was set
when it was built. An agent started before stage 3, such as a CLI agent left running from earlier,
does not know the `app://clawd` origin and refuses the page: the app still attaches to it and the
title says `agent attached`, but the page stays simulated. Restart that agent, or stop it and let
the app run its own.

The app lives in the tray. Closing the window hides it and the agent keeps running; click the tray
icon to bring it back, and quit from the tray menu or with Ctrl+Q. Only one copy runs: starting it
again shows the running copy's window. `--hidden` starts it with only the tray icon, as the login
item does. The window's position and the login choice are kept in `~/.clawd/desktop.json`.

Settings opens from the tray. It watches folders, installs Claude Code's hooks under this app's own
binary, sets the detail level and toggles start on login, so a machine can be set up from the app
alone. `CLAWD_HOME` and `CLAUDE_CONFIG_DIR` point it at scratch folders while testing.

For work on the page, the dev loop loads the Next dev server instead, with hot reload:

```
pnpm dev
pnpm --filter @clawd/desktop dev
```

`--dev-url <url>` points the window elsewhere, for example
`pnpm --filter @clawd/desktop dev --dev-url "http://localhost:3000/?source=simulated"`; the last
`--dev-url` wins. `CLAWD_DESKTOP_URL` applies only when no flag is given, as with `npx electron .`.
A change under `src/` needs the command run again.

```
pnpm --filter @clawd/desktop test
pnpm --filter @clawd/desktop typecheck
```

## Package

```
pnpm --filter @clawd/desktop package
```

builds the export, bundles main and runs electron-builder: `release/win-unpacked/` is the folder
teammates get, and `release/Clawd-Visualiser-<version>-win-x64.zip` is that folder zipped. Unzip it
anywhere, a folder under your user profile is best since the hooks will point at it, and run
`Clawd Visualiser.exe`. `pnpm --filter @clawd/desktop smoke` starts the packaged app once against
scratch folders and checks that the exe runs as Node, that the app starts as packaged and that its
agent answers. `pnpm --filter @clawd/desktop icons` redraws the tray and app icons from the sprite;
`pnpm test` fails if the checked-in files no longer match it.

A development run and the packaged app stay out of each other's way: they have their own names, so
their own profile folders and single-instance locks, and neither blocks the other from starting; the
development login item has its own name and its choice is remembered in its own `desktop-dev.json`, a
development launch never rewrites the hooks unattended (the settings window shows `stale` and offers
Reinstall), and the packaged app ignores `--dev-url` and `CLAWD_DESKTOP_URL`.

Two things a development run from before stage 6 may have left behind. A Run value named
`io.github.mwardill.clawd-visualiser` pointing at this repository's `electron.exe`: the development
toggle no longer sees it, so remove it by hand (`Remove-ItemProperty
HKCU:\Software\Microsoft\Windows\CurrentVersion\Run io.github.mwardill.clawd-visualiser`) or let a
packaged run overwrite it. And a `~/.clawd/desktop.json` at version 1: the packaged app ignores it,
and development keeps `desktop-dev.json` since stage 6.1.

## Stage notes

### Stage 1: the window

Electron is two kinds of process. The **main process** is one Node program: it starts first, owns
the app lifecycle (`ready`, windows closing, quit) and makes windows. It never draws anything. Each
window is a **renderer**: a Chromium page in its own process, and in this app a sandboxed one with
no Node access and no preload, so it is a web page that talks to the agent over HTTP exactly as a
browser tab does. The two kinds share nothing unless a preload bridge is added on purpose, which
stage 5 does for the settings window.

Because Electron loads `main` from `package.json` as a plain Node module, and the workspace
packages export TypeScript, a bundler runs first: esbuild turns `src/main.ts` into one CommonJS
file with `electron` left external, since the runtime provides it.

One thing to know about the binary: with `ELECTRON_RUN_AS_NODE=1` in the environment it runs as
plain Node and ignores the app entirely, which is how the hook scripts will use it in stage 5. A
VS Code extension host sets that variable and its children inherit it, so if `electron --version`
prints a Node version, unset it (or prefix the command with `env -u ELECTRON_RUN_AS_NODE`).

What stage 1 leaves in place: `pnpm --filter @clawd/desktop dev` bundles and starts the app;
`--dev-url` and `CLAWD_DESKTOP_URL` choose the page; the window is sandboxed, denies new windows
and refuses to leave its origin. The main process quits when the window closes, which stage 4
changes when the tray arrives. The agent is still the CLI's; stage 2 brings it inside.

### Stage 2: the agent inside

The main process is Node, all of it: `http`, `fs`, timers, `fetch`. So the agent needs no process of
its own. `main.ts` calls the same `startAgent()` the CLI's `serve` calls, and the agent's server, its
poller and its event log run on the main process's event loop, beside the code that manages windows.
The renderer does not notice: it still talks to `127.0.0.1:4750` over HTTP. One thing follows from
sharing that loop: anything that blocks it, such as a long synchronous loop or a synchronous read of
a large file, freezes the agent and the window frame together, so main-process code stays
asynchronous.

`agent-host.ts` decides which agent the app uses. If the port is free, the app owns the agent. If an
agent already answers on the port (the CLI's, or a second copy of the app until stage 4), the app
attaches to it, checks it every ten seconds, and starts its own when it stops answering. A fault
while owning it stops what it can and starts again after 1, 2, 4, 8 then 16 seconds; a sixth fault
inside five minutes gives up. An unusable `config.json` fails at once. The window title shows the
counts and says `agent attached` or `agent failed`; stage 4 moves that text to the tray tooltip.

**The quit sequence.** Electron quits in steps, and main can listen to each: `window-all-closed`
(the last window has closed; this stage calls `app.quit()` there), `before-quit`, the windows
closing, then `will-quit`. Calling `event.preventDefault()` in `will-quit` cancels the quit, which is
how the app keeps the process alive while the agent closes its server and writes out its event log.
When that is done, `app.exit(0)` ends the process at once, without firing the quit events again. A
stop that hangs is abandoned after five seconds and logged as `desktop.stopTimedOut`, so quitting
always ends.

**Error handling.** By default, an exception nothing catches in the main process shows Electron's
"A JavaScript error occurred in the main process" dialog. Listening for `uncaughtException` and
`unhandledRejection` on `process` replaces that: the host logs a code and restarts the agent it owns.
Errors in the renderer belong to another process and only reach its DevTools console. `startAgent`
rejecting is ordinary control flow rather than a crash: `PortInUseError` means look for an agent to
attach to, `ConfigError` means failed, and anything else is a fault.

**Logs.** The app writes through the agent's own `createLogger`, so the agent's lines and the app's
`desktop.*` lines share one file and one rule: a time, a code and numbers, never a string. Day files
older than the config's `logRetentionDays` are removed when a new day's file opens.

What stage 2 leaves in place: launching the app is enough for live sessions; the Next dev server is
still needed for the page, until stage 3 bundles it. Closing the window stops the agent and quits.

### Stage 3: the packaged UI

A web page usually comes from a server. This one comes from files on disk: the web app's static
export, copied to `dist/renderer`. `protocol.handle("app", handler)` lets the main process answer
every request for an `app://` URL itself, so there is no server and no extra port. Chromium asks,
main maps the path to a file, and the answer is a standard `Response`.

**Declaring the scheme.** Chromium has to know a scheme's rules before it starts, so
`protocol.registerSchemesAsPrivileged` runs before `ready`. `standard` makes `app://clawd/` behave
like `http`: the export's root-relative links, such as `/_next/static/...`, resolve under it, and
the page gets a real origin. `secure` makes the page a secure context, as `https` would.
`supportFetchAPI` lets `fetch` reach `app://` URLs at all; the policy below still limits `fetch` to
the agent, and nothing needs more today, since the page has one route and never fetches its own
files. `scheme.ts` refuses any path that decodes to somewhere outside the export, and serves only
the file types in its table.

**Origins.** The page's origin is `app://clawd`, and Chromium sends it in the `Origin` header when the
page calls the agent. The agent refuses origins it does not know, so `app://clawd` is now one of its
built-ins beside the Next dev server's, for the CLI's agent too. One trap: Node's
`new URL("app://clawd").origin` is the string `"null"` for any custom scheme, which is why
`navigation.ts` compares scheme and host by hand.

**Content Security Policy.** Because main writes every response, it also sets the page's security
policy in a header. The policy lets the page load its own scripts, styles and fonts, and reach only
the agent's port; `fetch("https://example.com")` from DevTools is refused. Inline scripts are
allowed because Next's export writes two into `index.html`.

**Private network checks.** Chromium treats a page calling a loopback address as reaching into a
more private network, and may send a preflight first or ask for a permission. The agent already
answers that preflight. On Electron 44 that was enough: the event stream connected with nothing
added in main.

Two ways to run it follow from this: `start` builds the export and loads `app://clawd/`, and `dev`
loads the Next dev server for hot reload. What stage 3 leaves in place: launching the app is enough;
no dev server and no CLI agent are needed. Closing the window still stops the agent and quits, until
stage 4's tray.

### Stage 4: the tray

Until now the window was the app: close it and everything stopped. Now the process, the agent and an
icon by the clock are the app, and the window is a view you open and put away.

**The tray.** `new Tray(image)` puts an icon in the notification area, with a tooltip and a context
menu built with `Menu.buildFromTemplate`. A tray that nothing references any more can be garbage
collected and vanish, so main keeps it in a variable for the life of the app. The icons are ICO files
drawn from the canonical Clawd sprite by `build/icons.mjs` and checked in under `resources/tray`,
each holding 16, 20, 24 and 32 px images so Windows picks a crisp one at every display scale (stage 6
replaced the PNGs). While any session waits, the icon is the variant with an amber dot.

**Close and quit are now different things.** Electron's default is to quit when the last window
closes. The app listens for `window-all-closed` and does nothing, and the window's `close` handler
calls `event.preventDefault()` and hides the window instead. Quitting (the tray's Quit, Ctrl+Q, or
Ctrl+C in the terminal) goes through `app.quit()`, which fires `before-quit` first; main sets a
`quitting` flag there, so the window's `close` is let through, and then stage 2's `will-quit`
handler stops the agent. Ctrl+Q is caught with the window's `webContents.on("before-input-event")`,
which sees each key press before the page does, and only while the window has focus. Signing out of
Windows is different: Electron lets the session end without firing `before-quit` or `will-quit`, so
the agent does not get its clean stop, and bounds changed since the window last closed are not saved.

**One copy.** Taking it with `app.requestSingleInstanceLock()` is the first thing `main.ts` does,
before it registers the scheme, starts the agent or writes a log line. The first launch gets the
lock. Any later launch does not, exits at once, and Electron passes its command line to the first
copy as a `second-instance` event, which shows the window unless the line has `--hidden`. Before
this stage a second copy of the app attached to the first copy's agent; now it never gets that far.

**The login item.** `app.setLoginItemSettings({ openAtLogin, path, args })` writes a value under the
current user's `Run` registry key; Windows starts that command line at sign-in. The value is named
by the app's AppUserModelId, which main sets to `io.github.mwardill.clawd-visualiser` when packaged
and to that id with `.dev` appended in development, so the two never share an entry (stage 6). In
development the command is Electron's `electron.exe` with this folder and `--hidden`; packaged, it
is the app's own exe. `getLoginItemSettings({ path, args })` only reports a value holding exactly
that command, so after the folder moves Windows has no entry for the new path. `desktop.json`
remembers that the user wanted one, and the next launch writes it again
(`desktop.loginItemReapplied`). In development, ticking Start on login registers this repository's
`electron.exe`, so untick it when you are done. The packaged app turns the login item on at its
first run.

What stage 4 leaves in place: the tray menu is Open, Start on login and Quit; Settings joins it with
the settings window in stage 5.

### Stage 5: the settings window

Every window so far was a sandboxed page that could only reach the agent over HTTP. The settings
window has to do things a page must never do by itself: open a folder picker, write Claude Code's
settings file, change the login item.

**The preload bridge.** A preload script runs before the page, in its own world: it cannot see the
page's variables, and the page cannot see its. `contextBridge.exposeInMainWorld` publishes exactly
the functions in `settings/preload.ts` as `window.clawd`, and each one is an `ipcRenderer.invoke`
message. The page stays sandboxed with no Node access; `window.require` and `window.process` are
undefined in it.

**Main is the only privileged side.** `settings/ipc.ts` names one channel per call, validates every
argument with zod, and answers with the whole new state, so the page never asks twice. An argument
that does not validate changes nothing. Everything that touches the disk, the registry or the agent
happens in main, over injected actions that are tested without Electron.

**Hooks under the app's binary.** With `ELECTRON_RUN_AS_NODE=1` the app's own exe runs as plain Node,
so Claude Code's hooks need no Node install: the written command is that prefix plus the script in
`~/.clawd/bin`. The installer takes this prefix as a string now, and the agent also gained the hook
status check, the quoting helper, the split into setting the allowlist and installing hooks, the
removal helper, a relaxed rule about watching no folders, and new log codes. One hook run measured
here, on a development build rather than a packaged one, with an empty payload on stdin, took 233 ms
the first time and about 140 ms warm, well inside the two second timeout the installer writes. At
launch the app compares the commands in the settings file with the ones it would write: ours pointing
elsewhere are rewritten and logged as `desktop.hooksRepaired`, so a moved folder repairs itself;
hooks that were never installed wait for this window.

**Its own origin.** The page is served from `app://settings/`, beside the visualiser's `app://clawd/`,
under a stricter policy: it may load only its own files and may open no connections at all, because
it talks to main through the bridge.

What stage 5 leaves in place: everything a teammate needs except packaging, which is stage 6.

### Stage 6: the package

Until now the app was a repository: `electron .` on a folder of source, with the repository's own
`electron.exe`. Packaging makes it a folder a teammate can run with nothing installed.

**What electron-builder does.** It copies Electron's binary and its support files into
`release/win-unpacked/`, renames the exe to `Clawd Visualiser.exe`, stamps the icon and the version
into it, and puts the app's own files, `dist/main.cjs` and the two pages, into one archive,
`resources/app.asar`. The `zip` target then zips that folder. There is no installer and no updater:
the folder is the install, and a new version is unzipped over it. When a new version changes the
hook scripts, open Settings and choose Reinstall after updating: the scripts copied into
`~/.clawd/bin` are only refreshed by an install, not by unzipping a new version over the folder.

**asar.** The archive is a read-only bundle of files with an index. Node inside Electron reads it as
if it were a directory: `require`, `readFile` and `readdir` see through it, which is how the scheme
handler serves the export and the settings page from inside it. Anything that uses a file as a file
does not: the tray loads its icon by path, and the installer copies the hook scripts into `~/.clawd/bin`.
Those two directories go beside the archive with `extraResources`, and `paths.ts` finds them under
`process.resourcesPath` when packaged. The `onlyLoadAppFromAsar` fuse means the app's code can come
only from the archive, never from a loose `resources/app` folder someone drops beside it.

**Fuses.** Switches baked into the binary itself, flipped by the packager after the copy.
`runAsNode` stays on: every installed hook runs this exe with `ELECTRON_RUN_AS_NODE=1`, and turning
it off would break them all. `enableCookieEncryption` and `onlyLoadAppFromAsar` close doors the app
never uses. `pnpm dlx @electron/fuses read --app <exe>` shows what is set.

**The app's name.** Electron names the profile folder under `%APPDATA%`, where Chromium keeps its
caches, and the single-instance lock after the app's name, read from `package.json`. The
repository's `package.json` is named `@clawd/desktop`, so electron-builder writes
`productName: Clawd Visualiser` into the archive's copy only (`extraMetadata`). The packaged app
then keeps its own profile and lock, and a development run can start while the packaged app sits in
the tray.

**`process.execPath` in a packaged app.** In development it was the repository's `electron.exe`; now
it is `Clawd Visualiser.exe` wherever the folder was unzipped. The hook commands and the login item
are written from it, and at each launch the packaged app compares them with what it would write now:
after the folder moves, both are repaired. A development run no longer does this unattended, since on
the maintainer's machine the hooks may belong to the CLI or to another checkout.

**Icons.** Windows resamples a PNG at 125% and 150% scaling and blurs the pixel art, so the tray
icons are ICO files holding 16, 20, 24 and 32 px images and Windows picks the matching one; the app
icon is an ICO up to 256 px, which the packager needs. Both are drawn from the canonical sprite by
`build/icons.mjs` with nothing but `node:zlib`, and `pnpm test` fails if a checked-in file no longer
matches the sprite.

**SmartScreen.** The exe is unsigned, so Windows warns once for an exe extracted from a downloaded
zip: More info, then Run anyway. A certificate is the fix, not a code change (design §11). The exe
starts as Node in about 85 ms once Windows has seen it; the first launch of a freshly built exe is
slower, about 600 ms, while it is scanned.

What stage 6 leaves in place: the whole design. What the stage reviews deferred is listed in the
design's §12.1 for the hardening pass.
