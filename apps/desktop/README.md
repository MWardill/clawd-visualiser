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
when it was built. No stage lets the port vary: a `port` edited by hand in `config.json` moves the
agent, and the page, which still asks 4750, stays simulated. An agent started before stage 3, such
as a CLI agent left running from earlier, does not know the `app://clawd` origin and refuses the
page: the app attaches to it, and the title, the tray and Settings say `agent attached, refuses this
app`. Stop that agent and the app starts its own. DevTools' console shows one `unsafe-eval`
Content Security Policy report per page load. It is expected and harmless: zod tests whether it may
compile its parsers, is told no, and carries on without.

The app lives in the tray. Closing the window hides it and the agent keeps running; click the tray
icon to bring it back, and quit from the tray menu or with Ctrl+Q. Only one copy runs: starting it
again shows the running copy's window. `--hidden` starts it with only the tray icon, as the login
item does. The window's position and the login choice are kept in `~/.clawd/desktop-dev.json` (the
packaged app's are in `desktop.json`).

Settings opens from the tray. It watches folders, installs Claude Code's hooks under this app's own
binary, sets the detail level and toggles start on login, so a machine can be set up from the app
alone. `CLAWD_HOME` and `CLAUDE_CONFIG_DIR` point it at scratch folders while testing.

**Widget view.** Settings has a View choice: *window*, the whole scene in one window, or *widgets*,
where each folder's box is its own frameless, transparent window. Drag a box anywhere; it is found
again where it was left, by folder name, in `desktop.json`. The pin in its title row, or **Pin on
top** in its right-click menu, keeps it above other windows. Clicking a Clawd opens the full window
on that session's detail sheet, and the tray's **Open** opens it in either view. In widget view a
plain launch shows no window: the boxes appear with the sessions. Clicking the tray icon brings the
boxes forward, or opens the full window when there are none.

**The finished popup.** Under View, *Pop a box up when a turn finishes* raises a folder's box over
every other window, drawn green, the moment a session there stops working, without taking the
keyboard: in widget view the folder's own widget, in window view a temporary box at the bottom right
that has no pin and goes when it is clicked. Nothing pops up while the full window has the focus,
since you are already looking. A raised box goes down when you click it, or when that session is
prompted again; it stays up while the session sleeps, so a turn that finished while you were away is
still there when you come back. Off by default.

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
the folder is the install, and a new version is unzipped over it.

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

### Stage 6.1: the review's fixes

Nothing new in Electron. Two things worth knowing. A development run and the packaged app now keep
separate state files (`desktop-dev.json` and `desktop.json`, version 2), so a toggle made in one
never decides the other's behaviour; the old version 1 file is ignored. And the smoke script runs the
packaged app with `--user-data-dir` pointing at a scratch profile: Electron derives the
single-instance lock from that directory, so the copy under test never collides with an installed
copy sitting in the tray. The smoke also stops the app by ending its whole process tree, so a Claude
CLI call still in flight cannot write into the scratch folder after the script has removed it.

### Stage 7: hardening, the first half

Nothing new in Electron. The settings window and the installer stop losing events and stop lying.

**What stale means now.** The hook check compares everything an install would write: the http hook
for each event with its port and token, the SessionStart command, the status line, and the three
scripts in `~/.clawd/bin` against the ones shipped beside the archive. Any difference is `stale`, so
an edited port, a recreated token, a status line removed by hand and an update that changed a script
are all repaired by the packaged app at launch, and offered as Reinstall in development. The packaged
app repairs at launch only when the installed command names this exe, an exe that no longer exists,
or no command of ours; a command naming another exe that still exists, the CLI's or another copy's,
is a live install and is left alone, shown as stale with Reinstall offered. A config or settings file
that exists but cannot be used reads `unreadable`, with no buttons.

**The page can say no.** Every answer over the bridge is still the whole state, but the state now
carries a `notice`, one sentence about the last action when it was refused, failed, or was saved but
not applied, and the failed agent's reason. The rules that decide them live in
`settings/actions.ts`, tested with doubles for the picker, the installer, the host and the log;
`main.ts` only wires. A change made while attached to another agent is saved but not applied, and
the notice says so. Installing hooks while attached with no config of this app's own is refused;
by then, though, the app's own refused start has already created that config, so the refusal is
reached only if it is deleted afterwards, and hooks installed while attached to an agent served
from another `CLAWD_HOME` still carry a token that agent answers with 401 (design §12.1, stage
8). The notice persists across the pushes main
makes on its own, such as a host change or the tray's login toggle, since the actions remember it
until the next action answers or the page loads again, and it shows in a permanent live region so a
screen reader can announce it, not yet checked with one.

**The install saves once.** The installer validates Claude Code's settings file, copies the
scripts, saves the config, then writes the settings file, in one call and in that order; a failure
before the save leaves the config untouched, and an install that would change nothing writes no
backup.

### Stage 8: hardening, the second half

Nothing new in Electron. Every item the reviews left in the design's §12.1 is done, or dropped with
its reason written beside it.

**The page is built once.** Main pushes a state whenever a session changes, and the settings page
used to rebuild itself each time, which dropped a button's busy guard, reset a radio mid-request and
wiped a text selection. It now patches text, `hidden` and `checked` in place and rebuilds only the
folder list, when the list changes. The notice sits in a `role="status"` container that is always
rendered, so a screen reader hears the first one. `settings/page.test.ts` runs the real page under
happy-dom over a stub bridge. The bridge is typed once, as `SettingsApi` in `settings/state.ts`; the
preload takes the channel names from an import-free module and fell from about 750 kB to a few; the
window has its font, copied beside the page from `@fontsource/jetbrains-mono`.

**The install asks first.** Install hooks never creates a config. With one, the app asks the agent on
the port whether it holds the config's token, the way a hook would. Attached to an agent that
answers 401, one started from another `CLAWD_HOME`, nothing is written and the page says why. When
the app's own agent answers 401, the config was recreated under it: the agent is restarted and the
hooks are then written. The launch repair is a tested function, and runs once the agent's first
start has settled, so a token that start created is seen on the same launch.

**The shell.** A `desktop.json` that exists but cannot be read is left alone for the run, and the
first-run login item is skipped. Bounds saved on a larger display are clamped to the one holding
most of the window, a title strip across the seam of two displays counts, and the maximised state is
kept. Ctrl+Q also works on a layout with no Latin letters, by the physical key, and only there, since
on AZERTY that key types `a`. The tray icon goes in `will-quit`, when the quit is certain. The Start
on login control shows off when the entry is switched off in Task Manager, if Electron reports the
entry; each launch logs what it reported as `desktop.loginItem`.

**The scheme.** One table for the two hosts, a handler that cannot reject, Windows device names
refused, the export's `404.html` for a missing page, and `connect-src 'self'`.

**The agent.** The packaged app's agent no longer accepts `http://localhost:3000`. The presence
poller survives a stop followed at once by a start, and its command runner ends the whole process
tree on overflow as well as on a timeout or an abort, with `taskkill` called by its full path. A
session that has waited 36 hours for an answer leaves the view until it is answered.

### Stage 9: widgets

`docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`. Every pane can be its own window.

**Frameless and transparent.** `frame: false` takes the title bar and the border away, and
`transparent: true` with a fully transparent `backgroundColor` takes the background: what the page
does not paint is the desktop. Such a window cannot be resized by hand on Windows, which suits a
widget; main resizes it, to the size its page reports.

**Moving a window from main.** With no title bar there is nothing for Windows to drag. CSS
`-webkit-app-region: drag` would hand a region to Windows, which then swallows every click, hover and
right button in it, so the Clawds, the pin and the menu could not live there. The page reports a
press instead, and main moves the window: it reads `screen.getCursorScreenPoint()` itself, because a
page's `screenX` is not in the units `setBounds` takes on a machine with two scale factors, and it
passes the width and height with every move, because a position alone lets the window's size drift
on a scaled display.

**Always on top is a level.** `setAlwaysOnTop(true, "floating")` does not nudge the window up the
z-order once; it puts it in a band above ordinary windows, whatever has the focus. `showInactive()`
shows a window without giving it the keyboard. Raising one is harder than it looks: Windows refuses
a plain move to the top (`moveTop()`) from a process that is not in the foreground, since only a
topmost window may sit above the active one, so clicking the tray while an editor had the focus
brought nothing up. The cure, found in the stage's own walk, is to make the window topmost and at
once not: Windows answers the second call by placing it above every non-topmost window, the active
one included, and still without activating it. From the tray menu that has to wait a quarter
second: closing the menu gives the focus back to the window that had it, which comes to the top
again and would cover a raise made at once.

**Many windows, one page.** Every widget loads `app://widget/` and sends on the same channels.
`event.sender` is the only thing that tells them apart, and the only identity main trusts: a message
from a sender the controller did not create is ignored, and a clicked alias is accepted only if main
sent it to that window.

**`invoke` and `send`.** The settings bridge is all `invoke`, a question with an answer. Most of a
widget's calls have no answer, and a drag sends one per frame, so they are `send`, with `ipcMain.on`
on the other side. No handler may throw: an exception nothing catches in main restarts the agent.

**`Menu.popup`.** The page cancels `contextmenu` and asks; main builds the native menu and pops it
on that window.

**Same-document navigation.** A Clawd clicked in a widget opens the full window at
`app://clawd/#session=<alias>`. Loading the URL a window already shows, with only the hash changed,
does not reload the page: it fires `hashchange`, which the web app reads as a link.

**Shutting the widgets down.** Quitting closes every widget, but the app's own agent goes on emitting
snapshots until `will-quit` stops it, and a snapshot arriving then would open a fresh window during
the quit. The controller has a `shutdown()` for that: it closes everything and ignores what comes
after.

**The icon.** The packaged exe always carried the Clawd, stamped by electron-builder. A development
run is `electron.exe`, which carries Electron's, and no window was given an `icon`. Every window is
now, from `app.ico` beside the tray's icons.

### Stage 10: the finished popup

`docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`, §3.3. A turn finishing raises its box.

**Window levels.** `setAlwaysOnTop(true, level)` puts a window in a band. A pinned widget sits in
`floating`, above ordinary windows; a raised one in `screen-saver`, the highest, above a pinned
widget, a maximised window and the taskbar. Lowering is a change of band, `setAlwaysOnTop(false)`
or back to `floating`, and the window stays where it is. The controller's window has one call for
this, `setLevel`, so pinned and raised cannot disagree. Whether Windows keeps the two topmost levels
apart is settled by the stage's own walk; the code is right either way.

**Raising from the background.** A finish arrives while another app has the focus, and stage 9's
walk found that a background process cannot move a window above the active one. A raised widget is
topmost, so it needs no trick: the band does the work, and `showInactive()` keeps the keyboard where
it was.

**A temporary window.** In window view the popup is a widget made for the raise and closed once it
is lowered: the same controller, the same page, one flag. It comes up from the bottom right, away
from where the widgets stack, has no pin, and is closed by the press that lowers it, or walks its
Clawds out when the session is prompted again.

**What "finished" is.** The agent's snapshot carries each session's displayed state, held for a
moment so a short turn still shows as working. A session shown `working` in one snapshot and `idle`
in the next has finished a turn; the first snapshot from an agent is only the baseline, so nothing
fires at launch or after a restart. The raise holds while any session that raised it is neither
working nor waiting again and still there: `asleep` keeps it up.

**`isFocused()`.** Main asks the full window whether it has the keyboard at the moment a turn
finishes; if it does, the finish is not recorded, and nothing pops up later when the focus moves.
