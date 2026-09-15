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
collected and vanish, so main keeps it in a variable for the life of the app. The icons are PNGs
drawn from the canonical Clawd sprite by `build/icons.mjs` and checked in under `resources/tray`;
`tray@2x.png` beside `tray.png` is picked up automatically on a display scaled to 200%. At 125% and
150%, the common laptop settings, Windows resamples the nearer image instead, which softens the
pixel art; stage 6's icon file fixes that. While any session waits, the icon is the variant with an
amber dot.

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
by the app's AppUserModelId, which main sets to `io.github.mwardill.clawd-visualiser`. In
development the command is Electron's `electron.exe` with this folder and `--hidden`; packaged, it
is the app's own exe. `getLoginItemSettings({ path, args })` only reports a value holding exactly
that command, so after the folder moves Windows has no entry for the new path. `desktop.json`
remembers that the user wanted one, and the next launch writes it again
(`desktop.loginItemReapplied`). In development, ticking Start on login registers this repository's
`electron.exe`, so untick it when you are done. The packaged app turns the login item on at its
first run.

What stage 4 leaves in place: the tray menu is Open, Start on login and Quit; Settings joins it with
the settings window in stage 5.
