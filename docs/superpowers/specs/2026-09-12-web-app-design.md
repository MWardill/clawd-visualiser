# Web app design (Track A: `apps/web` and `packages/scene`)

Milestones A1 to A3 of [the PRD](../../PRD.md). Track A consumes `@clawd/core` 0.1.0 and does
not change it unless unavoidable, and then only additively; Track B builds the agent concurrently
on its own worktree against the same contract.

## 1. Purpose and scope

The web app shows the fleet as the "panes" concept from the proof of concept: a black terminal
with pixel stars and drifting block clouds, tmux-style status bars top and bottom, one box-drawn
pane per repository and one canonical Clawd per session, animated by state. It runs on the
simulated source in the browser when no agent answers, and on the agent's SSE stream when one
does. Clicking a Clawd opens a detail pane whose only content is the redacted ticker, rendered by
xterm.js, plus a focus button that sends the `focus` command.

In scope:

- `packages/scene`: the panes scene on the engine already ported there. Layout, actors, poses,
  atmosphere, nameplates, hit-testing, the draw loop.
- `apps/web`: the feed layer (live and simulated, with the fallback policy), the page, the status
  bars, the tab title, the detail sheet, the xterm.js ticker, the focus command, tests.

Out of scope, deferred to the milestones that own them: cloud mode (M6), replay controls and the
timeline swimlane (M7), the collision *detector* (M7; the marker is drawn if the flag ever
arrives), the optional sound on `waiting` (FR-25), the `claude --resume` line for ended sessions
(FR-28, P2), and any window focusing beyond sending the command (that is the agent's B3).

## 2. Approaches considered

| Decision | Chosen | Alternatives and why not |
| --- | --- | --- |
| Where the state machine runs in simulated mode | In the browser: `createSimulatedSource()` feeds `applyEvent()`, `tickFleet()` and `deriveSnapshot()` from core, so simulated mode exercises the same reducers as the agent and the Vercel deployment needs no server. | A Next route handler streaming a simulated SSE would mirror live wiring exactly, but needs a function per viewer and hits Vercel's streaming cap. Precomputed golden frames are not live. |
| Pane layout | Flowing bands: panes have a fixed width (two seats) and grow downward by rows; they flow left to right in first-seen order and wrap into bands. A pane keeps its place while live; removal lets later panes slide left, with the slide eased. | A uniform grid of fixed cells wastes space and cannot hold a busy pane. tmux-style binary splits that fill the screen look right but resize every pane on every arrival. |
| Nameplates and pane titles | Canvas text on the same canvas, rendered every frame. One canvas, no per-agent DOM (NFR-4), one coordinate system. | DOM overlays give crisper text but mean per-agent DOM and two coordinate systems to keep in step. |
| Live and simulated behind one interface | A `Feed` interface with two implementations and a pure connection policy that picks and switches between them. | Two code paths in the components would duplicate the ticker and snapshot plumbing. |
| Detail pane | A shadcn `Sheet` (side panel) restyled to the terminal look, xterm.js loaded only when it opens. | A fixed side panel is simpler but the sheet gives focus management, escape to close and accessibility for free. |
| Keyboard and screen-reader access | A visually hidden session list with a button per session opens the same detail sheet. | Canvas alone is mouse-only. |

## 3. Architecture

```
                    apps/web                                              packages/scene
 +----------------------------------------------------------+   +-------------------------+
 | connection policy -- picks --> Feed (live | simulated)    |   | mountPanesScene(canvas) |
 |                                  | snapshot ------------------>|  layout . actors . poses|
 |                                  | ticker(alias, event)   |   |  atmosphere . nameplates|
 | <Visualiser> -- <StatusBar> -- <SceneCanvas> - onSelect ------|  hit test . draw loop   |
 |      +- <DetailSheet> -- <TickerTerminal> (xterm.js)      |   +-------------------------+
 |             +- focus --> POST {agent}/api/command         |
 +----------------------------------------------------------+
      live: EventSource {agent}/api/stream, GET /api/ticker/:alias, GET /api/health
      simulated: @clawd/core createSimulatedSource -> applyEvent -> deriveSnapshot
```

The scene never sees events or the agent; it takes a `Snapshot` and draws frames. The app never
sees session ids or pane keys in live mode; in simulated mode they exist only inside the feed and
are left behind by `deriveSnapshot()` exactly as the agent leaves them behind.

## 4. `packages/scene`

### 4.1 Layout

```
packages/scene/src/
  engine.ts        the template's engine, unchanged
  idle.ts          the single idle Clawd, unchanged (used by the sheet's avatar)
  sprites.ts       accessories drawn over a Clawd: walking legs, waving claw, the exclamation
                   mark, sweat drop, zZ, sparkle eyes, the 7 by 4 mini Clawd. Pure draw
                   functions over an Engine.
  atmosphere.ts    seeded stars and clouds sized to a grid; drawNight(engine, frame)
  layout.ts        pure: pane rects and seat positions from a pane list and a grid size
  actors.ts        pure: the actor model and reconcile(panes, actors, snapshot, now)
  poses.ts         pure: poseFor(actor, now, frame) -> eyes, bounce, step, accessories
  text.ts          nameplate and title strings and their colours, pure
  panes.ts         mountPanesScene(): the loop, drawing, pointer handling, visibility pause
  index.ts
  testing/
    fake-context.ts  the recording PixelContext from index.test.ts, moved here and extended to
                     record text; test-only, not exported
```

`engine.ts` stays byte-for-byte what it is. Everything new is written around it, as the
clawd-animation skill prescribes. `@clawd/core` becomes a dependency of the scene for the
`Snapshot` types only (`import type`).

### 4.2 Public API

```ts
type PanesSceneOptions = {
  cellSize?: number;            // CSS pixels per cell, default 6; multiplied by devicePixelRatio for the backing store
  fps?: number;                 // default 30
  font?: string;                // canvas font family for text, default the system monospace stack
  now?: () => number;           // wall clock for `since`, default Date.now
  onSelect?: (alias: string) => void;   // a Clawd or its nameplate was clicked
};

type PanesScene = {
  setSnapshot(s: Snapshot): void;   // reconcile: arrivals walk in, departures walk out
  clear(): void;                    // drop every pane and actor at once (a source switch)
  resize(cssWidth: number, cssHeight: number): void;
  setPaused(paused: boolean): void; // the host may pause; the scene also pauses itself on visibilitychange
  hitTest(cssX: number, cssY: number): string | null;   // alias under a point
  destroy(): void;
};

function mountPanesScene(canvas: HTMLCanvasElement, opts?: PanesSceneOptions): PanesScene;
```

The scene owns the canvas's pointer events: click resolves through `hitTest` to `onSelect`, and
hovering an actor sets the cursor to pointer. `resize` sets the backing store to
`css x devicePixelRatio`, recomputes the grid and re-seeds the atmosphere; the host drives it from
a `ResizeObserver`.

### 4.3 Grid and geometry

Everything is drawn on a cell grid through the engine's `px()`, so nothing anti-aliases (NFR-6).
Text is the one exception and is drawn on cell boundaries at a size scaled by the pixel ratio.

| Constant | Cells | Note |
| --- | --- | --- |
| cell | 6 CSS px | the proof of concept's density |
| seat | 24 wide, 24 tall | sprite at (5, 6) inside the seat; rows 2 to 5 above it hold the exclamation mark, sweat and zZ; nameplate line 1 at row 15, line 2 at row 17; context bar at row 19 |
| pane | 2 seat columns: 2 x 24 + 2 x 2 padding = 52 wide | height = 3 (title row) + rows x 24 + 1; rows = max(1, ceil((highest occupied seat + 1) / 2)) |
| gaps | 3 between panes, 3 at the margins | |
| mini Clawd | 7 by 4 | mini k of a parent sits at its right side, (parent x + 15, parent y - 5 + 5k), clear of the exclamation mark above the head; at most three drawn, the count is on the nameplate |

Seat k of a pane is at column `k % 2`, row `floor(k / 2)`. Seats are indices into a per-pane
`seats: (alias | null)[]`; a newcomer takes the lowest free index, so vacated seats are reused
before the pane grows (FR-17), and a seat's coordinates never change while it is occupied.

Panes flow left to right from the top-left margin in the order the scene first saw them, wrapping
to a new band when the next pane would cross the right edge; a band is as tall as its tallest pane.
The layout is recomputed every frame from the pane list; each pane's drawn origin eases toward its
computed origin over 400 ms, so a pane closing to the left slides its neighbours rather than
snapping them. Actor positions are pane-relative, so a sliding pane carries its Clawds with it and
no Clawd walks because a neighbour closed. A pane that needs more rows than the canvas has is
clipped at the bottom; ten sessions in one pane (five rows, 124 cells) fits a 900 px tall canvas.

With no panes at all, the scene draws the idle Clawd in the centre with the text
`no sessions` beneath it, from the same sprite, so the empty state is the same character.

### 4.4 Actors and reconciliation

```ts
type Actor = {
  alias: string; label: string; pane: string; seat: number;
  state: SessionPhase; activity: Activity | null; subagents: number; contextPct: number | null;
  since: number;                                   // epoch ms, from the snapshot
  phase: "entering" | "seated" | "waving" | "leaving" | "gone";
  pos: { x: number; y: number };                   // pane-relative cells, fractional while moving
  move: { from: XY; to: XY; t0: number; dur: number; ease: "out" | "inout" } | null;
  blinkAt: number; sparkleUntil: number; glanceUntil: number; phaseAt: number;
  subs: Mini[];                                    // { k, pos, move, leaving }
};
type ScenePane = { alias: string; label: string; collision: boolean; seats: (string | null)[]; origin: XY; target: XY; closing: boolean };
```

`reconcile(world, snapshot, now)` and `tick(world, now)` are deterministic for a given clock; they
mutate the world they are given and return it, so the 30 fps loop allocates nothing per frame:

- A pane in the snapshot and not in the scene is appended. A scene pane absent from the snapshot
  is marked `closing`; it is removed once every actor in it is `gone`.
- A session in the snapshot and not in the scene takes the lowest free seat in its pane, starts at
  the pane's bottom edge below that seat, and walks in (`easeOut`, 2 s). A session already known
  has its label, state, activity, subagent count, context and `since` updated in place.
- A known actor whose state becomes `done` starts `waving` (1.6 s), then `leaving`: it walks back
  to the bottom edge (2.6 s, `easeInOut`) fading to 10 % alpha, then is `gone` and its seat is
  freed. Core keeps a `done` session for 4 s, so the exit plays out before the session vanishes.
- An actor missing from the snapshot that is not already waving or leaving starts `leaving` at once
  without the wave: the agent pruned it, or the source changed under us.
- When `subagents` rises, a mini is added and scuttles out to its slot (`easeOut`, 1.2 s), the
  parent's eyes sparkle for 0.6 s and glance toward it for 1.6 s. When it falls, the newest mini
  walks back to the parent over 1.5 s and is removed. At most three minis are drawn.
- Seats are freed only when an actor is `gone`, so a leaver and a newcomer never share a seat.

### 4.5 Poses

`poseFor(actor, now, frame)` is pure and returns `{ eyes, bounce, step, alpha, accessories }`,
following FR-18 and the proof of concept:

| Situation | Eyes | Motion | Accessories and particles |
| --- | --- | --- | --- |
| moving (entering or leaving) | toward the destination | legs alternate every 4 frames, 1-cell bounce | none |
| `working` | `look_down` | breathing on a slow sine | one keystroke particle every 9 frames from alternating claws, coloured by activity: read blue, edit green, run amber, web violet, spawn Clawd orange, think and other star-mid |
| `waiting` | `forward` | a 2-cell hop in the first 35 % of every 1.5 s | amber exclamation mark above the head, shown two beats in three; a blue sweat drop after 10 s in the state |
| `idle` | `forward`, blink for 4 frames every 3 to 7 s | breathing | none |
| `asleep` | `blink` (closed) | slow breathing, body at 82 % alpha | `z Z` drifting above the right claw |
| `waving` (`done`) | `forward` | none | alternate claws every 8 frames, pink heart particles, a heart every 20 frames |
| subagent spawned | sparkle for 0.6 s, then glance right for 1.6 s | | minis scuttle with the walking step |

Mood is carried by eyes, accessories and particles only. The sprite has no mouth and none is
added.

### 4.6 Nameplates, titles and attention

Under each seated Clawd, two lines of text:

1. `otter`, bright and bold; then ` x2` in Clawd orange when subagents are live (FR-19).
2. `working.edit 00:12`, the state, the activity when working, and the time in state; coloured by
   state: green working, amber waiting, dim idle, blue asleep, pink done.

Below them a one-cell-high context bar (FR-20, P1) when `contextPct` is not null: 18 cells wide at
100 %, dim, amber from 80 %. Fields in nameplates and status bars are separated by a middle dot
(U+00B7) and the subagent count uses the multiplication sign (U+00D7); the plain characters in this
document stand in for them.

The pane title (a dash, then the label, as in `- oak`) sits in the top border. The border and the
title are line-coloured, and amber while any session inside is `waiting` (FR-23). A pane whose
`collision` flag is true shows an amber exclamation mark at the right end of its title.

### 4.7 Draw loop

`requestAnimationFrame` with an accumulator at 30 fps, as in the template. Each frame: night
background, stars, clouds, then each pane (border, title, actors sorted by y with leavers last,
minis), then particles. The loop stops on `visibilitychange` to hidden and resumes on visible
(FR-22); the host may also pause it. Tweens are wall-clock based, so a walk interrupted by a
hidden tab completes on return rather than replaying.

### 4.8 Tests

Vitest with the recording fake context in `src/testing/fake-context.ts`:

- `layout`: two panes fit one band at 160 cells and wrap at 100; a pane with three occupied seats
  is two rows tall; seat coordinates; the empty layout.
- `reconcile`: arrival takes the lowest free seat and starts at the bottom edge; a second arrival
  takes seat 1; a vacated seat is reused; `done` starts waving then leaving; a vanished session
  leaves without the wave; a pane with a leaver stays until it is gone; subagent count up and down
  adds and removes minis; alias order never changes an existing seat.
- `poses`: each state's eyes and accessories; the hop window; the sweat drop after 10 s; the blink
  window.
- `sprites`: the mini is 7 by 4 in the body colour with two eyes; the walking frame moves the legs;
  the wave adds two cells on the chosen side.
- `panes` smoke: `mountPanesScene` on a stub canvas with an injected `requestAnimationFrame`
  draws body-coloured cells for one session, `hitTest` returns its alias inside the seat and null
  outside, `clear` empties the scene, `destroy` cancels the frame.

## 5. `apps/web`

### 5.1 Layout

```
apps/web/src/
  app/
    layout.tsx               unchanged: JetBrains Mono, dark terminal theme
    page.tsx                 renders <Visualiser />
    globals.css              existing tokens; imports the juice file
  styles/
    attention.css            the one custom CSS effect: the amber blink of the waiting count
  components/
    visualiser.tsx           client root: feed, snapshot, selection; composes the rest
    scene-canvas.tsx         the canvas, ResizeObserver, mountPanesScene, snapshot forwarding
    status-bar.tsx           top and bottom bars
    session-list.tsx         visually hidden list of sessions with a button each (keyboard, screen readers)
    detail-sheet.tsx         shadcn Sheet: header, focus button, the ticker
    ticker-terminal.tsx      xterm.js, loaded with next/dynamic when the sheet first opens
    clawd-idle.tsx           existing; the sheet's avatar
    ui/                      shadcn: sheet, button, badge
  lib/
    feed/
      types.ts               Feed, FeedStatus, Listener
      live.ts                createLiveFeed(agentUrl, deps)
      simulated.ts           createSimulatedFeed(opts)
      policy.ts              pure connection policy
      agent.ts               probeHealth(), fetchBackfill(), sendCommand(); the agent URL
    ticker/format.ts         TickerEvent -> one coloured terminal line
    labels.ts                counts from a snapshot, the tab title, the canvas label, the source badge
    time.ts                  wall-clock HH:MM:SS; mm:ss comes from the scene package
  hooks/
    use-feed.ts              runs the policy; exposes snapshot, status, ticker subscription, backfill, focus
```

`page.tsx` stays a server component that renders the client root; there is no server data. The
build is static, which is what the Vercel deployment on simulated data needs.

### 5.2 The feed

```ts
type FeedStatus =
  | { mode: "probing" }
  | { mode: "live"; agentUrl: string; connected: boolean; rejected: number }   // rejected: messages that failed schema validation
  | { mode: "simulated"; reason: "no-agent" | "lost-agent" | "forced" };

type Feed = {
  start(listener: { onSnapshot(s: Snapshot): void; onTicker(alias: string, e: TickerEvent): void; onConnection?(connected: boolean, rejected: number): void }): () => void;
  backfill(alias: string): Promise<TickerEvent[]>;
  focus(alias: string): Promise<boolean>;      // false when the feed cannot focus (simulated)
};
```

A feed reports connection facts only; the policy turns them into the `FeedStatus` the status bar
shows.

**Live** (`live.ts`): opens an `EventSource` on `ENDPOINTS.stream`. A `snapshot` event is parsed
with `SnapshotSchema.safeParse`; a `ticker` event with `StreamTickerMessageSchema`. Anything that
fails validation is dropped and counted in `rejected`, which the status bar shows; this is the
schema check NFR-7 asks for on the receiving side. `backfill` fetches `ENDPOINTS.ticker(alias)`
and validates `z.array(TickerEventSchema)`. `focus` posts `{ type: "focus", alias }` to
`ENDPOINTS.command` and resolves true on 202. The `EventSource` constructor and `fetch` are
injected so tests need no network.

**Simulated** (`simulated.ts`): `createSimulatedSource()` from core into a sink that calls
`applyEvent(fleet, e, e.t, SIMULATED_CONFIG)`. Every 250 ms (`SNAPSHOT_MIN_INTERVAL_MS`) it runs
`tickFleet` and `deriveSnapshot`, publishing only when the panes or sessions changed, so display
holds and the asleep timer land on time without flooding the scene. Ticker lines from
`applyEvent` are keyed by session id; the feed maps them to the alias with
`ensureSessionAlias` on the same alias map `deriveSnapshot` returns, keeps the last
`TICKER_BACKFILL` per alias in a ring, and publishes them. `backfill` returns the ring. `focus`
resolves false. Timers are injected. Session ids and pane keys never leave this module.

**Policy** (`policy.ts`), a pure reducer with effects so it is testable without timers:

```
probing --probe ok--> live --stream error, not open again within 10 s--> simulated (lost-agent)
   +--probe fails or times out (1.5 s)--> simulated (no-agent) --re-probe every 10 s, ok--> live
```

Switching feeds calls `scene.clear()` first, so six simulated Clawds do not walk out one by one
when the real fleet arrives. A `?source=simulated` query string forces simulated mode with no
probing (`forced`), and `?source=live` disables the fallback, for debugging either half on its own.
The agent URL is `NEXT_PUBLIC_AGENT_URL` at build time, else `DEFAULT_AGENT_URL`.

### 5.3 Components

- **Visualiser** holds the feed status, the latest snapshot and the selected alias. It sets the
  tab title on every snapshot: `(2) Clawd Visualiser` while two are waiting, `Clawd Visualiser`
  otherwise (FR-24).
- **StatusBar** top: the prompt glyph and `clawd-visualiser`, `4 sessions . 1 waiting . 2
  subagents`, the pane labels, and the source badge: `live . 127.0.0.1:4750`,
  `live . reconnecting`, or `simulated . no agent`. The waiting count blinks amber through the one
  custom CSS file while it is non-zero. Bottom: `click a clawd for its ticker . esc closes`, the
  clock, `local . zero tokens`.
- **SceneCanvas** fills the space between the bars. It waits for `document.fonts.ready`, reads the
  canvas's computed font family so canvas text matches the page, mounts the scene, forwards every
  snapshot, and resizes with a `ResizeObserver`. The canvas has `role="img"` and an `aria-label`
  with the counts.
- **SessionList** is a visually hidden `<ul>` with one `<button>` per session (`Otter, working,
  edit, 2 subagents`) that opens the same detail sheet, so the sheet is reachable by keyboard and
  screen reader.
- **DetailSheet** opens from the right on selection. Header: the idle Clawd avatar, the label,
  state, activity and time in state, the subagent count and context percentage, all from the
  snapshot, refreshed as snapshots arrive. A `focus` button calls `feed.focus`; it is disabled with
  the hint `needs the local agent` in simulated mode. Clicking a Clawd only opens the sheet; the
  focus command is sent by the button, never by the click, so looking at a session does not raise
  another window over the browser. If the session is no longer in the snapshot the header says
  `session ended` and the ticker stays as it was. Below, the ticker.
- **TickerTerminal** mounts xterm.js with the fit addon in the palette's colours, monospace, no
  cursor blink, `disableStdin`. On open it writes the backfill, then appends streamed lines. It is
  loaded through `next/dynamic` with `ssr: false` so xterm.js is not in the initial bundle (the
  PRD's bundle-weight risk).

The ticker line format (`ticker/format.ts`) is one line per event, coloured with ANSI sequences:
`12:04:31 tool.end     edit  Write        40ms`, `12:04:33 state        waiting`,
`12:04:40 subagent     start general-purpose`, `12:05:02 context      41%`,
`12:09:10 session.end  prompt_input_exit`. The only strings are the fields `TickerEvent` carries:
a kind, an activity, a tool name, a subagent type, a state, a reason. Nothing else exists to show.

### 5.4 Styling

Tailwind utilities and the existing tokens for all chrome; shadcn `sheet`, `button` and `badge`
added with the CLI and restyled to square corners and the dark palette through the tokens already
in `globals.css`. The one hand-written CSS file is `styles/attention.css`, the amber blink. No
animation library; the scene animates on its own grid.

### 5.5 Tests

Vitest in `apps/web`, node environment, next to the code:

- `policy`: probe ok goes live; probe fail goes simulated with `no-agent`; a stream error followed
  by no reopen within 10 s goes simulated with `lost-agent`; a later probe ok goes live again;
  `forced` never probes; `live` forced never falls back.
- `simulated feed`: with injected timers, publishes a first snapshot with panes and sessions; a
  ticker line reaches the listener keyed by an alias (`agent-n`), never a session id; `backfill`
  returns at most `TICKER_BACKFILL` lines; the published snapshot parses with `SnapshotSchema`;
  serialising everything published contains no `sim-` id and no pane key.
- `live feed`: with a stub `EventSource`, a valid snapshot reaches the listener; an invalid one is
  dropped and counted; a ticker message is routed by alias; `focus` posts the `Command` shape and
  reads 202; `backfill` validates.
- `format`: each ticker kind renders its fields and no others; the line contains no key outside
  the `TickerEvent` schema.
- `title`, `time`: the strings.

Components are kept thin enough not to need a DOM test runner; the scene's smoke test covers the
canvas side.

## 6. Privacy

The app can only display what it receives, and it receives only `Snapshot`, `TickerEvent` and
`Health`. In live mode every message is validated against the strict wire schemas and dropped
otherwise, so a field that is not in section 8 of the PRD cannot reach a component. In simulated
mode session ids and pane keys exist inside `lib/feed/simulated.ts` and nowhere else; the test
asserts nothing published carries them. Nothing is sent anywhere but the agent's command endpoint,
and only a `Command`.

## 7. Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass from the repo root. `pnpm dev`
with no agent shows the simulated fleet within a few seconds, the source badge reads
`simulated . no agent`, a click opens the sheet with ticker lines, and the tab title counts
waiting sessions. With `?source=live` and no agent the badge reads `live . reconnecting` and the
scene stays empty. A headless Chrome screenshot of the page is the visual check.

## 8. Decisions taken without the user

This design was written in an unattended session. These are the calls a reviewer might make
differently:

1. Work is on the existing `feat/web-app` worktree at `C:\mw\visualiser-web`, not on `main`.
2. Panes are two seats wide and grow by rows; a pane never gets wider.
3. A pane closing slides its right-hand neighbours left, eased, rather than leaving a hole.
4. Simulated to live switching clears the scene instead of walking the fake fleet out.
5. The detail sheet is a shadcn `Sheet` on the right; the ticker is the sheet's body.
6. Sound (FR-25) and the resume line (FR-28) are left out; both are P1 or later and optional.
7. The scene package depends on `@clawd/core` for types only.
8. idle.ts gained the breathing fix (the template formula rounded to nothing on integer frames).
9. The scene's hit test maps CSS pixels through the canvas backing store, so non-integer pixel ratios stay exact.
10. The simulated feed publishes once more right after its source starts, so the first session's snapshot follows its ticker lines in the same call.
11. (User decision, 13 Sep 2026.) Pane labels come from the agent as the working directory's last path segment, numbered on collision; the scene cuts a title longer than 24 characters with an ellipsis. Session labels stay generated.
