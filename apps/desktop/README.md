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

For work on the page, the dev loop loads the Next dev server instead, with hot reload:

```
pnpm dev
pnpm --filter @clawd/desktop dev
```

`--dev-url <url>` or `CLAWD_DESKTOP_URL` point the window elsewhere, for example
`pnpm --filter @clawd/desktop dev --dev-url "http://localhost:3000/?source=simulated"`. A change
under `src/` needs the command run again.

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
`supportFetchAPI` lets the page `fetch` its own files, which Next's router does. `scheme.ts` refuses
any path that decodes to somewhere outside the export, and serves only the file types in its table.

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
answers that preflight. On Electron 44 that was enough: the event stream connected with nothing added in main.

Two ways to run it follow from this: `start` builds the export and loads `app://clawd/`, and `dev`
loads the Next dev server for hot reload. What stage 3 leaves in place: launching the app is enough;
no dev server and no CLI agent are needed. Closing the window still stops the agent and quits, until
stage 4's tray.
