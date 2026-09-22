# Desktop widgets and the finished popup (`apps/desktop`)

21 September 2026. Approved in conversation. Builds on the desktop app design
(`2026-09-14-desktop-app-design.md`), whose stages ended at 8; this adds stages 9 and 10, each with
its own plan and branch as before, and each adding Electron ideas the maintainer has not yet met.

## 1. Scope

Two features, each behind its own setting in the settings window.

- **Widget view.** Instead of one window holding the whole scene, every pane (one box per folder,
  holding that folder's sessions) is its own frameless, transparent window that can be dragged
  anywhere and pinned on top of other windows.
- **Finished popup.** When a session finishes its turn, its pane's box rises above every other
  window, without taking the keyboard, until it is clicked or the session is prompted again. It works
  in either view.

And one small fix that came with the request: every window shows Electron's icon in the taskbar,
the title bar and Alt+Tab, because no window is given one (§9).

In scope: the scene's single-pane options, the widget page and its bridge, the main-process
controller, remembered placements, the pin, the context menu, the two settings, the tray's entry,
snapshots reaching main while attached, the finish tracker, the raised state and its cue, temporary
widgets, a deep link in the web app, the window icon, tests, staging.

Out of scope: hiding a single folder's widget; resizing or scaling widgets; sounds and Windows toast
notifications; popups for a session that waits or ends (waiting already turns the box amber and
badges the tray); macOS and Linux, as before. Focusing the session's terminal from a widget was out
of scope at first and came in on 22 September 2026, after stage 10's walk began: a Clawd click now
sends the agent's `focus` command rather than opening the full window (§3.2).

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| What one widget is | A pane | The box as the scene already draws it. Fewer windows than one per session, a stable key to remember a position by, and walking in and out still has somewhere to happen. |
| Who draws a widget | A page of the desktop package, `app://widget/`, bundling `@clawd/scene` | The Next app keeps zero desktop-specific code and `app://clawd` keeps no preload, both recorded decisions. A widget needs a preload, since a frameless window that stays clickable has to be dragged by hand. |
| Where a widget's data comes from | Main sends each window the snapshot filtered to its pane | Main must see every snapshot anyway: only main can create, close, raise and pin windows. One data path; the widget page is allowed no network at all. A route in the Next app with a stream per window was the alternative, and would have added N streams to the IPC main still needed. |
| One overlay window for all boxes | Ruled out | One window has one z-level, so boxes could not be pinned one by one; it would also need an overlay per display and mouse forwarding, and would sit permanently over full-screen apps. |
| Dragging | By hand: pointer events in the page, `setBounds` in main | `-webkit-app-region: drag` swallows clicks, hover and the right button, so the Clawds, the hover pin and the context menu could not live in a dragged region. |
| The look | The box's interior in the night colour; everything outside it transparent; Clawds clipped to the box | Text stays legible on any wallpaper. A Clawd rises into view from behind the bottom border and leaves the same way, so nothing is ever drawn on the desktop and the window is exactly the box. |
| What "finished" means | A session shown `working` in one snapshot and `idle` in the next | Claude Code's Stop hook. Core keeps a session working while its subagents or background tasks run, so the popup waits for them. A session that ends or waits does not pop up. |
| How a raised box goes down | A press on it, or the session working or waiting again, or the session leaving the snapshot | Nothing timed: a popup that fired while the maintainer was away is still there on return. Going `asleep` does not lower it, for the same reason. |
| The full window in widget view | Still there on demand | The ticker and the detail sheet live there. The tray menu and a widget's menu open it. A Clawd click does not: it focuses that session's terminal instead, which is what the maintainer reached for when a box came up (changed 22 September 2026). |
| Pinning | Per widget: a pin in the title row on hover, and a native context menu | One folder can stay on top while the rest sit behind the editor, and a lit pin shows which at a glance. |
| Defaults | View: window. Popup: off | A teammate who unzips a new version sees what they saw before. |

## 3. Behaviour

### 3.1 Settings

A new section in the settings window, **View**, between "this app" and "watched folders":

- A radio group, **Window** or **Widgets**.
- A second radio pair, off or on, **Pop a box up when a turn finishes**: the page has radio groups
  and no checkbox control, and one kind of control reads better than two (decided in stage 10's
  plan).

Both apply at once, with no restart. Turning widgets on creates a widget for every pane now shown and
leaves the full window as it is; turning them off closes the widgets and shows the full window.
Turning the popup off lowers every raised box.

### 3.2 Widget view

- One window per pane in the snapshot. It is created when the pane first appears and closed once the
  pane has left the snapshot and its page reports nothing left to draw, or five seconds later,
  whichever is first. The agent already keeps a finished session for `doneLingerMs` so the view can
  play the exit.
- The window is the box plus a one-cell margin, which the title needs because it sits on the top
  border: 324 by 180 CSS pixels for one row of seats. The page reports the size it needs and main
  applies it, the top-left corner fixed, so a pane that gains a row of seats grows downward. It
  resizes only then.
- A widget opened on sessions that are already there shows them seated at once: they did not arrive,
  the widget did. Sessions that arrive afterwards walk in, visible only once they are inside the box
  (§2, the look).
- Frameless, transparent, not resizable, no shadow, not in the taskbar and not in Alt+Tab.
- A widget with no remembered place stacks downward from the top-right corner of the primary
  display's work area, then starts a new column to the left. A remembered place that is no longer on
  any display falls back to that.
- Press and move to drag; where it is dropped is remembered for that folder. A press that moves less
  than four pixels is a click: on a Clawd or its nameplate it sends the agent's `focus` command for
  that session, which raises its terminal window, as the detail sheet's focus button does; anywhere
  else it does nothing. Main posts the command to the agent in use, own or attached, without an
  `Origin`, which the command route allows, with the alias that agent itself sent; a refusal or no
  answer is logged as `desktop.focusFailed`. (Until 22 September 2026 a click opened the full window
  on the session's sheet through §7's link; the maintainer changed it in stage 10's walk.)
- The pin appears at the right of the title row while the pointer is over the widget, and stays, lit
  amber, while the widget is pinned. Pinned means always on top, and is remembered for that folder.
- The right button opens a native menu: **Pin on top** (a checkbox), **Open full window**,
  **Settings**.
- The tray: clicking the icon shows the widgets and brings them forward, where it used to show the
  window; with no widget open, because no session is shown, it opens the full window as before, so
  the click always does something. The menu gains **Show widgets** above **Open**, present only in widget view; **Open** opens
  the full window in either view. A second launch of the app does what clicking the tray icon does.
- `--hidden`, which the login item passes, holds back only the full window. Widgets follow the
  setting: they exist only while a session does, which is the point of them.

### 3.3 The finished popup

- **Trigger.** A session whose state was `working` in the previous snapshot and is `idle` in this
  one. The snapshot carries the displayed state, which core holds for `minDisplayMs`, so a short turn
  still shows as working first. The first snapshot from a source only sets the baseline, so nothing
  fires at launch, at an agent restart or at a takeover.
- **In widget view** the pane's widget is raised: made topmost at the highest level, moved to the
  top and shown without activating it.
- **In window view** a temporary widget is made for the pane, raised the same way, at the folder's
  remembered place, or else stacked upward from the bottom-right corner of the primary work area.
  None is made while the full window is focused, since the maintainer is already looking at it. The
  check is made when the turn finishes: a finish seen then is a finish seen, and nothing pops up
  later when the focus moves. A temporary widget can be dragged, which remembers the place, but has
  no pin, and its menu has only **Open full window** and **Settings**.
- **The cue.** A raised box draws its border and its title green, `PALETTE.state.green`, so a widget
  that was pinned, and so already on top, still says so. Amber for a waiting session wins over green.
- **What lowers it.** A press on the widget, when it is released: a click, or the end of a drag, so a
  temporary widget can be moved before it goes and the place is remembered. A click on a Clawd in a
  temporary widget focuses that session's terminal first, and the release then closes the popup:
  the page sends the selection before the release. Or every session that
  raised it has since gone to `working` or `waiting`, which means it was answered in its terminal, or
  has left the snapshot. `asleep` does not lower it.
- **Afterwards** a pinned widget stays on top at the pinned level, an unpinned one becomes an
  ordinary window where it stands, and a temporary one closes: at once when a press lowered it,
  after its Clawds walk out when the session being prompted again or leaving did. The popup going
  off, a change of view and a new agent lower everything too: a temporary widget then walks out and
  closes, or closes at once on a change of view.

## 4. The scene (`packages/scene`)

`mountPanesScene` gains options. The full window passes none of them and is unchanged, frame for
frame.

- `background?: "night" | "none"`, default `"night"`. With `"none"` each frame starts from a cleared,
  transparent canvas, no stars or clouds are made, and each pane's interior is filled with
  `PALETTE.night.bg` before its border is drawn.
- `clipActors?: boolean`, default false. A pane's actors and their minis are drawn inside a clip of
  the pane's interior, the rectangle inside its border, so a Clawd on its way in or out is visible
  only while it is inside the box.
- `emptyState?: boolean`, default true. False never draws the "no sessions" Clawd.
- `margin?: number`, default `MARGIN`. Passed to `layoutPanes`, which takes it as an optional third
  parameter. A widget passes 1.
- `onContentSize?(size: { width: number; height: number } | null)`: the extent of what is laid out,
  in CSS pixels, called when it changes, and with null once no pane is left. The arithmetic is a pure
  `contentExtent(rects, margin)` in `layout.ts`: the panes' bounding box plus the margin on every
  side.

`PanesScene` gains two things.

- `setSnapshot(s, { seated?: boolean })`. With `seated`, a session the world has not met takes its
  seat at once, in phase `seated` with no move, where it would otherwise enter from the door.
  `reconcile` takes the same flag. The widget page passes it for the first snapshot after a mount or
  a `clear()`.
- `setFinished(panes: readonly string[])`: the pane aliases drawn green. `drawPane` picks amber when
  a session waits, else green when the pane is named here, else the night line.

## 5. The widget page (`apps/desktop/src/widget/`)

Built like the settings page: plain HTML, one script bundled by esbuild for the browser, a CommonJS
preload, JetBrains Mono copied beside it with its licence.

```
src/widget/
  page.html, page.css   one canvas filling the window, a transparent body, the pin button over the title row
  page.ts               mounts the scene, forwards state to it, reports the size, turns pointer events into drag, click and pin
  page.test.ts          under happy-dom with a stub bridge
  preload.ts            contextBridge: window.clawdWidget
  channels.ts           the channel names, import-free, all the preload takes
  state.ts              WidgetState and WidgetApi, import-free apart from core's Snapshot type
  ipc.ts                main's handlers, zod-validated; ipc.test.ts
```

```ts
type WidgetState = {
  /** The snapshot cut down to this window's pane; null before the first one. */
  snapshot: Snapshot | null;
  /** Changes when the source of snapshots changes; the page clears its scene, as SceneCanvas does. */
  generation: number;
  pinned: boolean;
  raised: boolean;
  /** A popup in window view: no pin is shown. */
  temporary: boolean;
};

type WidgetApi = {
  ready(): Promise<WidgetState | null>;          // asked once the scene is mounted; null to a window main does not know
  onState(cb: (s: WidgetState) => void): () => void;
  resize(size: { width: number; height: number } | null): void;   // null: nothing left to draw
  dragStart(): void;
  dragMove(): void;
  dragEnd(): void;
  togglePin(): void;
  select(alias: string): void;
  menu(): void;
};
```

- The page never learns which pane it is. It draws the snapshot it is sent. `raised` and `temporary`
  arrive with stage 10; stage 9's state is the other three fields.
- The one-way calls (`resize`, the three drag calls, `togglePin`, `select`, `menu`) go by
  `ipcRenderer.send`; only `ready` is an `invoke`, since only it has an answer.
- **Served** at `app://widget/` from `dist/widget/`, a third entry in `scheme.ts`'s host table with
  the settings page's policy: `connect-src 'none'`, no inline scripts. `SchemeDirs` and `DistPaths`
  gain `widget`.
- **The preload** imports the channel names and Electron's bridge and nothing else; the bundle step
  holds it to the same 20 kB as the settings preload.
- **Dragging.** On a primary-button `pointerdown` that is not on the pin, the page captures the
  pointer and calls `dragStart()`; on each `pointermove` it calls `dragMove()`, at most once per
  animation frame; on `pointerup`, `pointercancel` or `blur` it calls `dragEnd()`. No coordinates
  cross the bridge: main reads `screen.getCursorScreenPoint()` itself, in the same units `setBounds`
  takes, which the page's `screenX` is not on a machine with two scale factors. The page decides
  click or drag by how far the pointer moved, and calls `select(alias)` for a click the scene's
  `hitTest` answers.
- **The pin** is a real `<button aria-pressed>` placed over the right of the title row, drawn as
  pixel art in CSS, shown on `:hover` and `:focus-visible` of the page and always while pressed;
  absent when `temporary`.
- **The menu.** The page cancels `contextmenu` and calls `menu()`; main pops the native menu on that
  window.

## 6. Main (`apps/desktop/src/widgets/`)

Electron-free modules with tests over doubles, in the manner of `agent-host.ts` and
`settings/actions.ts`. `main.ts` stays wiring.

```
src/widgets/
  finished.ts     `finishedTurns(previous, next)` → the panes and sessions where a turn just finished; `stillRaising(aliases, next)` → those still holding a raise; the generation is the controller's, which forgets `previous` on a rise
  plan.ts         which windows should exist: (snapshot, view, raised) → [{ label, pane, temporary }]; the popup setting and the focus are the controller's, at trigger time
  placement.ts    where a window goes: the remembered place if restoredBounds accepts it, else the next free default slot; clamping after a drop
  controller.ts   the stateful part: label → window over an injected window factory; reconciles with the plan; owns the raised set, the drag in progress and the retry counts
src/attached-feed.ts   snapshots while attached: polls the agent on the port; tested with an injected fetch and clock
```

- **Keyed by label.** A pane's alias restarts with the agent; its label does not. Core already makes
  labels unique within a snapshot (`visualiser`, `visualiser 2`). Windows, placements and the raised
  set are all keyed by label, so a widget survives an agent restart in place. Two folders of the same
  name can swap numbers between runs, and with them their places; accepted.
- **Filtering.** A window is sent `{ ...snapshot, panes: [its pane], sessions: those in it }`, and
  only when that differs from what it was last sent, `generatedAt` aside.
- **The sender is the identity.** Every widget shares one set of channels, so each handler looks the
  window up by `event.sender` and ignores a sender the controller did not create. `select` is
  accepted only for an alias in the snapshot main last sent that window. `resize` is validated as
  whole numbers within 1 to 4096 and applied with the top-left fixed.
- **Dragging in main.** `dragStart` records the cursor's offset from the window's origin; each
  `dragMove` calls `setBounds` with the new origin and the window's known width and height, since
  `setPosition` alone lets a window's size drift on a scaled display; `dragEnd` clamps the place so
  the title row stays grabbable on some display, using `bounds.ts`, saves it if the window moved, and
  lowers a raised box. Every press ends in a `dragEnd`, moved or not, so that is the one place a
  press lowers anything. A drag ends by itself when its window closes.
- **The raised set.** The controller keeps, per label, the sessions holding a raise. A finish adds
  one (unless in window view with the full window focused); every snapshot prunes each label with
  `stillRaising` and drops it when empty; a press on the box, the release of any press, takes its
  label out; a generation rise, a change of view, `noSource` and the popup going off empty the set.
  An entry's level follows the set through one `setLevel(normal | pinned | raised)`, which replaced
  `setPinned`; a temporary entry is never pinned.
- **Windows.** `window.ts` gains `createWidgetWindow(preload, bounds)`, made through
  `createHardenedWindow`, whose spec gains a `chrome` field for the options that differ: `frame:
  false`, `transparent: true`, `resizable: false`, `maximizable: false`, `minimizable: false`,
  `fullscreenable: false`, `skipTaskbar: true`, `hasShadow: false`, `show: false`, a fully
  transparent `backgroundColor`, and `type: "toolbar"` (Windows' tool-window style, which keeps a
  widget out of Alt+Tab). A widget's window menu is removed too, so the default menu's shortcuts
  (Ctrl+W, Ctrl+R, zoom) cannot reach a focused box. Alt+F4 still closes a focused box; the controller
  treats that like any window the user closed, and the next snapshot brings it back. `closable:
  false` is not used, since it also disables `win.close()`, and with it every close the controller
  makes and the quit itself. A widget is shown with `showInactive()` once its page has reported the
  size it needs, so it never appears empty or at the wrong size, and never takes the keyboard.
- **Levels.** Pinned: `setAlwaysOnTop(true, "floating")`. Raised: `setAlwaysOnTop(true,
  "screen-saver")`, `moveTop()`, `showInactive()`. Lowered and unpinned: `setAlwaysOnTop(false)`.
  Stage 10's checklist settles whether `screen-saver` is the level that clears the taskbar and a
  maximised window on Windows 11; the level is one constant. Bringing an unpinned widget forward
  (its first showing, or the tray) is not a `moveTop()`: Windows refuses that from a process not in
  the foreground, found in stage 9's walk. It is made topmost and at once not, which places it
  above every non-topmost window without activating it; a pinned widget, topmost already, gets
  `moveTop()` within its band. From the tray menu the raise waits a quarter second, since the
  menu's closing gives the focus back to the window that had it, which comes to the top again.
- **Snapshots.** `AgentHostDeps` gains an optional `onSnapshot(s, run)`, called inside the guard the
  host already applies to its own agent's snapshots, so one from an agent already replaced never
  arrives; `run` is the host's count of starts. While the host is `attached` and either setting is
  on, `attached-feed.ts` asks `GET /api/snapshot` every second, through a new `fetchSnapshot` beside
  `fetchCounts` in `agent-client.ts`, and stops when the host leaves `attached` or both settings are
  off. Main asks without an `Origin`, as `fetchCounts` does, so widgets work even while attached to
  an agent that refuses the app's page. Every snapshot reaches the controller with the name of its
  source, `own:<run>` or `attached:<port>`, and the generation rises when that name changes: the
  order of a snapshot and a host mode change then cannot matter, which it would if the rise were
  taken from the mode. On a rise the tracker forgets its baseline, the raised set empties and each
  page clears its scene. A host that reaches `failed` has no source: the controller drops its
  snapshot and the widgets close after the five-second cap.
- **Quitting.** `before-quit` closes every widget and stops the feed; nothing of a widget holds the
  quit up.

### 6.1 State, settings, tray

- `desktop.json` gains three fields, each judged on its own as the others are, and needs no new
  version since an older build simply drops them: `view: "window" | "widgets"`, `finishedPopup:
  boolean`, and `widgets`, a list of `{ label, x, y, pinned }` in the order written, newest last,
  with whole-number coordinates and at most 200 entries, the oldest-written dropped first; a list,
  because an object lists number-like keys first whatever order they were written in, and a folder
  may be called `2024`. Folder names are written to this file and nowhere else; `config.json`
  beside it already holds the watched folders' full paths.
- `SettingsState` gains `view` and `finishedPopup`; `SettingsApi` gains `setView(view)` and
  `setFinishedPopup(on)`, through the channels, the zod handlers and `settings/actions.ts` like the
  rest. Neither restarts the agent. A `desktop.json` that could not be read keeps its rule: the
  choice holds for this run and is not written, and the notice says so beside the control.
- `trayMenuTemplate` takes the view and gains **Show widgets**; `TrayActions` gains `showWidgets()`.

### 6.2 Failures

- A widget page that fails to load, or whose renderer goes, has its window closed and
  `desktop.widgetFailed` logged. The next snapshot makes it again, at most three times for a label in
  one run of the app.
- New log codes, carrying numbers and booleans only, never a label: `desktop.viewChanged` (`widgets`),
  `desktop.popupChanged` (`on`), `desktop.popupRaised` (`temporary`), `desktop.widgetFailed` (`tries`),
  `desktop.focusFailed` (no fields: the agent refused a clicked session's focus command or did not answer).

## 7. The web app (`apps/web`)

One change, and not a desktop one: a deep link. `#session=<alias>` in the URL opens that session's
detail sheet. The hash is read at load and on `hashchange`, and consumed at once: it is removed with
`history.replaceState` and the alias kept in state, so the same link can be followed twice and a
reload does not reopen the sheet. The sheet opens once a snapshot from the live agent holds the
alias, never from the simulated feed, whose aliases are its own. Closing the sheet, choosing another
Clawd, or a change of feed forgets the link, as a change of feed already closes a sheet chosen by
hand; a link belongs to the live feed running when it was read, or, read at load or under the
simulated feed, to the first live feed that starts afterwards, and never moves to another. The
parsing and the rule are pure functions in `lib/`, tested; it works in a browser tab as well.

Stage 9 built it for a Clawd clicked in a widget, which loaded the full window at its own URL with
the hash: a same-document navigation for a window already showing the page, so nothing reloaded and
`hashchange` fired. Since 22 September 2026 a Clawd click focuses the terminal instead (§3.2) and
the desktop no longer builds the link; it stays in the web app for the browser.

## 8. Privacy

Nothing new leaves the machine and nothing new is logged. A widget is sent a subset of the snapshot
the visualiser's page already fetches from the agent, at whatever detail level the agent is set to,
over IPC inside the app, to a page that may open no connection. The log gains codes with counts and
booleans. `desktop.json` gains folder names, as §6.1 says.

## 9. The window icon

The packaged exe already carries the Clawd: the icon electron-builder stamps from
`resources/icon.ico` was read back from a packaged build on 21 September 2026. But no
`BrowserWindow` is given an `icon`, so a development run, which is `electron.exe`, shows Electron's
icon in the taskbar, the title bar and Alt+Tab. `createHardenedWindow` passes `icon` for every
window. The file is used by path, so like the tray's it cannot stay inside the archive: the bundle
step copies `resources/icon.ico` beside the tray icons as `app.ico`, the existing `extraResources`
entry carries it, and `DistPaths` gains `appIcon`. If the packaged app's icon still looks wrong on
the desktop after this, the first suspect is Explorer's icon cache for that path, not the build.

## 10. Stages

| Stage | Delivers | Electron ideas | Done when |
| --- | --- | --- | --- |
| 9 Widgets | The scene's options bar `setFinished`; the widget page, preload and bridge; the controller, the plan and placements; the pin and the menu; the View setting and the tray entry; `onSnapshot` and the attached feed; the `#session=` deep link; the window icon | Frameless and transparent windows; moving a window from main with `screen` and `setBounds`; `setAlwaysOnTop`; many windows of one page, told apart by `event.sender`; `Menu.popup`; same-document navigation | With the view set to widgets, each folder's box is its own window that can be dragged, pinned and found again where it was left after a relaunch, and the full window still opens from the tray and from a Clawd |
| 10 Finished popup | The finish tracker; the raised set and its levels; `setFinished` and the green cue; temporary widgets; the popup setting | Showing a window without activating it (`showInactive`, `moveTop`); window levels | A turn that finishes while another app is focused raises its box over that app without taking the keyboard, in both views, and a press or the next prompt lowers it |

Manual checks, kept in each stage's plan. Stage 9: transparency, and `setBounds` on a window that is
not resizable, at 100, 125 and 150% scaling; a drag across two displays with different scale factors;
a widget remembered on a display that is then unplugged; the pin read by Narrator; a development
run's taskbar icon. Stage 10: a popup over a maximised window and over the taskbar; that typing in
another app carries on uninterrupted while a box rises; a popup that fired while the machine was
locked, still there at unlock; a pinned widget turning green.

### 10.1 Stage 9's manual checks

Walked by the maintainer on 22 September 2026 on the packaged build, against scratch folders
(`CLAWD_HOME`, `CLAUDE_CONFIG_DIR`), with Claude sessions in two watched folders: every item passing,
with two defects found and fixed on the branch before the last rounds. A box could not be brought
forward from a background process, since Windows refuses `moveTop()` unless the process is in the
foreground (now topmost and at once not, `1b0d8fc`); and Show widgets from the tray menu was undone
the next instant by the focus going back to the window that had it (now a quarter-second wait,
`c9f3508`). One false alarm: a third session that never arrived was started from a terminal without
`CLAUDE_CONFIG_DIR`, so its hooks were never installed; a session nobody has prompted is also never
shown, by core's visibility rule.

- [x] Settings shows View after This app; choosing widgets closes nothing and makes a box per folder at the top right of the primary display, one under the other.
- [x] Each box is transparent outside its border, its interior dark, its text in JetBrains Mono; no box is in the taskbar or Alt+Tab.
- [x] A new session in a folder walks in from behind the bottom border and is never drawn outside the box; sessions already there when the box opened were seated at once.
- [x] A third session in one folder grows its box downward, the top-left corner fixed; when it leaves, the box shrinks back.
- [x] The last session in a folder ending makes its Clawd walk out, and then the box closes.
- [x] Dragging: the box follows the cursor with no lag that matters, keeps its size at 100, 125 and 150% scaling, and crosses between two displays with different scaling without changing size in CSS terms or blurring.
- [x] A box dropped mostly off the screen can still be grabbed; one flung wholly off comes back inside.
- [x] A click on a Clawd opens the full window on that session's detail sheet; doing it again after closing the sheet opens it again, and the scene in the full window does not reload (its Clawds do not walk in again).
- [x] The pin appears on hover, sits on the title row clear of the collision mark, lights amber when pressed, and the box then stays above a maximised window. At 125% it is no more than two pixels off the row.
- [x] Narrator reads the pin as a toggle button, "Pin on top", pressed or not; Tab reaches it.
- [x] Right-click: Pin on top (ticked when pinned), Open full window, Settings, each doing what it says.
- [x] Quit and relaunch: each box is where it was left, pinned if it was. With a display unplugged, a box remembered there takes a default slot.
- [x] Tray: clicking the icon brings the boxes above other windows and no box takes the keyboard (the taskbar does, as for any tray icon); Show widgets in the menu does the same and the boxes stay up once the menu has closed; with no session running either opens the full window. The menu has Show widgets above Open in widget view only.
- [x] `--hidden` in widget view: no full window, and boxes appear when sessions do.
- [x] Choosing window again closes every box at once and shows the full window.
- [x] Attached: with the CLI's agent holding the port, boxes still appear and follow the sessions within a second or so; stopping that agent, the app takes over and the boxes stay, their Clawds re-seated rather than walking in.
- [x] Settings changed while widgets are shown (a folder added): the agent restarts and the boxes stay.
- [x] A development run shows the Clawd, not Electron's icon, in the taskbar, the title bar and Alt+Tab, for the full window and the settings window.
- [x] The log holds `desktop.viewChanged` with `widgets` and `remembered`, and no folder name anywhere.
- [x] A Clawd clicked in a widget while the full window is hidden or minimised brings that window up on the sheet.
- [x] With `dist/widget/index.html` renamed in a development run, choosing widgets shows nothing and logs nothing: a broken widget build fails silently (known; no code for it this stage).
- [x] The first reveal of a widget (a transparent, `show: false` window) and its first resize after the page reports a size show no white flash or lost transparency.
- [x] Ctrl+W, Ctrl+R and Ctrl+plus on a focused box do nothing; Alt+F4 closes it and the next snapshot brings it back.
- [x] With boxes showing, Quit from the tray: every box goes and no `electron.exe` remains.

### 10.2 Stage 10's manual checks

Walked by the maintainer on the packaged build, against scratch folders, with Claude sessions in two
watched folders. Not yet done.

- [ ] Settings: under View, the popup pair sits below the view pair; choosing on changes nothing on screen by itself.
- [ ] Window view, popup on, an editor focused: a prompt's answer finishing raises a box for that folder at the bottom right, over the editor and over a maximised window, border and title green, and typing still goes to the editor.
- [ ] The box has no pin on hover; its right-click menu is Open full window and Settings only.
- [ ] A click on the box closes it at once; a drag first moves it, and the next popup for that folder appears where it was dropped.
- [ ] Two folders finishing: two boxes, the second above the first.
- [ ] A finish while the full window is focused shows nothing, then and later.
- [ ] A finish, then a prompt sent in that session: the box's Clawd walks out and the box closes, without a click.
- [ ] A finish, then the session left idle past ten minutes (asleep): the box stays up.
- [ ] Widget view, popup on: a finish turns that folder's widget green and brings it above a maximised window; a pinned widget turns green too.
- [ ] A click on the raised widget lowers it: a pinned one stays pinned, an unpinned one becomes ordinary and stays where it is.
- [ ] The next prompt in that session lowers it without a click.
- [ ] Popup off in Settings: every raised box lowers; a temporary one walks out and closes.
- [ ] Quit and relaunch with a session still idle: nothing is raised (the first snapshot is the baseline).
- [ ] Attached (the CLI agent holding the port), window view, popup on: the box still pops up within a second or so of the finish.
- [ ] The log holds `desktop.popupChanged` with `on` and `remembered`, and `desktop.popupRaised` with `temporary`, and no folder name.
- [ ] With boxes raised, Quit from the tray: every box goes and no `electron.exe` remains.
- [ ] A click on a Clawd in a popup brings that session's terminal to the front (the log gains no `desktop.focusFailed`), the full window stays hidden, and the popup closes. In widget view a click on a Clawd does the same and the box stays.
- [ ] Widget view, popup on: a raised widget sits above a pinned one and above the taskbar, or the two levels turn out to be one band on this Windows and the raise still shows (record which).

## 11. Tests

- `packages/scene`, over the fake context: with `background: "none"` no night is drawn and the pane's
  interior is filled; with `clipActors` the clip rectangle is the pane's interior; `contentExtent`
  for one and two rows of seats and for no panes; `layoutPanes` with a margin; `reconcile` with
  `seated`; `setFinished` and the amber-over-green rule.
- `apps/desktop`, with vitest: `widgets/finished` (the baseline, working to idle, waiting to idle not
  counted, a generation change, a session that vanishes); `widgets/plan` (each view, a raised pane in
  each, a temporary widget); `widgets/placement` (default slots, a remembered place off every
  display, clamping); `widgets/controller` over a fake window factory (create, close after empty or
  the cap, the filtered snapshot sent only when changed, an unknown sender ignored, `select` refused
  for an alias not sent, the drag, pin and lower sequences, the three tries, the popup: raise, lower
  by press and by state, the focused full window, temporary widgets, the popup off, a generation
  rise); `attached-feed` with a fake fetch and clock; `widget/ipc` validation; `widget/page` under happy-dom
  (click against drag at the four-pixel threshold, the pin button and its `aria-pressed`, the size
  report, `seated` on the first snapshot only, a generation change clearing the scene);
  `desktop-state` parsing the new fields; `tray` with and without the widgets entry; `scheme` serving
  the widget host under the strict policy; `settings/actions` and `settings/page` for the two
  controls; `agent-host` calling `onSnapshot` inside its guard.
- `apps/web`: the deep link's parser, and the selection it makes once a snapshot holds the alias.
- The smoke run does not open pages, so the widget page in the archive is covered two ways: a test
  that the bundle step writes every file `page.html` and `page.css` name, as the settings page has,
  and stage 9's manual checklist, which is walked on a packaged build.

## 12. Documents

The desktop design gains a pointer to this one under its stage table. PRD: widgets and the popup
under the desktop milestone, and a decision log row for 21 September 2026 (a widget is a pane, drawn
by a desktop page fed over IPC; dragged by hand; finished means working to idle; lowered by a press
or the next prompt). Desktop README: the View settings under Run, and a section per stage on the
Electron ideas it met, as the earlier stages have.
