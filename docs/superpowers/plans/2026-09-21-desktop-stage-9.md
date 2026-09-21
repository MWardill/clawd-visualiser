# Desktop Stage 9 (Widgets: every pane its own frameless window) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A View setting in the settings window turns the one scene window into one frameless, transparent window per pane, each of which can be dragged anywhere, pinned on top, and found again where it was left; the full window still opens from the tray and from a clicked Clawd; and every window carries the Clawd icon.

**Architecture:** The scene gains additive options for drawing one pane on a transparent canvas with its Clawds clipped to the box. A new page of the desktop package, `app://widget/`, bundles the scene and talks to main through a preload; it may open no connection. Main sees every snapshot (its own agent's through the host, an attached agent's through a one-second poll), and an Electron-free controller decides which windows exist, sends each the snapshot cut down to its pane, and moves, pins and closes them. `main.ts` stays wiring.

**Tech Stack:** Electron 44, electron-builder 26, esbuild 0.28, zod 4, vitest 5, happy-dom 20, TypeScript 5.9, Next 16 / React 19 (one small change), pnpm workspaces. No new dependencies anywhere.

**Spec:** `docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`. This plan is its stage 9 row (§10). Stage 10, the finished popup, has its own plan once this is merged: nothing here builds `raised`, `temporary`, `setFinished`, the finish tracker or the popup setting.

**Stage ideas (new Electron ideas this stage; say them in commit messages and in the README's stage notes):**

- **Frameless and transparent windows.** `frame: false` and `transparent: true` give a window with no chrome and no background; what the page does not paint is the desktop.
- **Moving a window from main.** With no title bar there is nothing for Windows to drag. CSS `-webkit-app-region: drag` would hand the region to Windows and swallow every click in it, so the page reports a press and main moves the window itself with `screen.getCursorScreenPoint()` and `setBounds`.
- **`setAlwaysOnTop`.** A window level, not a z-order nudge: a pinned window stays above ordinary ones whatever is focused.
- **Many windows of one page.** Every widget loads the same URL and shares the same channels; `event.sender` is the only thing that tells them apart, and the only identity main trusts.
- **`invoke` against `send`.** The settings bridge is all `invoke`, because every call has an answer. Most of a widget's calls have none, so they are `send`, with `ipcMain.on` on the other side.
- **`Menu.popup`.** A native context menu raised by main at the page's request.
- **Same-document navigation.** Loading the URL a window already shows, with only the hash changed, does not reload the page; it fires `hashchange`.

## Decisions already made (do not reopen them)

The maintainer chose these on 21 September 2026, in the spec's §2: a widget is a pane; it is drawn by a desktop page fed over IPC; one overlay window is ruled out; dragging is by hand; the box's interior is the night colour, everything outside it transparent, Clawds clipped to the box; the full window stays available; pinning is per widget, by a hover pin and a context menu; the view defaults to window.

The plan's author chose these while planning; each is in the spec already:

- **The generation rises when the snapshot's source changes name** (`own:<run>`, `attached:<port>`), not when the host's mode changes. The host can hand over a snapshot before it reports `own`, and a rise taken from the mode would then throw that snapshot away, and the agent sends another only when something changes.
- **A widget is shown when its page first reports a size**, not when it asks for its state, so it never appears at the wrong size on a scaled display.
- **Clicking the tray icon with no widget open opens the full window**, so the click always does something.
- **The deep link is consumed when it is read**: the hash is removed at once and the alias kept in state, so the same Clawd can be clicked twice.
- **The page sends no `dragMove` until the press has moved four pixels**, so a click never nudges the window or saves a place.
- **The pin's position is fixed in CSS pixels.** A cell is 6 CSS px at 100% and 6.4 at 125%, so the pin can sit up to two pixels off the title row on a scaled display. Task 15's checklist looks at it.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere; a test may spell Windows paths.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first. `window.ts` and `main.ts` are the only files here that load Electron at run time.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on (`tsconfig.base.json`): never assign `undefined` to an optional property, omit it; an indexed read is `T | undefined`.
- No new dependencies in any package.
- `apps/web` changes in Task 4 only, and gains nothing that knows about the desktop app. The Next app keeps zero desktop-specific code; `app://clawd` keeps no preload.
- The widget page may open no connection: it is served under `SETTINGS_POLICY` (`connect-src 'none'`, no inline scripts).
- Every widget IPC handler identifies its window by `event.sender.id` and ignores a sender the controller did not create. No handler may throw: an uncaught exception in main restarts the agent.
- Log lines carry a time, a code and numbers or booleans only. New codes this stage: `desktop.viewChanged` (`widgets`), `desktop.widgetFailed` (`tries`). A pane's label is a folder name: it is written to `desktop.json` and nowhere else, and never logged.
- No session content anywhere: a widget is sent a subset of the snapshot the visualiser's page already fetches, and nothing else.
- Automated checks never run the app against the real `~/.clawd` or `~/.claude`.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-9` in the worktree `C:\mw\visualiser-desktop` (Task 0). Run a package's tests from its directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app or the packager.
- If a step cannot be done as written, stop and say so; do not quietly narrow it. A timing assumption that fails is measured before anything is rewritten (`taskkill` costs about 650 ms on this machine).

## File structure

| File | Responsibility |
| --- | --- |
| `packages/scene/src/layout.ts` | `layoutPanes` takes a margin; new `contentExtent()`. |
| `packages/scene/src/actors.ts` | `reconcile` can seat new sessions at once. |
| `packages/scene/src/engine.ts`, `testing/fake-context.ts` | `PixelContext` gains the six calls clearing and clipping need; the fake records them. |
| `packages/scene/src/panes.ts`, `index.ts`, `README.md` | The widget options: `background`, `clipActors`, `emptyState`, `margin`, `onContentSize`; `setSnapshot(s, { seated })`. |
| `apps/web/src/lib/deep-link.ts`, `components/visualiser.tsx` | New. `#session=<alias>` opens that session's sheet. |
| `apps/agent/src/log.ts` | Two log codes. |
| `apps/desktop/src/desktop-state.ts` | `view` and `widgets` (placements), `placementOf`, `withPlacement`. |
| `apps/desktop/src/agent-client.ts`, `agent-host.ts` | `fetchSnapshot`; the host's `onSnapshot(s, run)`. |
| `apps/desktop/src/attached-feed.ts` | New. Snapshots while attached; `feedPort`. |
| `apps/desktop/src/widget/state.ts`, `channels.ts` | New. The bridge's types and channel names, import-light. |
| `apps/desktop/src/widgets/placement.ts` | New. Where a widget goes; clamping a drop. |
| `apps/desktop/src/widgets/plan.ts`, `menu.ts` | New. Which widgets should exist; a pane's snapshot; the context menu as data. |
| `apps/desktop/src/widgets/controller.ts` | New. The stateful part, over an injected window factory. |
| `apps/desktop/src/widget/ipc.ts`, `preload.ts` | New. Main's handlers, zod-validated; the bridge. |
| `apps/desktop/src/widget/page.html`, `page.css`, `page.ts`, `page.test.ts` | New. The widget page. |
| `apps/desktop/src/scheme.ts`, `paths.ts`, `navigation.ts` | The `widget` host; `widget` and `appIcon` paths; `sessionUrl`. |
| `apps/desktop/src/window.ts` | `icon` for every window; `createWidgetWindow`; `asWidgetWindow`. |
| `apps/desktop/src/settings/*`, `settings-state.ts` | The View control. |
| `apps/desktop/src/tray.ts` | **Show widgets**. |
| `apps/desktop/src/main.ts` | Wiring. |
| `apps/desktop/build/bundle.mjs`, `tsconfig*.json` | The widget page's bundle, its files, the app icon beside the tray's; the page's type-check projects. |
| `docs/PRD.md`, `apps/desktop/README.md`, the spec | What was built, the Electron ideas, the manual checks. |

---

### Task 0: The branch

- [ ] **Step 1: Cut the branch in the desktop worktree and install**

The worktree `C:\mw\visualiser-desktop` is on a detached HEAD at stage 8's last commit, which is merged. Its `apps/desktop/release/` holds the only packaged build; it is ignored by git and must not be deleted.

```bash
git -C C:/mw/visualiser-desktop status --short
git -C C:/mw/visualiser-desktop checkout -b feat/desktop-stage-9 main
cd C:/mw/visualiser-desktop && pnpm install
```

Expected: `status --short` prints nothing (if it prints anything, stop and ask). All later paths are relative to `C:\mw\visualiser-desktop`.

- [ ] **Step 2: Check the plan and the spec are in the branch**

```bash
ls docs/superpowers/plans/2026-09-21-desktop-stage-9.md docs/superpowers/specs/2026-09-21-desktop-widgets-design.md
```

Expected: both listed. If either is missing the maintainer has not committed it to `main`: stop and say so.

- [ ] **Step 3: Confirm the starting point is green**

Run: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace. If anything fails before you have changed a line, stop and report it.

---

### Task 1: The layout takes a margin and measures itself

**Files:**
- Modify: `packages/scene/src/layout.ts`
- Test: `packages/scene/src/layout.test.ts`

**Interfaces:**
- Produces: `layoutPanes(panes: readonly PaneSize[], gridWidth: number, margin?: number): PaneRect[]` (default `MARGIN`, so every existing caller is unchanged); `contentExtent(rects: readonly Rect[], margin: number): { w: number; h: number } | null`, in cells.

- [ ] **Step 1: Write the failing tests**

In `packages/scene/src/layout.test.ts`, add `contentExtent` to the import from `./layout`, and add inside `describe("layout", ...)`:

```ts
  it("lays panes out inside a margin of the caller's choosing", () => {
    const tight = layoutPanes([{ alias: "a", seatsUsed: 1 }, { alias: "b", seatsUsed: 1 }], 200, 1);
    expect(tight.map((r) => [r.x, r.y])).toEqual([[1, 1], [1 + PANE_W + PANE_GAP, 1]]);
    // the wrap is measured against the same margin
    const wrapped = layoutPanes([{ alias: "a", seatsUsed: 1 }, { alias: "b", seatsUsed: 1 }], 1 + PANE_W + PANE_GAP + PANE_W, 1);
    expect(wrapped[1]).toMatchObject({ x: 1, y: 1 + paneHeight(1) + PANE_GAP });
  });

  it("measures what is laid out: the panes' far edges plus the margin, and nothing for no panes", () => {
    expect(contentExtent([], 1)).toBeNull();
    expect(contentExtent(layoutPanes([{ alias: "a", seatsUsed: 1 }], 200, 1), 1)).toEqual({ w: PANE_W + 2, h: paneHeight(1) + 2 });
    expect(contentExtent(layoutPanes([{ alias: "a", seatsUsed: 3 }], 200, 1), 1)).toEqual({ w: PANE_W + 2, h: paneHeight(3) + 2 });
    expect(contentExtent(layoutPanes([{ alias: "a", seatsUsed: 1 }], 200), MARGIN)).toEqual({ w: PANE_W + 2 * MARGIN, h: paneHeight(1) + 2 * MARGIN });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run from `packages/scene`: `npx vitest run src/layout.test.ts`
Expected: FAIL. `contentExtent` is not exported, and the first test gets `[[3, 3], ...]` because the third argument is ignored.

- [ ] **Step 3: Implement**

In `packages/scene/src/layout.ts`, replace `layoutPanes` and its comment with:

```ts
/**
 * Flows panes left to right in the order given, wrapping into a new band when the next pane would
 * cross the right margin; a band is as tall as its tallest pane. The first pane of a band is never
 * wrapped, so a grid narrower than a pane still lays out. `margin` is the cells kept clear at every
 * edge: the scene's own by default, one cell for a widget, whose window is the box and little else.
 */
export function layoutPanes(panes: readonly PaneSize[], gridWidth: number, margin: number = MARGIN): PaneRect[] {
  const out: PaneRect[] = [];
  let x = margin;
  let y = margin;
  let bandH = 0;
  for (const p of panes) {
    const h = paneHeight(p.seatsUsed);
    if (x > margin && x + PANE_W > gridWidth - margin) {
      x = margin;
      y += bandH + PANE_GAP;
      bandH = 0;
    }
    out.push({ alias: p.alias, x, y, w: PANE_W, h });
    x += PANE_W + PANE_GAP;
    bandH = Math.max(bandH, h);
  }
  return out;
}

/** The cells that hold everything laid out, from the grid's origin: the far edges plus the margin. Null with nothing laid out. */
export function contentExtent(rects: readonly Rect[], margin: number): { w: number; h: number } | null {
  if (rects.length === 0) return null;
  let w = 0;
  let h = 0;
  for (const r of rects) {
    w = Math.max(w, r.x + r.w);
    h = Math.max(h, r.y + r.h);
  }
  return { w: w + margin, h: h + margin };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `packages/scene`: `npx vitest run src/layout.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/layout.ts packages/scene/src/layout.test.ts
git commit -m "feat(scene): the pane layout takes a margin and can say how many cells hold what it laid out"
```

---

### Task 2: A session can take its seat at once

**Files:**
- Modify: `packages/scene/src/actors.ts` (`reconcile`, lines 128 to 184)
- Test: `packages/scene/src/actors.test.ts`

**Interfaces:**
- Produces: `type ReconcileOptions = { seated?: boolean }`; `reconcile(world: World, s: Snapshot, now: number, opts?: ReconcileOptions): World`. With `seated`, a session the world has not met is created in phase `"seated"`, at `seatOrigin(seat)`, with `move: null`. Known sessions are untouched by the flag.

- [ ] **Step 1: Write the failing test**

In `packages/scene/src/actors.test.ts`, add inside `describe("reconcile", ...)`:

```ts
  it("seats a session it has not met at once when asked, and still walks later arrivals in", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0, { seated: true });
    const first = w.actors[0]!;
    expect(first.phase).toBe("seated");
    expect(first.pos).toEqual(seatOrigin(0));
    expect(first.move).toBeNull();
    reconcile(w, snap([session({ alias: "agent-1" }), session({ alias: "agent-2" })]), T0 + 1000);
    const second = w.actors[1]!;
    expect(second.phase).toBe("entering");
    expect(second.pos).toEqual(doorOrigin(1, 2));
    // the flag never moves a session already in the world
    expect(w.actors[0]!.pos).toEqual(seatOrigin(0));
  });
```

- [ ] **Step 2: Run it to see it fail**

Run from `packages/scene`: `npx vitest run src/actors.test.ts`
Expected: FAIL: `expected 'entering' to be 'seated'`.

- [ ] **Step 3: Implement**

In `packages/scene/src/actors.ts`, replace the doc comment and signature of `reconcile`:

```ts
export type ReconcileOptions = {
  /** Sessions the world has not met take their seats at once. For a view opened on sessions that were already there: they did not arrive, the view did. */
  seated?: boolean;
};

/**
 * Brings the world in line with a snapshot: new panes are appended, new sessions take the lowest
 * free seat in their pane and walk in from the door (or, with `seated`, are simply there), known
 * sessions are updated in place, done sessions wave, vanished sessions leave without the wave.
 */
export function reconcile(world: World, s: Snapshot, now: number, opts: ReconcileOptions = {}): World {
```

and, inside it, replace the block that creates a new actor (from `const from = doorOrigin(...)` through the `phase`, `pos` and `move` fields) so it reads:

```ts
      const from = doorOrigin(seat, seatsUsed(pane));
      const to = seatOrigin(seat);
      const seated = opts.seated === true;
      a = {
        alias: ss.alias,
        label: ss.label,
        pane: ss.pane,
        seat,
        state: ss.state,
        activity: ss.activity,
        subagents: 0,
        contextPct: ss.contextPct,
        name: ss.detail?.name ?? null,
        subject: ss.detail?.subject ?? null,
        since: Date.parse(ss.since),
        phase: seated ? "seated" : "entering",
        phaseAt: now,
        pos: seated ? { ...to } : { ...from },
        move: seated ? null : { from, to, t0: now, dur: TIMING.enter, ease: "out" },
        blinkAt: nextBlink(ss.alias, now),
        sparkleUntil: 0,
        glanceUntil: 0,
        subs: [],
      };
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `packages/scene`: `npx vitest run src/actors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/actors.ts packages/scene/src/actors.test.ts
git commit -m "feat(scene): reconcile can seat the sessions it has not met at once, for a view opened on sessions already there"
```

---

### Task 3: The scene can draw one pane on a transparent canvas

**Files:**
- Modify: `packages/scene/src/engine.ts:70` (`PixelContext`)
- Modify: `packages/scene/src/testing/fake-context.ts`
- Modify: `packages/scene/src/panes.ts`
- Modify: `packages/scene/README.md`
- Test: `packages/scene/src/panes.test.ts`

**Interfaces:**
- Consumes: `layoutPanes(panes, gridWidth, margin)`, `contentExtent(rects, margin)` (Task 1); `reconcile(world, s, now, { seated })` (Task 2).
- Produces, on `PanesSceneOptions`: `background?: "night" | "none"`, `clipActors?: boolean`, `emptyState?: boolean`, `margin?: number`, `onContentSize?: (size: { width: number; height: number } | null) => void`. On `PanesScene`: `setSnapshot(s: Snapshot, opts?: { seated?: boolean }): void`. With no option given the scene draws exactly what it drew before.

- [ ] **Step 1: Teach the fake context to record clears and clips**

Replace `packages/scene/src/testing/fake-context.ts`'s `fakeContext` function (keep the types above it and `lastColourAt` below it) with:

```ts
export type PathRect = { x: number; y: number; w: number; h: number };

/**
 * A fake 2D context that records every filled rectangle, every string of text, every clear and
 * every clip, so a test can ask what a scene drew. Test-only; not exported from the package.
 */
export function fakeContext() {
  const rects: FilledRect[] = [];
  const texts: DrawnText[] = [];
  const cleared: PathRect[] = [];
  /** One entry per clip(): the rectangles in the path it clipped to. */
  const clips: PathRect[][] = [];
  let path: PathRect[] = [];
  let depth = 0;
  const ctx = {
    fillStyle: "" as string,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "top" as CanvasTextBaseline,
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, col: String(this.fillStyle), alpha: this.globalAlpha });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, col: String(this.fillStyle), font: this.font, align: this.textAlign, alpha: this.globalAlpha });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      cleared.push({ x, y, w, h });
    },
    save() {
      depth++;
    },
    restore() {
      depth--;
    },
    beginPath() {
      path = [];
    },
    rect(x: number, y: number, w: number, h: number) {
      path.push({ x, y, w, h });
    },
    clip() {
      clips.push(path);
    },
  } satisfies PixelContext;
  /** The rectangles that are exactly one cell of `px` canvas pixels, in cell coordinates, in draw order. */
  const cellsOf = (px: number): Cell[] => rects.filter((r) => r.w === px && r.h === px).map((r) => ({ x: r.x / px, y: r.y / px, col: r.col }));
  const reset = (): void => {
    rects.length = 0;
    texts.length = 0;
    cleared.length = 0;
    clips.length = 0;
  };
  /** How many save() calls have no restore() yet; 0 after a frame that balanced them. */
  const saved = (): number => depth;
  return { ctx, rects, texts, cleared, clips, saved, cellsOf, reset };
}
```

In `packages/scene/src/engine.ts`, replace the `PixelContext` line (keep its comment) with:

```ts
export type PixelContext = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect" | "font" | "textAlign" | "textBaseline" | "fillText" | "globalAlpha" | "clearRect" | "save" | "restore" | "beginPath" | "rect" | "clip">;
```

Run from `packages/scene`: `npx vitest run && npx tsc --noEmit`
Expected: PASS. Nothing uses the new calls yet.

- [ ] **Step 2: Write the failing tests**

In `packages/scene/src/panes.test.ts`:

Change the imports at the top to:

```ts
import { CELL, MARGIN, PANE_W, SEAT_H, SEAT_W, TITLE_ROWS, paneHeight, seatOrigin } from "./layout";
import { mountPanesScene, type PanesSceneOptions } from "./panes";
```

Replace the `harness` function's first lines and its `mountPanesScene` call and `return` so the harness takes extra options and hands back what the fake records:

```ts
function harness(dpr = 1, extra: Partial<PanesSceneOptions> = {}) {
  const { ctx, rects, cellsOf, texts, cleared, clips, saved, reset } = fakeContext();
```

```ts
  const scene = mountPanesScene(canvas, {
    ...extra,
    now: () => now,
    devicePixelRatio: dpr,
    document: null,
    requestAnimationFrame: (fn) => {
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
    onSelect: (alias) => selected.push(alias),
  });
```

```ts
  return { scene, canvas, rects, cellsOf, texts, cleared, clips, saved, reset, frames, events, selected, setNow: (t: number) => (now = t), frame };
```

Add at the end of the file:

```ts
/** What the desktop app's widget page passes. */
const WIDGET: Partial<PanesSceneOptions> = { background: "none", clipActors: true, emptyState: false, margin: 1 };

describe("mountPanesScene as a widget", () => {
  it("draws no night and no empty state: the canvas is cleared and only the pane's interior is filled", () => {
    const h = harness(1, WIDGET);
    expect(h.texts.some((t) => t.text === "no sessions")).toBe(false);
    h.scene.setSnapshot(SNAPSHOT, { seated: true });
    h.reset();
    h.frame(0);
    h.frame(100);
    expect(h.cleared).toContainEqual({ x: 0, y: 0, w: 960, h: 600 });
    // the night is one fill of the whole grid; nothing of that size is drawn
    expect(h.rects.some((r) => r.x === 0 && r.y === 0 && r.w === 960)).toBe(false);
    expect(h.rects.some((r) => r.x === CELL && r.y === CELL && r.w === PANE_W * CELL && r.h === paneHeight(1) * CELL && r.col === PALETTE.night.bg)).toBe(true);
    // the pane sits one cell in from the corner, amber because its session waits
    expect(h.cellsOf(CELL).some((c) => c.col === PALETTE.state.amber && c.x === 1 && c.y === 1)).toBe(true);
  });

  it("seats the sessions of a snapshot at once when asked, nameplate and all", () => {
    const h = harness(1, WIDGET);
    h.scene.setSnapshot(SNAPSHOT, { seated: true });
    h.frame(0);
    h.frame(100);
    // a Clawd that is walking in carries no nameplate, and the clock has not moved
    expect(h.texts.some((t) => t.text === "otter")).toBe(true);
  });

  it("clips a pane's Clawds, and the particles, to the inside of its border, and balances every save", () => {
    const h = harness(1, WIDGET);
    h.scene.setSnapshot(SNAPSHOT);
    h.reset();
    h.frame(0);
    h.frame(100);
    const inside = { x: 2 * CELL, y: 2 * CELL, w: (PANE_W - 2) * CELL, h: (paneHeight(1) - 2) * CELL };
    expect(h.clips).toEqual([[inside], [inside]]);
    expect(h.saved()).toBe(0);
  });

  it("neither clears nor clips when no option asks for it", () => {
    const h = harness();
    h.scene.setSnapshot(SNAPSHOT);
    h.frame(0);
    h.frame(100);
    expect(h.cleared).toEqual([]);
    expect(h.clips).toEqual([]);
  });

  it("reports the size its contents need when that changes, never null first, and null once the pane has gone", () => {
    const sizes: ({ width: number; height: number } | null)[] = [];
    const h = harness(1, { ...WIDGET, onContentSize: (size) => sizes.push(size) });
    expect(sizes).toEqual([]);
    h.scene.setSnapshot(SNAPSHOT, { seated: true });
    h.frame(0);
    h.frame(100);
    h.frame(200);
    expect(sizes).toEqual([{ width: (PANE_W + 2) * CELL, height: (paneHeight(1) + 2) * CELL }]);

    const three = [1, 2, 3].map((n) => ({ ...SNAPSHOT.sessions[0]!, alias: `agent-${n}` }));
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: three });
    h.frame(300);
    expect(sizes.at(-1)).toEqual({ width: (PANE_W + 2) * CELL, height: (paneHeight(3) + 2) * CELL });

    h.scene.setSnapshot({ ...SNAPSHOT, panes: [], sessions: [] });
    h.setNow(T0 + 10_000); // long past the walk out
    h.frame(400);
    h.frame(500);
    expect(sizes.at(-1)).toBeNull();
    expect(sizes).toHaveLength(3);
  });

  it("reports CSS pixels, rounded up, when a cell is not a whole number of them", () => {
    const sizes: ({ width: number; height: number } | null)[] = [];
    const h = harness(1.25, { ...WIDGET, onContentSize: (size) => sizes.push(size) });
    h.scene.setSnapshot(SNAPSHOT, { seated: true });
    h.frame(0);
    h.frame(100);
    // 8 device px per cell at 1.25: 54 cells are 345.6 CSS px, 30 cells are 192
    expect(sizes).toEqual([{ width: 346, height: 192 }]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run from `packages/scene`: `npx vitest run src/panes.test.ts`
Expected: FAIL. The widget tests find the night's fill, no clears, no clips and no sizes.

- [ ] **Step 4: Implement**

In `packages/scene/src/panes.ts`:

Change the layout import to add `MARGIN` and `contentExtent`:

```ts
import { CAPTION_ROW, CELL, CONTEXT_ROW, CONTEXT_W, MARGIN, NAME_ROW, SEAT_H, SEAT_W, SPRITE_DX, SPRITE_DY, STATUS_ROW, contentExtent, layoutPanes, type PaneRect } from "./layout";
```

Add to `PanesSceneOptions`, after `onSelect`:

```ts
  /** "none" leaves the canvas transparent and fills each pane's interior with the night colour instead: a widget on the desktop. Default "night". */
  background?: "night" | "none";
  /** Draw a pane's Clawds only inside its border, so one on its way in or out shows only while it is inside the box. Default false. */
  clipActors?: boolean;
  /** Draw the lone "no sessions" Clawd when there is no pane. Default true. */
  emptyState?: boolean;
  /** Cells kept clear at the grid's edges. Default the layout's MARGIN. */
  margin?: number;
  /** The CSS pixels that hold everything laid out, whenever that changes, and null once nothing is. Never called with null first. */
  onContentSize?: (size: { width: number; height: number } | null) => void;
```

Change `setSnapshot` in `PanesScene`:

```ts
  /** Reconcile the world with a snapshot: arrivals walk in, departures walk out. With `seated`, arrivals are simply there. */
  setSnapshot(s: Snapshot, opts?: { seated?: boolean }): void;
```

After `const doc = ...` add:

```ts
  const night = (opts.background ?? "night") === "night";
  const clip = opts.clipActors ?? false;
  const emptyState = opts.emptyState ?? true;
  const margin = opts.margin ?? MARGIN;
  /** The size last reported, as text; null is also what nothing laid out reads as, so an empty start reports nothing. */
  let reported: string | null = null;
```

Replace the first line of `paneRects()` and add the report after it:

```ts
    const laid = layoutPanes(world.panes.map((p) => ({ alias: p.alias, seatsUsed: seatsUsed(p) })), gridW, margin);
    reportSize(contentExtent(laid, margin));
```

Add above `paneRects()`:

```ts
  /** Tells the host what the layout needs, from where the panes are going, not from where they have eased to so far. */
  function reportSize(extent: { w: number; h: number } | null): void {
    if (!opts.onContentSize) return;
    const size = extent === null ? null : { width: Math.ceil((extent.w * PX) / dpr), height: Math.ceil((extent.h * PX) / dpr) };
    const key = size === null ? null : `${size.width}x${size.height}`;
    if (key === reported) return;
    reported = key;
    opts.onContentSize(size);
  }

  /** Limits drawing to the inside of these panes' borders, until the restore() that must follow. */
  function clipTo(panes: readonly PaneRect[]): void {
    ctx.save();
    ctx.beginPath();
    for (const r of panes) ctx.rect((Math.round(r.x) + 1) * PX, (Math.round(r.y) + 1) * PX, (r.w - 2) * PX, (r.h - 2) * PX);
    ctx.clip();
  }
```

In `drawPane`, after `const y = Math.round(r.y);` add:

```ts
    if (!night) {
      // With no night behind it the box carries its own, so its text reads on any wallpaper.
      ctx.fillStyle = PALETTE.night.bg;
      ctx.fillRect(x * PX, y * PX, r.w * PX, r.h * PX);
    }
```

Replace `render()` with:

```ts
  function render(): void {
    const t = now();
    tick(world, t);
    if (night) drawNight(ctx, engine, atmo, frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (world.panes.length === 0 && emptyState) drawEmpty();
    rects = paneRects();
    for (const p of world.panes) {
      const r = rects.get(p.alias);
      if (!r) continue;
      drawPane(p, r);
      const actors = world.actors
        .filter((a) => a.pane === p.alias)
        .sort((a, b) => {
          const la = a.phase === "leaving" ? 1 : 0;
          const lb = b.phase === "leaving" ? 1 : 0;
          return la - lb || a.pos.y - b.pos.y;
        });
      if (clip) clipTo([r]);
      for (const a of actors) drawActor(a, r, t);
      if (clip) ctx.restore();
    }
    if (clip) clipTo([...rects.values()]);
    engine.tickParticles();
    if (clip) ctx.restore();
  }
```

In `resize()`, replace `atmo = createAtmosphere(gridW, gridH);` with:

```ts
    if (night) atmo = createAtmosphere(gridW, gridH);
```

In the returned object, replace `setSnapshot`:

```ts
    setSnapshot(s, o) {
      reconcile(world, s, now(), o ?? {});
    },
```

- [ ] **Step 5: Run the tests to see them pass**

Run from `packages/scene`: `npx vitest run && npx tsc --noEmit`
Expected: PASS, every file.

- [ ] **Step 6: Say so in the package's README**

In `packages/scene/README.md`, replace the code block's first four lines (through `scene.setSnapshot(snapshot);`) with:

```ts
const scene = mountPanesScene(canvas, { font: "JetBrains Mono", onSelect: (alias) => open(alias) });
scene.resize(width, height);   // CSS pixels; call again from a ResizeObserver
scene.setSnapshot(snapshot);   // as often as snapshots arrive

// One pane as a widget on the desktop: a transparent canvas, the box filled, its Clawds clipped to it.
mountPanesScene(canvas, { background: "none", clipActors: true, emptyState: false, margin: 1, onContentSize: (size) => fitWindow(size) });
scene.setSnapshot(snapshot, { seated: true });   // the sessions were already there: no walk in
```

- [ ] **Step 7: Commit**

```bash
git add packages/scene
git commit -m "feat(scene): one pane can be drawn as a widget: a transparent canvas, the box filled, its Clawds clipped to it, and the size it needs reported"
```

---

### Task 4: `#session=<alias>` opens that session's sheet

**Files:**
- Create: `apps/web/src/lib/deep-link.ts`
- Create: `apps/web/src/lib/deep-link.test.ts`
- Modify: `apps/web/src/components/visualiser.tsx`

**Interfaces:**
- Produces: `sessionFromHash(hash: string): string | null`; `linkedSelection(link: string | null, mode: FeedStatus["mode"], snapshot: Snapshot | null): string | null`. Nothing outside `apps/web` imports them; the desktop app only builds the URL (Task 12's `sessionUrl`).

This is the only change to `apps/web`, and it knows nothing of the desktop app: it works in a browser tab.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/deep-link.test.ts`:

```ts
import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { linkedSelection, sessionFromHash } from "./deep-link";

const t = new Date(0).toISOString();
const SNAPSHOT: Snapshot = {
  version: 1,
  generatedAt: t,
  panes: [{ pane: "pane-1", label: "repo" }],
  sessions: [{ alias: "agent-3", label: "Otter", pane: "pane-1", state: "idle", activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t }],
};

describe("sessionFromHash", () => {
  it("reads the alias a #session= hash names", () => {
    expect(sessionFromHash("#session=agent-3")).toBe("agent-3");
    expect(sessionFromHash("#session=agent%2D3")).toBe("agent-3");
  });

  it("is null for any other hash, an empty or over-long alias, a bad escape, or characters no alias has", () => {
    for (const hash of ["", "#", "#session=", "#other=agent-3", "session=agent-3", "#session=%E0%A4%A", "#session=agent 3", "#session=<b>", `#session=${"a".repeat(65)}`]) {
      expect(sessionFromHash(hash), hash).toBeNull();
    }
  });
});

describe("linkedSelection", () => {
  it("is the linked alias once a live snapshot holds it", () => {
    expect(linkedSelection("agent-3", "live", SNAPSHOT)).toBe("agent-3");
  });

  it("is nothing with no link, before the first snapshot, or for an alias the snapshot does not hold", () => {
    expect(linkedSelection(null, "live", SNAPSHOT)).toBeNull();
    expect(linkedSelection("agent-3", "live", null)).toBeNull();
    expect(linkedSelection("agent-9", "live", SNAPSHOT)).toBeNull();
  });

  it("is never honoured from the simulated feed, whose aliases are its own", () => {
    expect(linkedSelection("agent-3", "simulated", SNAPSHOT)).toBeNull();
    expect(linkedSelection("agent-3", "probing", SNAPSHOT)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/web`: `npx vitest run src/lib/deep-link.test.ts`
Expected: FAIL: cannot find `./deep-link`.

- [ ] **Step 3: Implement the two functions**

Create `apps/web/src/lib/deep-link.ts`:

```ts
// A link to one session: `#session=<alias>` opens that session's detail sheet. The desktop app's
// widgets follow one when a Clawd is clicked; typed into a browser tab it does the same.
import type { Snapshot } from "@clawd/core";
import type { FeedStatus } from "./feed/types";

/** What an alias may look like (`agent-12`). Anything else in the hash is not a link of ours. */
const ALIAS = /^[A-Za-z0-9._-]{1,64}$/;

/** The alias a `#session=<alias>` hash names, or null. */
export function sessionFromHash(hash: string): string | null {
  const match = /^#session=(.+)$/.exec(hash);
  if (match === null) return null;
  let alias: string;
  try {
    alias = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  return ALIAS.test(alias) ? alias : null;
}

/**
 * The linked session to show: the link's alias, once a snapshot from the live agent holds it. Never
 * from the simulated feed, whose `agent-3` is somebody else.
 */
export function linkedSelection(link: string | null, mode: FeedStatus["mode"], snapshot: Snapshot | null): string | null {
  if (link === null || mode !== "live" || snapshot === null) return null;
  return snapshot.sessions.some((session) => session.alias === link) ? link : null;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/web`: `npx vitest run src/lib/deep-link.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the client root**

In `apps/web/src/components/visualiser.tsx`, add the import:

```ts
import { linkedSelection, sessionFromHash } from "@/lib/deep-link";
```

and replace everything from `const [selection, setSelection] = ...` through the `const selected = ...` line with:

```tsx
  const [selection, setSelection] = useState<{ alias: string; generation: number } | null>(null);
  // A session named by a #session=<alias> link, until the sheet is closed or another Clawd is chosen.
  const [link, setLink] = useState<string | null>(null);
  const counts = countSnapshot(feed.snapshot);
  const onSelect = useCallback(
    (alias: string) => {
      setLink(null);
      setSelection({ alias, generation: feed.generation });
    },
    [feed.generation],
  );
  const close = useCallback(() => {
    setLink(null);
    setSelection(null);
  }, []);
  const chosen = selection !== null && selection.generation === feed.generation ? selection.alias : null;
  const selected = chosen ?? linkedSelection(link, feed.status.mode, feed.snapshot);

  useEffect(() => {
    let disposed = false;
    // The link is consumed as it is read: the hash goes at once, so the same link can be followed
    // again later and a reload does not reopen the sheet. The newest link wins over a Clawd chosen by hand.
    const read = (): void => {
      if (disposed) return;
      const alias = sessionFromHash(window.location.hash);
      if (alias === null) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setSelection(null);
      setLink(alias);
    };
    window.addEventListener("hashchange", read);
    // The hash the page was loaded with. Deferred so no state setter runs synchronously inside the effect body.
    queueMicrotask(read);
    return () => {
      disposed = true;
      window.removeEventListener("hashchange", read);
    };
  }, []);
```

The existing `useEffect` that sets `document.title` stays as it is, below this.

- [ ] **Step 6: Check it**

Run from `apps/web`: `npx vitest run && npx tsc --noEmit && npx eslint src/components/visualiser.tsx src/lib/deep-link.ts`
Expected: PASS, and eslint prints nothing.

Then by hand: `pnpm --filter @clawd/web dev`, open `http://localhost:3000/#session=agent-1` with an agent running and a session shown. Expected: the detail sheet for `agent-1` opens and the address bar loses the hash; close the sheet, paste the same URL again, and it opens again without the page reloading. With no agent running (the simulated feed) the link opens nothing. If no session is running, note this check as not done and leave it for Task 15's checklist; do not claim it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/deep-link.ts apps/web/src/lib/deep-link.test.ts apps/web/src/components/visualiser.tsx
git commit -m "feat(web): #session=<alias> opens that session's detail sheet once the live agent's snapshot holds it, and the link is consumed as it is read"
```

---

### Task 5: `desktop.json` remembers the view and where each widget was left

**Files:**
- Modify: `apps/desktop/src/desktop-state.ts`
- Test: `apps/desktop/src/desktop-state.test.ts`

**Interfaces:**
- Produces: `type View = "window" | "widgets"`; `type Placement = { x: number; y: number; pinned: boolean }`; `DesktopState` gains `view?: View` and `widgets?: Record<string, Placement>`; `MAX_PLACEMENTS = 200`; `placementOf(state: DesktopState, label: string): Placement | undefined`; `withPlacement(all: Record<string, Placement> | undefined, label: string, placement: Placement): Record<string, Placement>`.

The file's version stays 2: the fields are additive, each judged on its own, and an older build simply drops them. A label is a folder name, so it can be `constructor` or `__proto__`: every read goes by own property and every write through `Object.fromEntries`, which defines own properties and never touches the prototype.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/desktop-state.test.ts`, change the import to:

```ts
import { MAX_PLACEMENTS, createDesktopStore, desktopStatePath, parseDesktopState, placementOf, withPlacement } from "./desktop-state";
```

and add inside `describe("parseDesktopState", ...)`:

```ts
  it("keeps the view and each widget's place, each judged on its own", () => {
    const widgets = { visualiser: { x: 40, y: 60, pinned: true }, "b2b 2": { x: -1200, y: 0, pinned: false } };
    expect(parseDesktopState({ version: 2, view: "widgets", widgets })).toEqual({ view: "widgets", widgets });
    expect(parseDesktopState({ version: 2, view: "floating" })).toEqual({});
    expect(parseDesktopState({ version: 2, widgets: [widgets] })).toEqual({});
    expect(parseDesktopState({ version: 2, widgets: { ok: { x: 1, y: 2, pinned: false }, half: { x: 1.5, y: 2, pinned: false }, loose: { x: 1, y: 2 }, "": { x: 1, y: 2, pinned: true }, flat: 7 } })).toEqual({
      widgets: { ok: { x: 1, y: 2, pinned: false } },
    });
  });

  it("keeps only the 200 places written last", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_PLACEMENTS + 5 }, (_, i) => [`folder-${i}`, { x: i, y: 0, pinned: false }]));
    const kept = Object.keys(parseDesktopState({ version: 2, widgets: many }).widgets ?? {});
    expect(kept).toHaveLength(MAX_PLACEMENTS);
    expect(kept[0]).toBe("folder-5");
  });
```

and add at the end of the file:

```ts
describe("placements", () => {
  const HERE = { x: 10, y: 20, pinned: false };

  it("reads a folder's place by its own name only, whatever the folder is called", () => {
    const state = parseDesktopState(JSON.parse('{"version":2,"widgets":{"__proto__":{"x":1,"y":2,"pinned":true},"repo":{"x":10,"y":20,"pinned":false}}}'));
    expect(placementOf(state, "repo")).toEqual(HERE);
    expect(placementOf(state, "__proto__")).toEqual({ x: 1, y: 2, pinned: true });
    expect(placementOf(state, "constructor")).toBeUndefined();
    expect(placementOf(state, "toString")).toBeUndefined();
    expect(placementOf({}, "repo")).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // nothing reached the prototype
  });

  it("writes a place last, replacing the folder's old one, and drops the oldest past the cap", () => {
    expect(withPlacement(undefined, "repo", HERE)).toEqual({ repo: HERE });
    const moved = withPlacement({ repo: HERE, docs: HERE }, "repo", { ...HERE, x: 99 });
    expect(Object.keys(moved)).toEqual(["docs", "repo"]);
    expect(moved.repo).toEqual({ ...HERE, x: 99 });
    const full = Object.fromEntries(Array.from({ length: MAX_PLACEMENTS }, (_, i) => [`folder-${i}`, HERE]));
    const next = withPlacement(full, "new", HERE);
    expect(Object.keys(next)).toHaveLength(MAX_PLACEMENTS);
    expect(Object.keys(next)[0]).toBe("folder-1");
    expect(Object.keys(next).at(-1)).toBe("new");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/desktop-state.test.ts`
Expected: FAIL: `placementOf` is not exported.

- [ ] **Step 3: Implement**

In `apps/desktop/src/desktop-state.ts`, replace the `DesktopState` type line with:

```ts
/** The one scene window, or one frameless window per pane. */
export type View = "window" | "widgets";
/** Where a folder's widget was left, and whether it was pinned on top. */
export type Placement = { x: number; y: number; pinned: boolean };
export type DesktopState = { bounds?: Bounds; maximized?: boolean; openAtLogin?: boolean; view?: View; widgets?: Record<string, Placement> };

/** Folders come and go; the file does not grow for ever. */
export const MAX_PLACEMENTS = 200;
/** Longer than any directory name Windows allows. */
const MAX_LABEL = 300;
```

Add above `parseDesktopState` (it uses `whole`, which is already defined above it):

```ts
/** The valid places in a `widgets` object, the last 200 written. Built with fromEntries, so a folder called `__proto__` is a key like any other. */
function parsePlacements(value: unknown): Record<string, Placement> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kept: [string, Placement][] = [];
  for (const [label, raw] of Object.entries(value)) {
    if (label.length === 0 || label.length > MAX_LABEL || typeof raw !== "object" || raw === null) continue;
    const { x, y, pinned } = raw as Record<string, unknown>;
    if (whole(x) && whole(y) && typeof pinned === "boolean") kept.push([label, { x, y, pinned }]);
  }
  return Object.fromEntries(kept.slice(-MAX_PLACEMENTS));
}

/** A folder's remembered place. By own property only: a folder may be called `constructor`. */
export function placementOf(state: DesktopState, label: string): Placement | undefined {
  const all = state.widgets;
  return all !== undefined && Object.hasOwn(all, label) ? all[label] : undefined;
}

/** The places with this one written last, and the oldest-written dropped past the cap. */
export function withPlacement(all: Record<string, Placement> | undefined, label: string, placement: Placement): Record<string, Placement> {
  const rest = Object.entries(all ?? {}).filter(([key]) => key !== label);
  return Object.fromEntries([...rest, [label, placement] as const].slice(-MAX_PLACEMENTS));
}
```

In `parseDesktopState`, widen the cast and add two lines before `return state;`:

```ts
  const file = value as { version?: unknown; bounds?: unknown; maximized?: unknown; openAtLogin?: unknown; view?: unknown; widgets?: unknown };
```

```ts
  if (file.view === "window" || file.view === "widgets") state.view = file.view;
  const widgets = parsePlacements(file.widgets);
  if (widgets !== undefined) state.widgets = widgets;
```

Update the file's header comment: after `The window's bounds, and whether the user wants the app at login,` add `the view (one window or a widget per pane) and where each folder's widget was left,`.

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/desktop-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/desktop-state.ts apps/desktop/src/desktop-state.test.ts
git commit -m "feat(desktop): desktop.json remembers the view and where each folder's widget was left, by own property so a folder may be called anything"
```

---

### Task 6: Every snapshot reaches main, attached or not

**Files:**
- Modify: `apps/agent/src/log.ts`
- Modify: `apps/desktop/src/agent-client.ts`, `apps/desktop/src/agent-host.ts`
- Create: `apps/desktop/src/attached-feed.ts`, `apps/desktop/src/attached-feed.test.ts`
- Test: `apps/desktop/src/agent-client.test.ts`, `apps/desktop/src/agent-host.test.ts`

**Interfaces:**
- Consumes: `View` (Task 5).
- Produces: log codes `"desktop.viewChanged"` and `"desktop.widgetFailed"`; `fetchSnapshot(port: number, timeoutMs?: number): Promise<Snapshot | null>`; `AgentHostDeps.onSnapshot?(s: Snapshot, run: number): void`; `ATTACHED_FEED_MS = 1_000`; `feedPort(host: Pick<HostState, "mode" | "port">, view: View): number | null`; `createAttachedFeed(deps: { fetch(port: number): Promise<Snapshot | null>; onSnapshot(s: Snapshot, port: number): void; intervalMs?: number }): { watch(port: number | null): void; stop(): void }`.

- [ ] **Step 1: Add the two log codes**

In `apps/agent/src/log.ts`, after the line `  | "desktop.loginItem"` add:

```ts
  | "desktop.viewChanged"
  | "desktop.widgetFailed"
```

- [ ] **Step 2: Write the failing tests for the client and the host**

In `apps/desktop/src/agent-client.test.ts`, add `fetchSnapshot` to the import from `./agent-client`, and add at the end of the file:

```ts
describe("fetchSnapshot", () => {
  it("is the agent's snapshot, and null for a body that is not one, an error status or nothing listening", async () => {
    const s = snapshot(["working", "idle"]);
    expect(await fetchSnapshot(await serve(reply(s)))).toEqual(s);
    expect(await fetchSnapshot(await serve(reply({ sessions: "many" })))).toBeNull();
    expect(await fetchSnapshot(await serve(reply(s, 500)))).toBeNull();
    expect(await fetchSnapshot(await closedPort())).toBeNull();
  });

  it("sends no Origin, so an agent that refuses the app's page still answers main", async () => {
    let origin: string | undefined = "unset";
    const port = await serve((req, res) => {
      origin = req.headers.origin;
      reply(snapshot([]))(req, res);
    });
    await fetchSnapshot(port);
    expect(origin).toBeUndefined();
  });
});
```

In `apps/desktop/src/agent-host.test.ts`, change the harness's options type and the `createAgentHost` call so a test can listen:

```ts
function harness(opts: { fail?: unknown[]; probe?: AgentHostDeps["probe"]; counts?: AgentHostDeps["counts"]; onSnapshot?: NonNullable<AgentHostDeps["onSnapshot"]> } = {}) {
```

```ts
    log: (code) => void codes.push(code),
    now: () => Date.now(),
    ...(opts.onSnapshot === undefined ? {} : { onSnapshot: opts.onSnapshot }),
  });
```

and add inside `describe("createAgentHost", ...)`:

```ts
  it("hands its own agent's snapshots on with the number of the start they came from, and never a replaced agent's", async () => {
    const seen: Array<[number, number]> = [];
    const { host, agents } = harness({ onSnapshot: (s, run) => void seen.push([s.sessions.length, run]) });
    host.start();
    await flush();
    agents[0]?.emit(snapshot(["working"]));
    host.fault();
    await flush();
    await advance(1_000);
    agents[0]?.emit(snapshot(["working", "idle"]));
    agents[1]?.emit(snapshot(["working", "idle", "idle"]));
    expect(seen).toEqual([
      [1, 1],
      [3, 2],
    ]);
  });
```

- [ ] **Step 3: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/agent-client.test.ts src/agent-host.test.ts`
Expected: FAIL: `fetchSnapshot` is not a function, and `seen` is `[]`.

- [ ] **Step 4: Implement them**

In `apps/desktop/src/agent-client.ts`, replace `fetchCounts` and its comment with:

```ts
/** The snapshot of the agent on the port, or null when it does not answer with one. Asked with no Origin, as a hook or the CLI would, so an agent that refuses the app's page still answers. */
export async function fetchSnapshot(port: number, timeoutMs = COUNTS_TIMEOUT_MS): Promise<Snapshot | null> {
  try {
    const parsed = SnapshotSchema.safeParse(await getJson(port, ENDPOINTS.snapshot, timeoutMs));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The session counts of the agent on the port, or null when it does not answer with a snapshot. */
export async function fetchCounts(port: number, timeoutMs = COUNTS_TIMEOUT_MS): Promise<Counts | null> {
  const s = await fetchSnapshot(port, timeoutMs);
  return s === null ? null : countsOf(s);
}
```

In `apps/desktop/src/agent-host.ts`, add to `AgentHostDeps` after `counts`:

```ts
  /** Every snapshot of the agent this app owns, with the number of the start it came from: a new number means a new agent, whose aliases and states owe nothing to the last one's. */
  onSnapshot?(s: Snapshot, run: number): void;
```

and in `attempt()`, replace the callback handed to `deps.start`:

```ts
      const running = await deps.start((s) => {
        if (mine !== run || stopped()) return;
        set(countsOf(s));
        deps.onSnapshot?.(s, mine);
      });
```

- [ ] **Step 5: Run them to see them pass**

Run from `apps/desktop`: `npx vitest run src/agent-client.test.ts src/agent-host.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing tests for the attached feed**

Create `apps/desktop/src/attached-feed.test.ts`:

```ts
import type { Snapshot } from "@clawd/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACHED_FEED_MS, createAttachedFeed, feedPort } from "./attached-feed";
import { snapshot } from "./testing/snapshot";

/** Runs every queued promise callback. setImmediate is left real by the fake timers below. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

function harness(answer: (port: number) => Promise<Snapshot | null>) {
  const asked: number[] = [];
  const seen: Array<[number, number]> = [];
  const feed = createAttachedFeed({
    fetch: (port) => {
      asked.push(port);
      return answer(port);
    },
    onSnapshot: (s, port) => void seen.push([s.sessions.length, port]),
  });
  return { feed, asked, seen };
}

describe("feedPort", () => {
  it("is the attached agent's port while widgets are shown, and nothing otherwise", () => {
    expect(feedPort({ mode: "attached", port: 4750 }, "widgets")).toBe(4750);
    expect(feedPort({ mode: "attached", port: 4750 }, "window")).toBeNull();
    expect(feedPort({ mode: "own", port: 4750 }, "widgets")).toBeNull();
    expect(feedPort({ mode: "attached", port: null }, "widgets")).toBeNull();
  });
});

describe("createAttachedFeed", () => {
  it("asks at once, hands each snapshot on with its port, and asks again a second after each answer", async () => {
    const { feed, asked, seen } = harness(async () => snapshot(["working"]));
    feed.watch(4750);
    await flush();
    expect(seen).toEqual([[1, 4750]]);
    await advance(ATTACHED_FEED_MS - 1);
    expect(asked).toHaveLength(1);
    await advance(1);
    expect(asked).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });

  it("never has two requests out: the next is timed from the answer, not from the question", async () => {
    let release: (s: Snapshot | null) => void = () => {};
    const { feed, asked } = harness(() => new Promise((resolve) => (release = resolve)));
    feed.watch(4750);
    await advance(10 * ATTACHED_FEED_MS);
    expect(asked).toHaveLength(1);
    release(snapshot([]));
    await flush();
    await advance(ATTACHED_FEED_MS);
    expect(asked).toHaveLength(2);
  });

  it("carries on past an agent that has no answer, or a fetch that throws", async () => {
    let n = 0;
    const { feed, asked, seen } = harness(async () => {
      n++;
      if (n === 1) return null;
      if (n === 2) throw new Error("boom");
      return snapshot(["idle"]);
    });
    feed.watch(4750);
    await flush();
    await advance(ATTACHED_FEED_MS);
    await advance(ATTACHED_FEED_MS);
    expect(asked).toHaveLength(3);
    expect(seen).toEqual([[1, 4750]]);
  });

  it("stops when told, drops an answer that arrives afterwards, follows a new port, and does not restart for the same one", async () => {
    let release: (s: Snapshot | null) => void = () => {};
    const { feed, asked, seen } = harness(() => new Promise((resolve) => (release = resolve)));
    feed.watch(4750);
    feed.watch(4750);
    expect(asked).toEqual([4750]);
    feed.stop();
    release(snapshot(["working"]));
    await flush();
    await advance(5 * ATTACHED_FEED_MS);
    expect(seen).toEqual([]);
    expect(asked).toEqual([4750]);
    feed.watch(4751);
    expect(asked).toEqual([4750, 4751]);
  });
});
```

- [ ] **Step 7: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/attached-feed.test.ts`
Expected: FAIL: cannot find `./attached-feed`.

- [ ] **Step 8: Implement the feed**

Create `apps/desktop/src/attached-feed.ts`:

```ts
// Snapshots while attached. The app's own agent hands main every snapshot as it is made; an agent
// the app is only attached to (the CLI's, say) does not, and the host asks it for counts every ten
// seconds, which is too slow to draw from. While widgets are shown this asks it for the snapshot
// every second instead. Electron-free, with the fetch injected.
import type { Snapshot } from "@clawd/core";
import type { HostState } from "./agent-host";
import type { View } from "./desktop-state";

export const ATTACHED_FEED_MS = 1_000;

/** The port to ask: only while attached, and only while something draws from snapshots main would otherwise lack. */
export function feedPort(host: Pick<HostState, "mode" | "port">, view: View): number | null {
  return host.mode === "attached" && view === "widgets" ? host.port : null;
}

export type AttachedFeedDeps = {
  /** The snapshot of the agent on the port, or null. */
  fetch(port: number): Promise<Snapshot | null>;
  onSnapshot(s: Snapshot, port: number): void;
  intervalMs?: number;
};

export type AttachedFeed = {
  /** Ask this port from now on, or nobody. The same port again changes nothing. */
  watch(port: number | null): void;
  stop(): void;
};

export function createAttachedFeed(deps: AttachedFeedDeps): AttachedFeed {
  const interval = deps.intervalMs ?? ATTACHED_FEED_MS;
  let watched: number | null = null;
  /** Which watch is current, so an answer to an earlier one is dropped. */
  let turn = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const ask = async (mine: number, port: number): Promise<void> => {
    let s: Snapshot | null = null;
    try {
      s = await deps.fetch(port);
    } catch {
      // No answer this time.
    }
    if (mine !== turn) return;
    if (s !== null) deps.onSnapshot(s, port);
    // Timed from the answer, so a slow agent never has two requests out.
    timer = setTimeout(() => {
      timer = null;
      void ask(mine, port);
    }, interval);
  };

  const watch = (port: number | null): void => {
    if (port === watched) return;
    watched = port;
    turn++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (port !== null) void ask(turn, port);
  };

  return { watch, stop: () => watch(null) };
}
```

- [ ] **Step 9: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/attached-feed.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/agent/src/log.ts apps/desktop/src/agent-client.ts apps/desktop/src/agent-client.test.ts apps/desktop/src/agent-host.ts apps/desktop/src/agent-host.test.ts apps/desktop/src/attached-feed.ts apps/desktop/src/attached-feed.test.ts
git commit -m "feat(desktop): every snapshot can reach main: the host hands on its own agent's with the start they came from, and an attached agent is asked once a second while widgets are shown"
```

---

### Task 7: Where a widget goes

**Files:**
- Create: `apps/desktop/src/widget/state.ts`
- Create: `apps/desktop/src/widgets/placement.ts`, `apps/desktop/src/widgets/placement.test.ts`

**Interfaces:**
- Consumes: `Bounds`, `Placement` (Task 5); `restoredBounds(saved, workAreas)` from `../bounds`.
- Produces: `WidgetSize`, `WidgetState`, `WidgetApi` (the bridge's types, used from Task 9 on); `DEFAULT_WIDGET_SIZE = { width: 324, height: 180 }`; `SLOT_GAP = 12`; `placeWidget(input: { remembered: Placement | undefined; size: WidgetSize; workAreas: readonly Bounds[]; primary: Bounds; taken: readonly Bounds[] }): Bounds`; `clampDrop(dropped: Bounds, workAreas: readonly Bounds[]): Bounds`.

Two directories with near names: `src/widget/` is the page and its bridge (one widget, as `src/settings/` is the settings page); `src/widgets/` is main's side, which manages all of them.

- [ ] **Step 1: Write the bridge's types**

Create `apps/desktop/src/widget/state.ts`:

```ts
// What a widget page draws, and the bridge it talks to main through. Imports a type from core and
// nothing else: the page is sandboxed browser code, checked by tsconfig.page.json with no Node
// types, and core is pure TypeScript with none either.
import type { Snapshot } from "@clawd/core";

export type WidgetSize = { width: number; height: number };

export type WidgetState = {
  /** The snapshot cut down to this window's pane; null before the first one. */
  snapshot: Snapshot | null;
  /** Rises when snapshots start coming from another agent; the page clears its scene, as the visualiser's does. */
  generation: number;
  pinned: boolean;
};

/**
 * The bridge: what the preload publishes as `window.clawdWidget`. Only `ready` has an answer; the
 * rest are one-way. The page never learns which pane it is: it draws the snapshot it is sent.
 */
export type WidgetApi = {
  /** Asked once the scene is mounted. Null to a window main does not know. */
  ready(): Promise<WidgetState | null>;
  /** Subscribes to the states main pushes; returns the unsubscribe. */
  onState(cb: (s: WidgetState) => void): () => void;
  /** The CSS pixels the contents need, or null once there is nothing left to draw. */
  resize(size: WidgetSize | null): void;
  /** A press began; main notes where the cursor is on the window. No coordinates cross the bridge. */
  dragStart(): void;
  /** The pointer moved past a click's slop; main moves the window to the cursor. */
  dragMove(): void;
  dragEnd(): void;
  togglePin(): void;
  /** A Clawd was clicked. */
  select(alias: string): void;
  /** The right button: main pops the native menu. */
  menu(): void;
};
```

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/src/widgets/placement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_WIDGET_SIZE, SLOT_GAP, clampDrop, placeWidget } from "./placement";

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT = { x: -1280, y: 0, width: 1280, height: 984 };
const SIZE = DEFAULT_WIDGET_SIZE;
const FIRST = { x: PRIMARY.width - SIZE.width - SLOT_GAP, y: SLOT_GAP, ...SIZE };

const place = (over: Partial<Parameters<typeof placeWidget>[0]> = {}) => placeWidget({ remembered: undefined, size: SIZE, workAreas: [PRIMARY], primary: PRIMARY, taken: [], ...over });

describe("placeWidget", () => {
  it("puts the first widget at the top right of the primary work area, and the next ones under it", () => {
    expect(place()).toEqual(FIRST);
    const second = place({ taken: [FIRST] });
    expect(second).toEqual({ ...FIRST, y: FIRST.y + SIZE.height + SLOT_GAP });
    expect(place({ taken: [FIRST, second] }).y).toBe(second.y + SIZE.height + SLOT_GAP);
  });

  it("starts a new column to the left when the next slot would leave the work area", () => {
    const column = Array.from({ length: 5 }, (_, i) => ({ ...FIRST, y: FIRST.y + i * (SIZE.height + SLOT_GAP) }));
    // five fit in 1040 px: 12 + 5 * 192 = 972; a sixth would end at 1152
    expect(place({ taken: column })).toEqual({ ...FIRST, x: FIRST.x - SIZE.width - SLOT_GAP });
  });

  it("measures the slots against the window's own size, and respects a work area that does not start at the origin", () => {
    const tall = { width: 346, height: 384 };
    const primary = { x: 100, y: 50, width: 1600, height: 900 };
    expect(place({ size: tall, primary, workAreas: [primary] })).toEqual({ x: 100 + 1600 - 346 - SLOT_GAP, y: 50 + SLOT_GAP, ...tall });
  });

  it("goes back where it was left, on any display, at the size it has now", () => {
    expect(place({ remembered: { x: 40, y: 60, pinned: true } })).toEqual({ x: 40, y: 60, ...SIZE });
    expect(place({ remembered: { x: -1000, y: 100, pinned: false }, workAreas: [PRIMARY, LEFT] })).toEqual({ x: -1000, y: 100, ...SIZE });
  });

  it("falls back to a default slot when the remembered place is on no display now", () => {
    expect(place({ remembered: { x: -1000, y: 100, pinned: false }, workAreas: [PRIMARY] })).toEqual(FIRST);
  });

  it("gives up looking for a free slot rather than loop for ever", () => {
    expect(place({ taken: [{ x: -5000, y: -5000, width: 10_000, height: 10_000 }] })).toEqual(FIRST);
  });
});

describe("clampDrop", () => {
  it("leaves a widget where it was dropped while its top strip can still be grabbed", () => {
    const hanging = { x: 1700, y: 900, ...SIZE };
    expect(clampDrop(hanging, [PRIMARY])).toEqual(hanging);
  });

  it("pulls a widget dropped off every display wholly inside the nearest one", () => {
    expect(clampDrop({ x: 2500, y: 300, ...SIZE }, [PRIMARY])).toEqual({ x: PRIMARY.width - SIZE.width, y: 300, ...SIZE });
    expect(clampDrop({ x: 300, y: -400, ...SIZE }, [PRIMARY])).toEqual({ x: 300, y: 0, ...SIZE });
    expect(clampDrop({ x: -3000, y: 2000, ...SIZE }, [PRIMARY, LEFT])).toEqual({ x: LEFT.x, y: LEFT.height - SIZE.height, ...SIZE });
  });

  it("has nowhere to pull to with no display reported", () => {
    const lost = { x: 9000, y: 9000, ...SIZE };
    expect(clampDrop(lost, [])).toEqual(lost);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widgets/placement.test.ts`
Expected: FAIL: cannot find `./placement`.

- [ ] **Step 4: Implement**

Create `apps/desktop/src/widgets/placement.ts`:

```ts
// Where a widget's window goes. A folder's widget goes back where it was left, if that place is
// still on a display; otherwise it takes the next free slot, down from the top right of the primary
// work area and then leftwards in columns. Pure: the displays are passed in.
import { restoredBounds } from "../bounds";
import type { Bounds, Placement } from "../desktop-state";
import type { WidgetSize } from "../widget/state";

/** One row of seats at 100% scaling: 54 by 30 cells of 6 px. Only a starting size: the page reports the real one once it has laid out. */
export const DEFAULT_WIDGET_SIZE: WidgetSize = { width: 324, height: 180 };
/** Between default slots, and between the first one and the work area's edges. */
export const SLOT_GAP = 12;
const MAX_SLOTS = 60;

const overlaps = (a: Bounds, b: Bounds): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export type PlaceInput = {
  remembered: Placement | undefined;
  size: WidgetSize;
  /** Every display's work area, for judging a remembered place. */
  workAreas: readonly Bounds[];
  /** The primary display's work area, where default slots are. */
  primary: Bounds;
  /** The widgets already open, which a default slot must not cover. */
  taken: readonly Bounds[];
};

export function placeWidget({ remembered, size, workAreas, primary, taken }: PlaceInput): Bounds {
  if (remembered !== undefined) {
    // The same rule as the full window's: enough of the top strip must show to grab it.
    const kept = restoredBounds({ x: remembered.x, y: remembered.y, ...size }, workAreas);
    if (kept !== null) return { x: kept.x, y: kept.y, ...size };
  }
  const first: Bounds = { x: primary.x + primary.width - size.width - SLOT_GAP, y: primary.y + SLOT_GAP, ...size };
  let slot = first;
  for (let i = 0; i < MAX_SLOTS; i++) {
    const candidate = slot;
    if (!taken.some((other) => overlaps(candidate, other))) return candidate;
    const below = { ...candidate, y: candidate.y + size.height + SLOT_GAP };
    slot = below.y + size.height <= primary.y + primary.height ? below : { ...candidate, x: candidate.x - size.width - SLOT_GAP, y: first.y };
  }
  return first;
}

/**
 * Where a dropped widget may stay: where it is, while its top strip can still be grabbed; else
 * pulled wholly inside the display nearest its centre, so a widget flung off the edge is not lost.
 */
export function clampDrop(dropped: Bounds, workAreas: readonly Bounds[]): Bounds {
  if (restoredBounds(dropped, workAreas) !== null) return dropped;
  const cx = dropped.x + dropped.width / 2;
  const cy = dropped.y + dropped.height / 2;
  let home: Bounds | undefined;
  let nearest = Infinity;
  for (const area of workAreas) {
    const dx = Math.max(area.x - cx, 0, cx - (area.x + area.width));
    const dy = Math.max(area.y - cy, 0, cy - (area.y + area.height));
    if (dx * dx + dy * dy < nearest) {
      nearest = dx * dx + dy * dy;
      home = area;
    }
  }
  if (home === undefined) return dropped;
  const x = Math.min(Math.max(dropped.x, home.x), Math.max(home.x, home.x + home.width - dropped.width));
  const y = Math.min(Math.max(dropped.y, home.y), Math.max(home.y, home.y + home.height - dropped.height));
  return { ...dropped, x, y };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widgets/placement.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/widget/state.ts apps/desktop/src/widgets/placement.ts apps/desktop/src/widgets/placement.test.ts
git commit -m "feat(desktop): a widget goes back where it was left or takes the next free slot, a dropped one stays grabbable, and the bridge's types are spelled once"
```

---

### Task 8: Which widgets should exist, and their menu

**Files:**
- Create: `apps/desktop/src/widgets/plan.ts`, `apps/desktop/src/widgets/plan.test.ts`
- Create: `apps/desktop/src/widgets/menu.ts`, `apps/desktop/src/widgets/menu.test.ts`

**Interfaces:**
- Consumes: `View` (Task 5).
- Produces: `type WantedWidget = { label: string; pane: string }`; `planWidgets(input: { snapshot: Snapshot; view: View }): WantedWidget[]`; `paneSnapshot(s: Snapshot, pane: string): Snapshot`; `emptied(s: Snapshot): Snapshot`; `type WidgetMenuActions = { togglePin(): void; openWindow(): void; settings(): void }`; `widgetMenuTemplate(pinned: boolean, actions: WidgetMenuActions): MenuItemConstructorOptions[]`.

`planWidgets` is small this stage. It is its own module because stage 10 adds the popup's rules to it (the raised set, the focused full window, temporary widgets), and they are easier to add to a function that already has its tests.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/widgets/plan.test.ts`:

```ts
import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { emptied, paneSnapshot, planWidgets } from "./plan";

const t = new Date(0).toISOString();
const session = (alias: string, pane: string) => ({ alias, label: alias, pane, state: "working" as const, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t });
const SNAPSHOT: Snapshot = {
  version: 1,
  generatedAt: t,
  panes: [
    { pane: "pane-1", label: "repo" },
    { pane: "pane-2", label: "docs" },
  ],
  sessions: [session("agent-1", "pane-1"), session("agent-2", "pane-2"), session("agent-3", "pane-1")],
};

describe("planWidgets", () => {
  it("wants one widget per pane in widget view, by label, in the snapshot's order", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "widgets" })).toEqual([
      { label: "repo", pane: "pane-1" },
      { label: "docs", pane: "pane-2" },
    ]);
  });

  it("wants none in window view", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "window" })).toEqual([]);
  });

  it("keeps the first of two panes that share a label, which core does not send", () => {
    const doubled = { ...SNAPSHOT, panes: [...SNAPSHOT.panes, { pane: "pane-3", label: "repo" }] };
    expect(planWidgets({ snapshot: doubled, view: "widgets" }).map((w) => w.pane)).toEqual(["pane-1", "pane-2"]);
  });
});

describe("paneSnapshot", () => {
  it("is the snapshot cut down to one pane and the sessions in it", () => {
    const one = paneSnapshot(SNAPSHOT, "pane-1");
    expect(one.panes).toEqual([{ pane: "pane-1", label: "repo" }]);
    expect(one.sessions.map((s) => s.alias)).toEqual(["agent-1", "agent-3"]);
    expect(one.generatedAt).toBe(SNAPSHOT.generatedAt);
  });
});

describe("emptied", () => {
  it("is the snapshot with nobody in it, which a page draws as everyone walking out", () => {
    expect(emptied(SNAPSHOT)).toEqual({ ...SNAPSHOT, panes: [], sessions: [] });
  });
});
```

Create `apps/desktop/src/widgets/menu.test.ts`:

```ts
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { widgetMenuTemplate } from "./menu";

const click = (item: MenuItemConstructorOptions | undefined): void => (item?.click as (() => void) | undefined)?.();

describe("widgetMenuTemplate", () => {
  it("is Pin on top as a checkbox, a separator, Open full window, then Settings", () => {
    const calls: string[] = [];
    const actions = { togglePin: () => void calls.push("pin"), openWindow: () => void calls.push("window"), settings: () => void calls.push("settings") };
    const menu = widgetMenuTemplate(true, actions);
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Pin on top", "separator", "Open full window", "Settings"]);
    expect(menu[0]).toMatchObject({ type: "checkbox", checked: true });
    expect(widgetMenuTemplate(false, actions)[0]).toMatchObject({ checked: false });
    click(menu[0]);
    click(menu[2]);
    click(menu[3]);
    expect(calls).toEqual(["pin", "window", "settings"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widgets/plan.test.ts src/widgets/menu.test.ts`
Expected: FAIL: cannot find `./plan` and `./menu`.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/widgets/plan.ts`:

```ts
// Which widget windows should exist for a snapshot, and what each is sent. Pure.
import type { Snapshot } from "@clawd/core";
import type { View } from "../desktop-state";

/** A window that should exist: keyed by the pane's label, which outlives an agent restart; its alias does not. */
export type WantedWidget = { label: string; pane: string };

/** One widget per pane in widget view. Core makes labels unique within a snapshot; were two ever alike, the first is kept. */
export function planWidgets(input: { snapshot: Snapshot; view: View }): WantedWidget[] {
  if (input.view !== "widgets") return [];
  const seen = new Set<string>();
  const wanted: WantedWidget[] = [];
  for (const p of input.snapshot.panes) {
    if (seen.has(p.label)) continue;
    seen.add(p.label);
    wanted.push({ label: p.label, pane: p.pane });
  }
  return wanted;
}

/** The snapshot cut down to one pane: what that pane's window is sent, and all it ever learns. */
export function paneSnapshot(s: Snapshot, pane: string): Snapshot {
  return { ...s, panes: s.panes.filter((p) => p.pane === pane), sessions: s.sessions.filter((session) => session.pane === pane) };
}

/** What a window is sent once its pane has left the snapshot: its Clawds walk out. */
export function emptied(s: Snapshot): Snapshot {
  return { ...s, panes: [], sessions: [] };
}
```

Create `apps/desktop/src/widgets/menu.ts`:

```ts
// A widget's context menu, as data. Main turns the template into a Menu and pops it on the widget's
// window. Nothing here loads Electron at run time (only its types are imported), so it is tested without it.
import type { MenuItemConstructorOptions } from "electron";

export type WidgetMenuActions = {
  togglePin(): void;
  openWindow(): void;
  settings(): void;
};

/** Pin on top, Open full window, Settings. */
export function widgetMenuTemplate(pinned: boolean, actions: WidgetMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: "Pin on top", type: "checkbox", checked: pinned, click: () => actions.togglePin() },
    { type: "separator" },
    { label: "Open full window", click: () => actions.openWindow() },
    { label: "Settings", click: () => actions.settings() },
  ];
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widgets/plan.test.ts src/widgets/menu.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/widgets/plan.ts apps/desktop/src/widgets/plan.test.ts apps/desktop/src/widgets/menu.ts apps/desktop/src/widgets/menu.test.ts
git commit -m "feat(desktop): which widgets should exist for a snapshot, the snapshot each is sent, and a widget's context menu, all as data"
```

---

### Task 9: The controller

**Files:**
- Create: `apps/desktop/src/widgets/controller.ts`, `apps/desktop/src/widgets/controller.test.ts`

**Interfaces:**
- Consumes: `Bounds`, `Placement`, `View` (Task 5); `WidgetSize`, `WidgetState` (Task 7); `DEFAULT_WIDGET_SIZE`, `placeWidget`, `clampDrop` (Task 7); `planWidgets`, `paneSnapshot`, `emptied`, `widgetMenuTemplate` (Task 8); the log code `desktop.widgetFailed` (Task 6).
- Produces:

```ts
export type WidgetWindow = {
  readonly id: number;                 // the id of the window's webContents: how a message's sender is matched to it
  bounds(): Bounds;
  setBounds(bounds: Bounds): void;
  setPinned(on: boolean): void;
  reveal(): void;                      // show, or bring above its neighbours, without the keyboard
  send(state: WidgetState): void;
  popupMenu(template: MenuItemConstructorOptions[]): void;
  close(): void;
  onFailed(cb: () => void): void;      // the page failed to load, or its renderer went
  onClosed(cb: () => void): void;      // the window is gone, whoever closed it
};
export type ControllerDeps = {
  createWindow(bounds: Bounds): WidgetWindow;
  cursor(): { x: number; y: number };
  workAreas(): Bounds[];
  primaryWorkArea(): Bounds;
  placement(label: string): Placement | undefined;
  savePlacement(label: string, placement: Placement): void;
  openSession(alias: string): void;
  openWindow(): void;
  openSettings(): void;
  log: Logger;
};
export type WidgetController = {
  setView(view: View): void;
  setSnapshot(s: Snapshot, source: string): void;
  noSource(): void;
  showAll(): number;
  closeAll(): void;
  ready(sender: number): WidgetState | null;
  resize(sender: number, size: WidgetSize | null): void;
  dragStart(sender: number): void;
  dragMove(sender: number): void;
  dragEnd(sender: number): void;
  togglePin(sender: number): void;
  select(sender: number, alias: string): void;
  menu(sender: number): void;
};
export const CLOSE_CAP_MS = 5_000;
export const MAX_TRIES = 3;
export function createWidgetController(deps: ControllerDeps): WidgetController;
```

The controller is the one stateful piece. It holds `label → window`, and everything a page may ask arrives with the sender's id and is ignored when no window has it.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/widgets/controller.test.ts`:

```ts
import type { LogFields } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import type { MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bounds, Placement } from "../desktop-state";
import type { WidgetState } from "../widget/state";
import { CLOSE_CAP_MS, MAX_TRIES, createWidgetController, type ControllerDeps, type WidgetWindow } from "./controller";
import { DEFAULT_WIDGET_SIZE, SLOT_GAP } from "./placement";

const AREA: Bounds = { x: 0, y: 0, width: 1920, height: 1040 };
const FIRST: Bounds = { x: AREA.width - DEFAULT_WIDGET_SIZE.width - SLOT_GAP, y: SLOT_GAP, ...DEFAULT_WIDGET_SIZE };
const SECOND: Bounds = { ...FIRST, y: FIRST.y + DEFAULT_WIDGET_SIZE.height + SLOT_GAP };

const at = (ms: number): string => new Date(ms).toISOString();

/** A snapshot from folder labels to the aliases of the sessions in each; panes are numbered in order. */
function snap(folders: Record<string, string[]>, generatedAt = at(0)): Snapshot {
  const labels = Object.keys(folders);
  return {
    version: 1,
    generatedAt,
    panes: labels.map((label, i) => ({ pane: `pane-${i + 1}`, label })),
    sessions: labels.flatMap((label, i) =>
      (folders[label] ?? []).map((alias) => ({ alias, label: alias, pane: `pane-${i + 1}`, state: "working" as const, activity: null, subagents: 0, contextPct: null, since: at(0), updatedAt: at(0) })),
    ),
  };
}
const TWO = snap({ repo: ["agent-1"], docs: ["agent-2"] });

type FakeWindow = { win: WidgetWindow; calls: string[]; sent: WidgetState[]; menus: MenuItemConstructorOptions[][]; fail(): void; closedByUser(): void };

function fakeWindow(id: number, initial: Bounds): FakeWindow {
  let bounds = initial;
  let failed: () => void = () => {};
  let closed: () => void = () => {};
  const calls: string[] = [];
  const sent: WidgetState[] = [];
  const menus: MenuItemConstructorOptions[][] = [];
  const win: WidgetWindow = {
    id,
    bounds: () => bounds,
    setBounds: (next) => {
      bounds = next;
      calls.push(`bounds ${next.x},${next.y} ${next.width}x${next.height}`);
    },
    setPinned: (on) => void calls.push(`pinned ${on}`),
    reveal: () => void calls.push("reveal"),
    send: (state) => void sent.push(state),
    popupMenu: (template) => void menus.push(template),
    close: () => {
      calls.push("close");
      closed();
    },
    onFailed: (cb) => {
      failed = cb;
    },
    onClosed: (cb) => {
      closed = cb;
    },
  };
  return { win, calls, sent, menus, fail: () => failed(), closedByUser: () => closed() };
}

function harness(over: Partial<ControllerDeps> = {}) {
  const windows: FakeWindow[] = [];
  const saved: Array<[string, Placement]> = [];
  const opened: string[] = [];
  const logged: Array<[string, LogFields]> = [];
  let cursor = { x: 0, y: 0 };
  const c = createWidgetController({
    createWindow: (bounds) => {
      const made = fakeWindow(100 + windows.length, bounds);
      windows.push(made);
      return made.win;
    },
    cursor: () => cursor,
    workAreas: () => [AREA],
    primaryWorkArea: () => AREA,
    placement: () => undefined,
    savePlacement: (label, placement) => void saved.push([label, placement]),
    openSession: (alias) => void opened.push(`session ${alias}`),
    openWindow: () => void opened.push("window"),
    openSettings: () => void opened.push("settings"),
    log: (code, fields = {}) => void logged.push([code, fields]),
    ...over,
  });
  /** The nth window made, which the test expects to exist. */
  const w = (n: number): FakeWindow => {
    const found = windows[n];
    if (found === undefined) throw new Error(`no window ${n}`);
    return found;
  };
  return { c, windows, w, saved, opened, logged, setCursor: (x: number, y: number) => (cursor = { x, y }) };
}

/** Widget view, two panes, both pages ready and shown. */
function shown(over: Partial<ControllerDeps> = {}) {
  const h = harness(over);
  h.c.setView("widgets");
  h.c.setSnapshot(TWO, "own:1");
  for (const made of h.windows) {
    h.c.ready(made.win.id);
    h.c.resize(made.win.id, DEFAULT_WIDGET_SIZE);
    made.calls.length = 0;
  }
  return h;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("which windows there are", () => {
  it("makes none in window view, and one per pane in widget view, each at the next free default slot", () => {
    const h = harness();
    h.c.setSnapshot(TWO, "own:1");
    expect(h.windows).toHaveLength(0);
    h.c.setView("widgets");
    expect(h.windows.map((made) => made.win.bounds())).toEqual([FIRST, SECOND]);
    // the same snapshot again makes nothing more
    h.c.setSnapshot(TWO, "own:1");
    expect(h.windows).toHaveLength(2);
  });

  it("puts a folder's widget back where it was left, pinned if it was", () => {
    const h = harness({ placement: (label) => (label === "repo" ? { x: 40, y: 60, pinned: true } : undefined) });
    h.c.setView("widgets");
    h.c.setSnapshot(TWO, "own:1");
    expect(h.w(0).win.bounds()).toEqual({ x: 40, y: 60, ...DEFAULT_WIDGET_SIZE });
    expect(h.w(0).calls).toContain("pinned true");
    expect(h.w(1).win.bounds()).toEqual(FIRST);
    expect(h.w(1).calls).not.toContain("pinned true");
  });

  it("closes every widget at once when the view goes back to the window", () => {
    const h = shown();
    h.c.setView("window");
    expect(h.windows.map((made) => made.calls)).toEqual([["close"], ["close"]]);
    // and a later snapshot makes none
    h.c.setSnapshot(TWO, "own:1");
    expect(h.windows).toHaveLength(2);
  });

  it("forgets a window the user closed, and makes it again for the next snapshot", () => {
    const h = shown();
    h.w(0).closedByUser();
    expect(h.c.ready(h.w(0).win.id)).toBeNull();
    h.c.setSnapshot(TWO, "own:1");
    expect(h.windows).toHaveLength(3);
  });
});

describe("what a window is sent", () => {
  it("answers a page's first question with its own pane's snapshot, sends nothing before it, and knows no stranger", () => {
    const h = harness();
    h.c.setView("widgets");
    h.c.setSnapshot(TWO, "own:1");
    expect(h.w(0).sent).toEqual([]);
    const state = h.c.ready(h.w(0).win.id);
    expect(state).toMatchObject({ generation: 1, pinned: false });
    expect(state?.snapshot?.panes).toEqual([{ pane: "pane-1", label: "repo" }]);
    expect(state?.snapshot?.sessions.map((s) => s.alias)).toEqual(["agent-1"]);
    expect(h.c.ready(999)).toBeNull();
  });

  it("sends a new state only when that window's own pane changed, the snapshot's time aside", () => {
    const h = shown();
    h.c.setSnapshot(snap({ repo: ["agent-1"], docs: ["agent-2"] }, at(60_000)), "own:1");
    expect(h.w(0).sent).toEqual([]);
    expect(h.w(1).sent).toEqual([]);
    h.c.setSnapshot(snap({ repo: ["agent-1", "agent-3"], docs: ["agent-2"] }), "own:1");
    expect(h.w(0).sent.map((s) => s.snapshot?.sessions.length)).toEqual([2]);
    expect(h.w(1).sent).toEqual([]);
  });

  it("raises the generation when snapshots start coming from another agent, keeps the windows, and says so even for the same sessions", () => {
    const h = shown();
    h.c.setSnapshot(TWO, "own:2");
    expect(h.windows).toHaveLength(2);
    expect(h.w(0).sent.map((s) => s.generation)).toEqual([2]);
    h.c.setSnapshot(TWO, "attached:4750");
    expect(h.w(0).sent.map((s) => s.generation)).toEqual([2, 3]);
  });
});

describe("a pane that leaves", () => {
  it("is sent an empty snapshot so its Clawds walk out, and its window closes when the page has nothing left to draw", () => {
    const h = shown();
    h.c.setSnapshot(snap({ docs: ["agent-2"] }), "own:1");
    expect(h.w(0).sent.at(-1)?.snapshot).toMatchObject({ panes: [], sessions: [] });
    expect(h.w(0).calls).toEqual([]);
    h.c.resize(h.w(0).win.id, null);
    expect(h.w(0).calls).toEqual(["close"]);
    // the pane that stayed is untouched, and a null size from it closes nothing: a page reports one when it clears its scene
    h.c.resize(h.w(1).win.id, null);
    expect(h.w(1).calls).toEqual([]);
  });

  it("closes the window after five seconds if the page never says", () => {
    const h = shown();
    h.c.setSnapshot(snap({}), "own:1");
    vi.advanceTimersByTime(CLOSE_CAP_MS - 1);
    expect(h.w(0).calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.windows.map((made) => made.calls)).toEqual([["close"], ["close"]]);
  });

  it("keeps the window of a pane that comes back inside the five seconds", () => {
    const h = shown();
    h.c.setSnapshot(snap({ docs: ["agent-2"] }), "own:1");
    vi.advanceTimersByTime(CLOSE_CAP_MS - 1);
    h.c.setSnapshot(TWO, "own:1");
    vi.advanceTimersByTime(CLOSE_CAP_MS);
    expect(h.w(0).calls).toEqual([]);
    expect(h.windows).toHaveLength(2);
    expect(h.w(0).sent.at(-1)?.snapshot?.sessions.map((s) => s.alias)).toEqual(["agent-1"]);
  });

  it("closes every widget after the cap once there is no agent to hear from", () => {
    const h = shown();
    h.c.noSource();
    expect(h.w(0).sent).toEqual([]);
    vi.advanceTimersByTime(CLOSE_CAP_MS);
    expect(h.windows.map((made) => made.calls)).toEqual([["close"], ["close"]]);
    // the next agent is a new source
    h.c.setSnapshot(TWO, "own:1");
    expect(h.windows).toHaveLength(4);
    expect(h.c.ready(h.w(2).win.id)).toMatchObject({ generation: 2 });
  });
});

describe("size and showing", () => {
  it("shows a window when its page first reports a size, sized from its top-left corner, and only once", () => {
    const h = harness();
    h.c.setView("widgets");
    h.c.setSnapshot(TWO, "own:1");
    const id = h.w(0).win.id;
    h.c.ready(id);
    expect(h.w(0).calls).toEqual([]);
    h.c.resize(id, { width: 346, height: 192 });
    expect(h.w(0).calls).toEqual([`bounds ${FIRST.x},${FIRST.y} 346x192`, "reveal"]);
    h.c.resize(id, { width: 346, height: 384 });
    expect(h.w(0).calls).toEqual([`bounds ${FIRST.x},${FIRST.y} 346x192`, "reveal", `bounds ${FIRST.x},${FIRST.y} 346x384`]);
    h.c.resize(999, { width: 1, height: 1 });
  });

  it("brings every widget already shown forward, and says how many windows there are", () => {
    const h = shown();
    expect(h.c.showAll()).toBe(2);
    expect(h.windows.map((made) => made.calls)).toEqual([["reveal"], ["reveal"]]);
    expect(harness().c.showAll()).toBe(0);
  });
});

describe("dragging", () => {
  it("moves the window with the cursor, keeping its size, and remembers where it was dropped", () => {
    const h = shown();
    const id = h.w(0).win.id;
    h.setCursor(FIRST.x + 16, FIRST.y + 28);
    h.c.dragStart(id);
    h.setCursor(1000, 500);
    h.c.dragMove(id);
    expect(h.w(0).calls).toEqual([`bounds 984,472 ${DEFAULT_WIDGET_SIZE.width}x${DEFAULT_WIDGET_SIZE.height}`]);
    h.c.dragEnd(id);
    expect(h.saved).toEqual([["repo", { x: 984, y: 472, pinned: false }]]);
    // a move after the release is nobody's
    h.c.dragMove(id);
    expect(h.w(0).calls).toHaveLength(1);
  });

  it("saves nothing for a press that never moved the window", () => {
    const h = shown();
    const id = h.w(0).win.id;
    h.setCursor(FIRST.x + 16, FIRST.y + 28);
    h.c.dragStart(id);
    h.c.dragMove(id);
    h.c.dragEnd(id);
    expect(h.w(0).calls).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it("pulls a widget dropped off every display back inside, and remembers that place", () => {
    const h = shown();
    const id = h.w(0).win.id;
    h.setCursor(FIRST.x, FIRST.y);
    h.c.dragStart(id);
    h.setCursor(5000, 300);
    h.c.dragMove(id);
    h.c.dragEnd(id);
    const edge = AREA.width - DEFAULT_WIDGET_SIZE.width;
    expect(h.w(0).win.bounds()).toEqual({ x: edge, y: 300, ...DEFAULT_WIDGET_SIZE });
    expect(h.saved).toEqual([["repo", { x: edge, y: 300, pinned: false }]]);
  });

  it("ignores a drag from a window it does not know", () => {
    const h = shown();
    h.c.dragStart(999);
    h.c.dragMove(999);
    h.c.dragEnd(999);
    expect(h.saved).toEqual([]);
  });
});

describe("the pin, the menu and a clicked Clawd", () => {
  it("pins and unpins, remembers it with the place the window is in, and tells the page", () => {
    const h = shown();
    const id = h.w(0).win.id;
    h.c.togglePin(id);
    expect(h.w(0).calls).toEqual(["pinned true"]);
    expect(h.saved).toEqual([["repo", { x: FIRST.x, y: FIRST.y, pinned: true }]]);
    expect(h.w(0).sent.at(-1)).toMatchObject({ pinned: true });
    h.c.togglePin(id);
    expect(h.w(0).calls).toEqual(["pinned true", "pinned false"]);
    expect(h.w(0).sent.at(-1)).toMatchObject({ pinned: false });
  });

  it("pops the menu on the window that asked, and its items do what they say", () => {
    const h = shown();
    h.c.menu(h.w(1).win.id);
    const menu = h.w(1).menus[0] ?? [];
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Pin on top", "separator", "Open full window", "Settings"]);
    expect(menu[0]).toMatchObject({ checked: false });
    (menu[0]?.click as () => void)();
    (menu[2]?.click as () => void)();
    (menu[3]?.click as () => void)();
    expect(h.w(1).calls).toEqual(["pinned true"]);
    expect(h.opened).toEqual(["window", "settings"]);
  });

  it("opens a clicked session only when it is one main sent that window", () => {
    const h = shown();
    h.c.select(h.w(0).win.id, "agent-1");
    h.c.select(h.w(0).win.id, "agent-2"); // the other pane's
    h.c.select(h.w(0).win.id, "agent-9");
    h.c.select(999, "agent-1");
    expect(h.opened).toEqual(["session agent-1"]);
  });
});

describe("a widget that fails", () => {
  it("is closed and logged with the count, made again by the next snapshot, and given up on after three", () => {
    const h = shown();
    for (let n = 1; n <= MAX_TRIES; n++) {
      h.w(h.windows.length - (n === 1 ? 2 : 1)).fail();
      h.c.setSnapshot(TWO, "own:1");
    }
    expect(h.logged).toEqual([
      ["desktop.widgetFailed", { tries: 1 }],
      ["desktop.widgetFailed", { tries: 2 }],
      ["desktop.widgetFailed", { tries: 3 }],
    ]);
    // two to begin with, and a replacement after the first and the second failure only
    expect(h.windows).toHaveLength(4);
    expect(h.logged.some(([, fields]) => Object.values(fields).some((value) => typeof value === "string"))).toBe(false);
  });
});

describe("closeAll", () => {
  it("closes every window and cancels what was waiting to", () => {
    const h = shown();
    h.c.setSnapshot(snap({}), "own:1");
    h.c.closeAll();
    expect(h.windows.map((made) => made.calls)).toEqual([["close"], ["close"]]);
    vi.advanceTimersByTime(CLOSE_CAP_MS);
    expect(h.windows.map((made) => made.calls)).toEqual([["close"], ["close"]]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widgets/controller.test.ts`
Expected: FAIL: cannot find `./controller`.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/widgets/controller.ts`:

```ts
// The widgets' controller: which windows exist, what each was last sent, where each is, and what a
// page may ask of main. One window per pane, keyed by the pane's label, which outlives an agent
// restart where its alias does not. Electron-free: main hands in a window factory, the cursor and
// the displays, so every rule here is tested over doubles.
import type { Logger } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import type { MenuItemConstructorOptions } from "electron";
import type { Bounds, Placement, View } from "../desktop-state";
import type { WidgetSize, WidgetState } from "../widget/state";
import { widgetMenuTemplate } from "./menu";
import { DEFAULT_WIDGET_SIZE, clampDrop, placeWidget } from "./placement";
import { emptied, paneSnapshot, planWidgets } from "./plan";

/** A widget's window, as much of it as the controller uses. `window.ts` fits a BrowserWindow to it. */
export type WidgetWindow = {
  /** The id of the window's webContents: how a message's sender is matched to its window. */
  readonly id: number;
  bounds(): Bounds;
  setBounds(bounds: Bounds): void;
  setPinned(on: boolean): void;
  /** Shows the window, or brings it above its neighbours, without giving it the keyboard. */
  reveal(): void;
  send(state: WidgetState): void;
  popupMenu(template: MenuItemConstructorOptions[]): void;
  close(): void;
  /** The page failed to load, or its renderer went. */
  onFailed(cb: () => void): void;
  /** The window is gone, whoever closed it. */
  onClosed(cb: () => void): void;
};

export type ControllerDeps = {
  createWindow(bounds: Bounds): WidgetWindow;
  /** Where the cursor is, in the units `setBounds` takes. */
  cursor(): { x: number; y: number };
  workAreas(): Bounds[];
  primaryWorkArea(): Bounds;
  placement(label: string): Placement | undefined;
  savePlacement(label: string, placement: Placement): void;
  /** A Clawd was clicked: the full window, on that session. */
  openSession(alias: string): void;
  openWindow(): void;
  openSettings(): void;
  log: Logger;
};

export type WidgetController = {
  setView(view: View): void;
  /** `source` names the agent the snapshot came from (`own:<run>`, `attached:<port>`); a new name is a new generation. */
  setSnapshot(s: Snapshot, source: string): void;
  /** There is no agent to hear from: what is shown is stale, and goes after the cap. */
  noSource(): void;
  /** Brings every widget already shown forward; answers how many windows there are. */
  showAll(): number;
  closeAll(): void;
  // What a page may ask, each with its sender's id. A sender no window has is ignored.
  ready(sender: number): WidgetState | null;
  resize(sender: number, size: WidgetSize | null): void;
  dragStart(sender: number): void;
  dragMove(sender: number): void;
  dragEnd(sender: number): void;
  togglePin(sender: number): void;
  select(sender: number, alias: string): void;
  menu(sender: number): void;
};

/** How long a window outlives its pane, for the walk out, when its page never says it has finished. */
export const CLOSE_CAP_MS = 5_000;
/** How often one label's widget may fail in a run of the app before it is left alone. */
export const MAX_TRIES = 3;

type Entry = {
  label: string;
  win: WidgetWindow;
  pane: string;
  size: WidgetSize;
  pinned: boolean;
  /** The page has asked for its state. Nothing is sent before that: it would arrive before the page listens. */
  ready: boolean;
  /** Shown once its page has reported a size, so it never appears empty or at the wrong size. */
  revealed: boolean;
  /** The snapshot the page was last given: what it draws, and the only aliases `select` accepts from it. */
  shown: Snapshot | null;
  /** The state last sent, as text, so a snapshot that changes nothing for this pane sends nothing. */
  sent: string;
  closing: ReturnType<typeof setTimeout> | null;
  drag: { dx: number; dy: number; moved: boolean } | null;
};

/** A state as text, less the time the snapshot was made, which changes with every snapshot and draws nothing. */
const keyOf = (state: WidgetState): string => JSON.stringify({ ...state, snapshot: state.snapshot === null ? null : { ...state.snapshot, generatedAt: "" } });

export function createWidgetController(deps: ControllerDeps): WidgetController {
  let view: View = "window";
  let snapshot: Snapshot | null = null;
  let source: string | null = null;
  let generation = 0;
  const entries = new Map<string, Entry>();
  const tries = new Map<string, number>();

  const bySender = (sender: number): Entry | undefined => {
    for (const e of entries.values()) if (e.win.id === sender) return e;
    return undefined;
  };

  const stateOf = (e: Entry): WidgetState => ({ snapshot: e.shown, generation, pinned: e.pinned });

  const push = (e: Entry): void => {
    if (!e.ready) return;
    const state = stateOf(e);
    const key = keyOf(state);
    if (key === e.sent) return;
    e.sent = key;
    e.win.send(state);
  };

  /** Forgets a window. Safe to call twice: closing one calls back here through onClosed. */
  const drop = (e: Entry): void => {
    if (e.closing !== null) clearTimeout(e.closing);
    e.closing = null;
    if (entries.get(e.label) === e) entries.delete(e.label);
  };

  const close = (e: Entry): void => {
    drop(e);
    e.win.close();
  };

  const open = (label: string, pane: string): Entry | undefined => {
    if ((tries.get(label) ?? 0) >= MAX_TRIES) return undefined;
    const remembered = deps.placement(label);
    const bounds = placeWidget({
      remembered,
      size: DEFAULT_WIDGET_SIZE,
      workAreas: deps.workAreas(),
      primary: deps.primaryWorkArea(),
      taken: [...entries.values()].map((other) => other.win.bounds()),
    });
    const win = deps.createWindow(bounds);
    const e: Entry = { label, win, pane, size: DEFAULT_WIDGET_SIZE, pinned: remembered?.pinned ?? false, ready: false, revealed: false, shown: null, sent: "", closing: null, drag: null };
    entries.set(label, e);
    if (e.pinned) win.setPinned(true);
    win.onFailed(() => {
      if (entries.get(label) !== e) return;
      const n = (tries.get(label) ?? 0) + 1;
      tries.set(label, n);
      deps.log("desktop.widgetFailed", { tries: n });
      close(e);
    });
    win.onClosed(() => drop(e));
    return e;
  };

  const reconcile = (): void => {
    const current = snapshot;
    const wanted = new Set<string>();
    if (current !== null) {
      for (const w of planWidgets({ snapshot: current, view })) {
        const e = entries.get(w.label) ?? open(w.label, w.pane);
        if (e === undefined) continue;
        wanted.add(w.label);
        if (e.closing !== null) clearTimeout(e.closing);
        e.closing = null;
        e.pane = w.pane;
        e.shown = paneSnapshot(current, w.pane);
        push(e);
      }
    }
    for (const e of [...entries.values()]) {
      if (wanted.has(e.label)) continue;
      // Its pane has left: the page plays the walk out and then says it has nothing left to draw.
      if (current !== null) {
        e.shown = emptied(current);
        push(e);
      }
      if (e.closing === null) e.closing = setTimeout(() => close(e), CLOSE_CAP_MS);
    }
  };

  const closeAll = (): void => {
    for (const e of [...entries.values()]) close(e);
  };

  const togglePin = (e: Entry): void => {
    e.pinned = !e.pinned;
    e.win.setPinned(e.pinned);
    // A pinned widget should be where it was pinned next time too, dragged or not.
    const b = e.win.bounds();
    deps.savePlacement(e.label, { x: b.x, y: b.y, pinned: e.pinned });
    push(e);
  };

  return {
    setView(next) {
      if (next === view) return;
      view = next;
      if (view === "window") closeAll();
      else reconcile();
    },
    setSnapshot(s, from) {
      if (from !== source) {
        source = from;
        generation++;
      }
      snapshot = s;
      reconcile();
    },
    noSource() {
      source = null;
      snapshot = null;
      reconcile();
    },
    showAll() {
      for (const e of entries.values()) if (e.revealed) e.win.reveal();
      return entries.size;
    },
    closeAll,
    ready(sender) {
      const e = bySender(sender);
      if (e === undefined) return null;
      const state = stateOf(e);
      e.ready = true;
      e.sent = keyOf(state);
      return state;
    },
    resize(sender, size) {
      const e = bySender(sender);
      if (e === undefined) return;
      if (size === null) {
        // Nothing left to draw. Only a window whose pane has left is waiting for that; a page also says it when it clears its scene.
        if (e.closing !== null) close(e);
        return;
      }
      e.size = size;
      const b = e.win.bounds();
      e.win.setBounds({ x: b.x, y: b.y, ...size });
      if (e.revealed) return;
      e.revealed = true;
      e.win.reveal();
    },
    dragStart(sender) {
      const e = bySender(sender);
      if (e === undefined) return;
      const at = deps.cursor();
      const b = e.win.bounds();
      e.drag = { dx: at.x - b.x, dy: at.y - b.y, moved: false };
    },
    dragMove(sender) {
      const e = bySender(sender);
      if (e === undefined || e.drag === null) return;
      const at = deps.cursor();
      const x = at.x - e.drag.dx;
      const y = at.y - e.drag.dy;
      const b = e.win.bounds();
      if (x === b.x && y === b.y) return;
      e.drag.moved = true;
      // The size goes with every move: a position alone lets the window's size drift on a scaled display.
      e.win.setBounds({ x, y, ...e.size });
    },
    dragEnd(sender) {
      const e = bySender(sender);
      if (e === undefined || e.drag === null) return;
      const moved = e.drag.moved;
      e.drag = null;
      if (!moved) return;
      const b = e.win.bounds();
      const kept = clampDrop({ x: b.x, y: b.y, ...e.size }, deps.workAreas());
      if (kept.x !== b.x || kept.y !== b.y) e.win.setBounds(kept);
      deps.savePlacement(e.label, { x: kept.x, y: kept.y, pinned: e.pinned });
    },
    togglePin(sender) {
      const e = bySender(sender);
      if (e !== undefined) togglePin(e);
    },
    select(sender, alias) {
      const e = bySender(sender);
      // Only an alias main itself sent this window.
      if (e?.shown?.sessions.some((session) => session.alias === alias)) deps.openSession(alias);
    },
    menu(sender) {
      const e = bySender(sender);
      if (e === undefined) return;
      e.win.popupMenu(widgetMenuTemplate(e.pinned, { togglePin: () => togglePin(e), openWindow: deps.openWindow, settings: deps.openSettings }));
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widgets/controller.test.ts && npx tsc --noEmit`
Expected: PASS, 22 tests.

If the failure test's window count surprises you, read it against the rule rather than changing the rule: a failed window is replaced by the next snapshot while its label has failed fewer than `MAX_TRIES` times, so two replacements are made and the third failure is the last.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/widgets/controller.ts apps/desktop/src/widgets/controller.test.ts
git commit -m "feat(desktop): the widgets' controller keeps one window per pane by label, sends each only its own pane, moves, pins and closes them, and trusts a page only by its sender"
```

---

### Task 10: The widget's bridge

**Files:**
- Create: `apps/desktop/src/widget/channels.ts`
- Create: `apps/desktop/src/widget/ipc.ts`, `apps/desktop/src/widget/ipc.test.ts`
- Create: `apps/desktop/src/widget/preload.ts`

**Interfaces:**
- Consumes: `WidgetApi`, `WidgetState`, `WidgetSize` (Task 7); `WidgetController` (Task 9).
- Produces: `WIDGET_CHANNELS` (`ready`, `resize`, `dragStart`, `dragMove`, `dragEnd`, `togglePin`, `select`, `menu`, `state`); `type WidgetCalls = Pick<WidgetController, "ready" | "resize" | "dragStart" | "dragMove" | "dragEnd" | "togglePin" | "select" | "menu">`; `type WidgetHandlers = { invoke: Record<string, (sender: number, raw: unknown) => unknown>; on: Record<string, (sender: number, raw: unknown) => void> }`; `createWidgetHandlers(calls: WidgetCalls): WidgetHandlers`. The preload publishes `window.clawdWidget`.

**The Electron idea:** `invoke` and `handle` are a question and its answer; `send` and `on` are a message with none. The settings bridge is all `invoke` because every call answers with the state. A widget's calls are mostly one-way, and a drag sends one per frame, so only `ready` is an `invoke`. No handler may throw: an exception nothing catches in main is handed to the agent host, which restarts the agent.

- [ ] **Step 1: Write the channel names**

Create `apps/desktop/src/widget/channels.ts`:

```ts
// The widget bridge's channel names, in a file that imports nothing: the preload needs only these,
// and it is parsed before every widget page. Every widget window shares them; main tells the
// windows apart by the sender.
export const WIDGET_CHANNELS = {
  /** The one call with an answer: the page asks for its state once its scene is mounted. */
  ready: "clawd:widget/ready",
  resize: "clawd:widget/resize",
  dragStart: "clawd:widget/dragStart",
  dragMove: "clawd:widget/dragMove",
  dragEnd: "clawd:widget/dragEnd",
  togglePin: "clawd:widget/togglePin",
  select: "clawd:widget/select",
  menu: "clawd:widget/menu",
  /** Main to the page: the state changed. */
  state: "clawd:widget/state",
} as const;
```

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/src/widget/ipc.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WIDGET_CHANNELS as C } from "./channels";
import { createWidgetHandlers, type WidgetCalls } from "./ipc";
import type { WidgetState } from "./state";

const STATE: WidgetState = { snapshot: null, generation: 1, pinned: false };

function harness(over: Partial<WidgetCalls> = {}) {
  const calls: string[] = [];
  const base: WidgetCalls = {
    ready: (sender) => {
      calls.push(`ready ${sender}`);
      return STATE;
    },
    resize: (sender, size) => void calls.push(`resize ${sender} ${size === null ? "null" : `${size.width}x${size.height}`}`),
    dragStart: (sender) => void calls.push(`dragStart ${sender}`),
    dragMove: (sender) => void calls.push(`dragMove ${sender}`),
    dragEnd: (sender) => void calls.push(`dragEnd ${sender}`),
    togglePin: (sender) => void calls.push(`togglePin ${sender}`),
    select: (sender, alias) => void calls.push(`select ${sender} ${alias}`),
    menu: (sender) => void calls.push(`menu ${sender}`),
    ...over,
  };
  return { calls, handlers: createWidgetHandlers(base) };
}

describe("createWidgetHandlers", () => {
  it("has one handler per channel the page can send on, the answered one apart from the rest", () => {
    const { handlers } = harness();
    expect(Object.keys(handlers.invoke)).toEqual([C.ready]);
    expect(Object.keys(handlers.on).sort()).toEqual([C.dragEnd, C.dragMove, C.dragStart, C.menu, C.resize, C.select, C.togglePin].sort());
  });

  it("passes each call on with the sender's id", () => {
    const { calls, handlers } = harness();
    expect(handlers.invoke[C.ready]?.(7, undefined)).toEqual(STATE);
    handlers.on[C.resize]?.(7, { width: 346, height: 192 });
    handlers.on[C.resize]?.(7, null);
    handlers.on[C.dragStart]?.(7, undefined);
    handlers.on[C.dragMove]?.(7, undefined);
    handlers.on[C.dragEnd]?.(7, undefined);
    handlers.on[C.togglePin]?.(7, undefined);
    handlers.on[C.select]?.(7, "agent-3");
    handlers.on[C.menu]?.(7, undefined);
    expect(calls).toEqual(["ready 7", "resize 7 346x192", "resize 7 null", "dragStart 7", "dragMove 7", "dragEnd 7", "togglePin 7", "select 7 agent-3", "menu 7"]);
  });

  it("drops a size that is not two whole numbers from 1 to 4096 and nothing else, and an alias that is not a short string", () => {
    const { calls, handlers } = harness();
    for (const size of [undefined, "big", {}, { width: 346 }, { width: 346.5, height: 192 }, { width: 0, height: 192 }, { width: 5000, height: 192 }, { width: 346, height: 192, x: 0 }]) {
      handlers.on[C.resize]?.(7, size);
    }
    for (const alias of [undefined, "", 3, { alias: "agent-3" }, "a".repeat(201)]) handlers.on[C.select]?.(7, alias);
    expect(calls).toEqual([]);
  });

  it("never throws, whatever the controller does: an exception nothing catches in main restarts the agent", () => {
    const boom = (): never => {
      throw new Error("boom");
    };
    const { handlers } = harness({ ready: boom, resize: boom, dragStart: boom, dragMove: boom, dragEnd: boom, togglePin: boom, select: boom, menu: boom });
    expect(handlers.invoke[C.ready]?.(7, undefined)).toBeNull();
    for (const [channel, handler] of Object.entries(handlers.on)) {
      expect(() => handler(7, channel === C.resize ? { width: 1, height: 1 } : "agent-1"), channel).not.toThrow();
    }
  });
});

describe("the widget bridge's files", () => {
  const read = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");

  it("keeps the preload free of everything but the channel names and the types", async () => {
    const preload = await read("./preload.ts");
    // `\r?` because a Windows checkout may hold CRLF line endings.
    const imports = [...preload.matchAll(/^import (type )?.* from "([^"]+)";\r?$/gm)].map((match) => `${match[1] ?? ""}${match[2] ?? ""}`);
    expect(imports).toEqual(["electron", "./channels", "type ./state"]);
    expect(await read("./channels.ts")).not.toMatch(/^\s*import\s/m);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widget/ipc.test.ts`
Expected: FAIL: cannot find `./ipc`.

- [ ] **Step 4: Implement the handlers and the preload**

Create `apps/desktop/src/widget/ipc.ts`:

```ts
// The widget bridge's messages, on main's side. Every widget window sends on the same channels, so
// each handler is given the sender's id and the controller finds the window by it. Every argument is
// validated, and no handler throws. Electron-free and tested over a fake controller; main hands the
// handlers to ipcMain.
import { z } from "zod";
import type { WidgetController } from "../widgets/controller";
import { WIDGET_CHANNELS } from "./channels";

/** What a page may ask of the controller. */
export type WidgetCalls = Pick<WidgetController, "ready" | "resize" | "dragStart" | "dragMove" | "dragEnd" | "togglePin" | "select" | "menu">;

export type WidgetHandlers = {
  /** For `ipcMain.handle`: the one call with an answer. */
  invoke: Record<string, (sender: number, raw: unknown) => unknown>;
  /** For `ipcMain.on`: messages with none. */
  on: Record<string, (sender: number, raw: unknown) => void>;
};

/** CSS pixels. 4096 is far past any pane; the floor keeps a zero or negative size from reaching setBounds. */
const Size = z
  .object({ width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096) })
  .strict()
  .nullable();
const Alias = z.string().min(1).max(200);

export function createWidgetHandlers(calls: WidgetCalls): WidgetHandlers {
  // An exception nothing catches in main is handed to the agent host, which restarts the agent. A
  // page must never be able to cause that, so nothing escapes a handler.
  const quiet =
    (run: (sender: number, raw: unknown) => void) =>
    (sender: number, raw: unknown): void => {
      try {
        run(sender, raw);
      } catch {
        // The message is dropped.
      }
    };
  return {
    invoke: {
      [WIDGET_CHANNELS.ready]: (sender) => {
        try {
          return calls.ready(sender);
        } catch {
          return null;
        }
      },
    },
    on: {
      [WIDGET_CHANNELS.resize]: quiet((sender, raw) => {
        const size = Size.safeParse(raw);
        if (size.success) calls.resize(sender, size.data);
      }),
      [WIDGET_CHANNELS.dragStart]: quiet((sender) => calls.dragStart(sender)),
      [WIDGET_CHANNELS.dragMove]: quiet((sender) => calls.dragMove(sender)),
      [WIDGET_CHANNELS.dragEnd]: quiet((sender) => calls.dragEnd(sender)),
      [WIDGET_CHANNELS.togglePin]: quiet((sender) => calls.togglePin(sender)),
      [WIDGET_CHANNELS.select]: quiet((sender, raw) => {
        const alias = Alias.safeParse(raw);
        if (alias.success) calls.select(sender, alias.data);
      }),
      [WIDGET_CHANNELS.menu]: quiet((sender) => calls.menu(sender)),
    },
  };
}
```

Create `apps/desktop/src/widget/preload.ts`:

```ts
// Runs before a widget page, in its own world. `contextBridge` publishes exactly these functions on
// window.clawdWidget; the page has no other way out, and is allowed no network at all. `invoke` is a
// question with an answer; `send` is a message with none, which is what most of these are.
import { contextBridge, ipcRenderer } from "electron";
import { WIDGET_CHANNELS } from "./channels";
import type { WidgetApi, WidgetSize, WidgetState } from "./state";

contextBridge.exposeInMainWorld("clawdWidget", {
  ready: () => ipcRenderer.invoke(WIDGET_CHANNELS.ready) as Promise<WidgetState | null>,
  onState: (cb: (s: WidgetState) => void) => {
    const listener = (_event: unknown, state: WidgetState): void => cb(state);
    ipcRenderer.on(WIDGET_CHANNELS.state, listener);
    return () => void ipcRenderer.off(WIDGET_CHANNELS.state, listener);
  },
  resize: (size: WidgetSize | null) => ipcRenderer.send(WIDGET_CHANNELS.resize, size),
  dragStart: () => ipcRenderer.send(WIDGET_CHANNELS.dragStart),
  dragMove: () => ipcRenderer.send(WIDGET_CHANNELS.dragMove),
  dragEnd: () => ipcRenderer.send(WIDGET_CHANNELS.dragEnd),
  togglePin: () => ipcRenderer.send(WIDGET_CHANNELS.togglePin),
  select: (alias: string) => ipcRenderer.send(WIDGET_CHANNELS.select, alias),
  menu: () => ipcRenderer.send(WIDGET_CHANNELS.menu),
} satisfies WidgetApi);
```

- [ ] **Step 5: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widget/ipc.test.ts && npx tsc --noEmit`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/widget/channels.ts apps/desktop/src/widget/ipc.ts apps/desktop/src/widget/ipc.test.ts apps/desktop/src/widget/preload.ts
git commit -m "feat(desktop): the widget bridge: one answered call and seven one-way messages, every argument validated, every handler given its sender, and none able to throw"
```

---

### Task 11: The widget page

**Files:**
- Create: `apps/desktop/src/widget/page.html`, `apps/desktop/src/widget/page.css`, `apps/desktop/src/widget/page.ts`, `apps/desktop/src/widget/page.test.ts`
- Modify: `apps/desktop/tsconfig.json`, `apps/desktop/tsconfig.page.json`, `apps/desktop/tsconfig.page-test.json`
- Modify: `apps/desktop/build/bundle.mjs`

**Interfaces:**
- Consumes: `mountPanesScene` with the widget options and `setSnapshot(s, { seated })` (Task 3); `WidgetApi`, `WidgetState` (Task 7); the preload's `window.clawdWidget` (Task 10).
- Produces: `dist/widget/index.html`, `page.css`, `page.js`, `preload.js` and the two fonts with their licence. Nothing imports the page.

The page decides four things, and they are what its tests pin: the first snapshot after a mount or a clear seats its sessions at once; a new generation clears the scene; a press that moves less than four pixels on the screen is a click, and sends no `dragMove`; one that moves further is a drag, with at most one `dragMove` per frame. It measures the press in screen coordinates because the window follows the cursor, so the pointer barely moves in the page's own.

The page's own click handling replaces the scene's: `onSelect` is not passed, since the browser fires `click` after a drag too.

- [ ] **Step 1: The markup and the stylesheet**

Create `apps/desktop/src/widget/page.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Clawd widget</title>
    <link rel="stylesheet" href="page.css" />
  </head>
  <body>
    <canvas id="scene" role="img" aria-label="The Claude sessions in this folder"></canvas>
    <!-- A real button, so the keyboard and a screen reader reach it. It shows while the pointer is
         over the widget or it has the focus, and always while it is pressed. -->
    <button id="pin" type="button" aria-pressed="false" aria-label="Pin on top"></button>
    <script src="page.js"></script>
  </body>
</html>
```

Create `apps/desktop/src/widget/page.css`:

```css
/* A widget: one canvas filling a frameless, transparent window. What the canvas does not paint is
   the desktop. The two font files are copied beside this page by build/bundle.mjs: this origin may
   load only its own files. No text in the page uses the face, so page.ts loads it by hand before
   the canvas draws with it. */
@font-face { font-family: "JetBrains Mono"; font-style: normal; font-weight: 400; font-display: block; src: url("jetbrains-mono-400.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-style: normal; font-weight: 700; font-display: block; src: url("jetbrains-mono-700.woff2") format("woff2"); }
:root { --bg: #0a0b10; --dim: #5d6274; --amber: #f2c35b; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; user-select: none; }
body { font: 11px "JetBrains Mono", Consolas, monospace; }
#scene { position: absolute; inset: 0; display: block; width: 100%; height: 100%; image-rendering: pixelated; touch-action: none; }
/* The pin sits on the title row, which is the box's top border, left of where the collision mark
   goes. Its background is the night colour so the border does not run through it. Positions are in
   CSS pixels for a 6 px cell; at 125% a cell is 6.4 px and the pin sits a pixel or two off. */
#pin { position: absolute; top: 3px; right: 44px; width: 12px; height: 12px; padding: 0; border: 2px solid var(--dim); border-radius: 0; background: var(--bg); cursor: pointer; opacity: 0; }
body:hover #pin, #pin:focus-visible, #pin[aria-pressed="true"] { opacity: 1; }
#pin:hover { border-color: var(--amber); }
#pin[aria-pressed="true"] { border-color: var(--amber); background: var(--amber); }
#pin:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
```

- [ ] **Step 2: Give the page its type-check projects**

`apps/desktop/tsconfig.json`: the page and its test are browser code, so leave them out of the Node project:

```json
  "exclude": ["src/settings/page.ts", "src/settings/page.test.ts", "src/widget/page.ts", "src/widget/page.test.ts"]
```

`apps/desktop/tsconfig.page.json`:

```json
  "include": ["src/settings/page.ts", "src/widget/page.ts"],
```

`apps/desktop/tsconfig.page-test.json`:

```json
  "include": ["src/settings/page.test.ts", "src/widget/page.test.ts"],
```

- [ ] **Step 3: Write the failing tests**

Create `apps/desktop/src/widget/page.test.ts`:

```ts
// @vitest-environment happy-dom
import type { PanesScene, PanesSceneOptions } from "@clawd/scene";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { WidgetApi, WidgetState } from "./state";

const here = dirname(fileURLToPath(import.meta.url));
// The real markup, less the script tag: the test imports the page's module itself.
const html = await readFile(join(here, "page.html"), "utf8");
const BODY = (/<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "").replace(/<script[^>]*><\/script>/g, "");

const t = new Date(0).toISOString();
const session = (alias: string) => ({ alias, label: alias, pane: "pane-1", state: "working" as const, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t });
const snapshotOf = (...aliases: string[]): NonNullable<WidgetState["snapshot"]> => ({ version: 1, generatedAt: t, panes: [{ pane: "pane-1", label: "repo" }], sessions: aliases.map(session) });
const STATE: WidgetState = { snapshot: snapshotOf("agent-1"), generation: 1, pinned: false };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Loads a fresh copy of the page over a stub bridge and a stub scene, and waits for its first draw. */
async function load(initial: WidgetState | null = STATE, hit: string | null = null) {
  vi.resetModules();
  document.body.innerHTML = BODY;
  const calls: string[] = [];
  const drawn: string[] = [];
  const mounted: { options?: PanesSceneOptions } = {};
  const scene: PanesScene = {
    setSnapshot: (s, o) => void drawn.push(`snapshot ${s.sessions.length} seated=${o?.seated === true}`),
    clear: () => void drawn.push("clear"),
    resize: () => {},
    setPaused: () => {},
    hitTest: () => hit,
    destroy: () => {},
  };
  // The real scene runs a frame loop; the page's decisions are what is under test here.
  vi.doMock("@clawd/scene", () => ({
    mountPanesScene: (_canvas: unknown, options: PanesSceneOptions) => {
      mounted.options = options;
      return scene;
    },
  }));
  const frames: Array<() => void> = [];
  (window as unknown as { requestAnimationFrame: (fn: FrameRequestCallback) => number }).requestAnimationFrame = (fn) => frames.push(() => fn(0));
  const listeners: Array<(s: WidgetState) => void> = [];
  const api: WidgetApi = {
    ready: async () => initial,
    onState: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    resize: (size) => void calls.push(size === null ? "resize null" : `resize ${size.width}x${size.height}`),
    dragStart: () => void calls.push("dragStart"),
    dragMove: () => void calls.push("dragMove"),
    dragEnd: () => void calls.push("dragEnd"),
    togglePin: () => void calls.push("togglePin"),
    select: (alias) => void calls.push(`select ${alias}`),
    menu: () => void calls.push("menu"),
  };
  (window as unknown as { clawdWidget: WidgetApi }).clawdWidget = api;
  await import("./page");
  await flush();
  const canvas = document.getElementById("scene") as HTMLElement;
  const pin = document.getElementById("pin") as HTMLElement;
  return {
    calls,
    drawn,
    mounted,
    canvas,
    pin,
    push: (state: WidgetState): void => listeners.forEach((cb) => cb(state)),
    frame: (): void => frames.splice(0).forEach((run) => run()),
  };
}

/** A pointer event as the page reads one: the button, where it is on the screen and in the page, and whose it is. */
function pointer(type: string, init: { button?: number; screenX?: number; screenY?: number; clientX?: number; clientY?: number } = {}): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("the widget page", () => {
  it("mounts the scene as a widget, without the scene's own click handling, and only then asks for its state", async () => {
    const page = await load();
    expect(page.mounted.options).toMatchObject({ background: "none", clipActors: true, emptyState: false, margin: 1 });
    expect(page.mounted.options?.onSelect).toBeUndefined();
    expect(page.drawn).toEqual(["snapshot 1 seated=true"]);
  });

  it("seats the sessions of its first snapshot at once, and walks later arrivals in", async () => {
    const page = await load();
    page.push({ ...STATE, snapshot: snapshotOf("agent-1", "agent-2") });
    expect(page.drawn).toEqual(["snapshot 1 seated=true", "snapshot 2 seated=false"]);
  });

  it("clears the scene when the generation changes, and seats that snapshot's sessions at once too", async () => {
    const page = await load();
    page.push({ ...STATE, generation: 2 });
    expect(page.drawn).toEqual(["snapshot 1 seated=true", "clear", "snapshot 1 seated=true"]);
  });

  it("draws nothing for a window main does not know, and waits for a snapshot when the first state has none", async () => {
    expect((await load(null)).drawn).toEqual([]);
    const page = await load({ ...STATE, snapshot: null });
    expect(page.drawn).toEqual([]);
    page.push(STATE);
    expect(page.drawn).toEqual(["snapshot 1 seated=true"]);
  });

  it("tells main the size the scene needs, and when nothing is left to draw", async () => {
    const page = await load();
    page.mounted.options?.onContentSize?.({ width: 346, height: 192 });
    page.mounted.options?.onContentSize?.(null);
    expect(page.calls).toEqual(["resize 346x192", "resize null"]);
  });

  it("treats a press that barely moves as a click: no move is sent, and a Clawd under it is selected", async () => {
    const page = await load(STATE, "agent-1");
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300, clientX: 60, clientY: 70 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 502, screenY: 302 }));
    page.frame();
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 502, screenY: 302, clientX: 62, clientY: 72 }));
    expect(page.calls).toEqual(["dragStart", "dragEnd", "select agent-1"]);
  });

  it("selects nothing when the click was not on a Clawd", async () => {
    const page = await load(STATE, null);
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 500, screenY: 300 }));
    expect(page.calls).toEqual(["dragStart", "dragEnd"]);
  });

  it("treats a press that moves four pixels as a drag: one move per frame, and no selection at the end", async () => {
    const page = await load(STATE, "agent-1");
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 504, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 520, screenY: 310 }));
    expect(page.calls).toEqual(["dragStart"]);
    page.frame();
    expect(page.calls).toEqual(["dragStart", "dragMove"]);
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 540, screenY: 320 }));
    page.frame();
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 540, screenY: 320 }));
    expect(page.calls).toEqual(["dragStart", "dragMove", "dragMove", "dragEnd"]);
  });

  it("ends a press that is cancelled, or that the window loses, without selecting anything, and sends no move after it", async () => {
    const page = await load(STATE, "agent-1");
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 600, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointercancel"));
    page.frame();
    expect(page.calls).toEqual(["dragStart", "dragEnd"]);
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    window.dispatchEvent(new Event("blur"));
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 500, screenY: 300 }));
    expect(page.calls).toEqual(["dragStart", "dragEnd", "dragStart", "dragEnd"]);
  });

  it("starts no drag with the right button, and asks main for the menu in place of the browser's", async () => {
    const page = await load();
    page.canvas.dispatchEvent(pointer("pointerdown", { button: 2, screenX: 500, screenY: 300 }));
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    page.canvas.dispatchEvent(menu);
    expect(page.calls).toEqual(["menu"]);
    expect(menu.defaultPrevented).toBe(true);
  });

  it("shows whether it is pinned on a real button, and asks main to change it", async () => {
    const page = await load();
    expect(page.pin.tagName).toBe("BUTTON");
    expect(page.pin.getAttribute("aria-pressed")).toBe("false");
    page.push({ ...STATE, pinned: true });
    expect(page.pin.getAttribute("aria-pressed")).toBe("true");
    page.pin.click();
    expect(page.calls).toEqual(["togglePin"]);
  });
});

describe("the widget page's files", () => {
  it("loads only fonts the bundle step copies beside the page", async () => {
    const css = await readFile(join(here, "page.css"), "utf8");
    const bundle = await readFile(join(here, "../../build/bundle.mjs"), "utf8");
    const fonts = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((match) => match[1] ?? "");
    expect(fonts).toEqual(["jetbrains-mono-400.woff2", "jetbrains-mono-700.woff2"]);
    for (const font of fonts) expect(bundle, font).toContain(`dist/widget/${font}`);
    for (const file of ["index.html", "page.css", "page.js", "preload.js"]) expect(bundle, file).toContain(`dist/widget/${file}`);
  });
});
```

- [ ] **Step 4: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widget/page.test.ts`
Expected: FAIL: cannot find `./page`.

- [ ] **Step 5: Implement the page**

Create `apps/desktop/src/widget/page.ts`:

```ts
// A widget: one pane of the scene in a frameless, transparent window. It draws the snapshot main
// sends and nothing else; it opens no connection and does not know which pane it is. With no title
// bar there is nothing for Windows to drag, and CSS `-webkit-app-region: drag` would swallow every
// click in the region, so the page reports a press and main moves the window.
import { mountPanesScene, type PanesScene } from "@clawd/scene";
import type { WidgetApi, WidgetState } from "./state";

declare const window: { clawdWidget: WidgetApi } & Window;

/** A press that moves less than this, measured on the screen, is a click. The window follows the cursor, so in the page's own coordinates a drag barely moves at all. */
const CLICK_SLOP = 4;
const FACE = '"JetBrains Mono"';

/** Runs `onChange` whenever the display's scale changes, as it does when the window is dragged to another display: the CSS size stays the same then, so no resize event says so. */
function watchRatio(onChange: () => void): void {
  if (typeof matchMedia !== "function") return;
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    "change",
    () => {
      onChange();
      watchRatio(onChange);
    },
    { once: true },
  );
}

function start(canvas: HTMLCanvasElement, pin: HTMLElement): void {
  const api = window.clawdWidget;
  let scene: PanesScene | null = null;
  let generation: number | null = null;
  /** The next snapshot is the first since the scene was mounted or cleared: its sessions were already there, so they do not walk in. */
  let fresh = true;

  const draw = (state: WidgetState): void => {
    pin.setAttribute("aria-pressed", String(state.pinned));
    if (scene === null) return;
    if (generation !== null && state.generation !== generation) {
      // Snapshots now come from another agent: nothing on screen is known to it.
      scene.clear();
      fresh = true;
    }
    generation = state.generation;
    if (state.snapshot === null) return;
    scene.setSnapshot(state.snapshot, { seated: fresh });
    fresh = false;
  };

  const mount = (): void => {
    const family = getComputedStyle(canvas).fontFamily;
    const mounted = mountPanesScene(canvas, {
      ...(family === "" ? {} : { font: family }),
      background: "none",
      clipActors: true,
      emptyState: false,
      margin: 1,
      onContentSize: (size) => api.resize(size),
    });
    scene = mounted;
    const fit = (): void => mounted.resize(document.documentElement.clientWidth, document.documentElement.clientHeight);
    fit();
    window.addEventListener("resize", fit);
    watchRatio(fit);
    // Only now: main sends nothing before it is asked, so no state arrives with no scene to draw it.
    api.onState(draw);
    void api.ready().then(
      (state) => {
        if (state !== null) draw(state);
      },
      () => {},
    );
  };

  // No text in the page uses the face, so nothing would load it; the canvas would then draw its first frames in the fallback.
  const faces = typeof document.fonts?.load === "function" ? Promise.all([document.fonts.load(`11px ${FACE}`), document.fonts.load(`bold 11px ${FACE}`)]) : Promise.resolve();
  void faces.then(mount, mount);

  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  let moveQueued = false;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || press !== null) return;
    press = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false };
    // Captured, so the release reaches the canvas wherever the pointer has got to by then.
    canvas.setPointerCapture?.(e.pointerId);
    api.dragStart();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (press === null || e.pointerId !== press.id) return;
    if (!press.moved && Math.hypot(e.screenX - press.x, e.screenY - press.y) < CLICK_SLOP) return;
    press.moved = true;
    if (moveQueued) return;
    moveQueued = true;
    // One per frame. No coordinates: main reads the cursor itself, in the units it moves the window in.
    requestAnimationFrame(() => {
      moveQueued = false;
      if (press !== null) api.dragMove();
    });
  });

  const release = (e: PointerEvent, click: boolean): void => {
    if (press === null || e.pointerId !== press.id) return;
    const moved = press.moved;
    press = null;
    api.dragEnd();
    if (!click || moved) return;
    const box = canvas.getBoundingClientRect();
    const alias = scene?.hitTest(e.clientX - box.left, e.clientY - box.top) ?? null;
    if (alias !== null) api.select(alias);
  };
  canvas.addEventListener("pointerup", (e) => release(e, true));
  canvas.addEventListener("pointercancel", (e) => release(e, false));
  // A press the window loses (Alt+Tab mid-drag) has no release of its own.
  window.addEventListener("blur", () => {
    if (press === null) return;
    press = null;
    api.dragEnd();
  });

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    api.menu();
  });
  pin.addEventListener("click", () => api.togglePin());
}

const canvas = document.getElementById("scene");
const pin = document.getElementById("pin");
if (canvas instanceof HTMLCanvasElement && pin !== null) start(canvas, pin);
```

- [ ] **Step 6: Run the tests**

Run from `apps/desktop`: `npx vitest run src/widget/page.test.ts`
Expected: every page test passes; the last test, `loads only fonts the bundle step copies beside the page`, still FAILS, because the bundle step does not know the widget yet.

If a pointer test fails because happy-dom's `MouseEvent` ignores `screenX` or `clientX` in its init, give `pointer()` the same treatment as `pointerId`: define those properties on the event with `Object.defineProperty`. Change the helper, not the page.

- [ ] **Step 7: Bundle the page**

In `apps/desktop/build/bundle.mjs`, after the settings page's font lines and before the comment that begins `// The preload is parsed before every settings page`, add:

```js
// The widget page and its preload, built like the settings page's. The page bundles the scene.
await build({
  entryPoints: [here("../src/widget/preload.ts")],
  outfile: here("../dist/widget/preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});
await build({
  entryPoints: [here("../src/widget/page.ts")],
  outfile: here("../dist/widget/page.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome130",
  sourcemap: true,
  logLevel: "info",
});
await cp(here("../src/widget/page.html"), here("../dist/widget/index.html"));
await cp(here("../src/widget/page.css"), here("../dist/widget/page.css"));
await cp(font("files/jetbrains-mono-latin-400-normal.woff2"), here("../dist/widget/jetbrains-mono-400.woff2"));
await cp(font("files/jetbrains-mono-latin-700-normal.woff2"), here("../dist/widget/jetbrains-mono-700.woff2"));
await cp(font("LICENSE"), here("../dist/widget/jetbrains-mono-LICENSE.txt"));
```

and replace the preload size check below it, so both preloads are held to it:

```js
// A preload is parsed before every page it serves. It needs the channel names and Electron's bridge,
// nothing more; if one grows past this, something has pulled a library into it again.
const PRELOAD_LIMIT = 20_000;
for (const page of ["settings", "widget"]) {
  const preloadSize = (await stat(here(`../dist/${page}/preload.js`))).size;
  if (preloadSize > PRELOAD_LIMIT) {
    console.error(`bundle: dist/${page}/preload.js is ${preloadSize} bytes, over the ${PRELOAD_LIMIT} it is allowed; check what src/${page}/preload.ts imports`);
    process.exit(1);
  }
}
```

- [ ] **Step 8: Run everything for the page**

Run from `apps/desktop`: `npx vitest run src/widget && pnpm typecheck && node build/clean.mjs && node build/bundle.mjs && ls dist/widget`
Expected: PASS; the type check passes in all three projects; `ls` prints `index.html`, `jetbrains-mono-400.woff2`, `jetbrains-mono-700.woff2`, `jetbrains-mono-LICENSE.txt`, `page.css`, `page.js`, `page.js.map`, `preload.js`, `preload.js.map`.

Then check what the page's bundle holds: `node -e "console.log(require('fs').statSync('dist/widget/page.js').size)"`. Expected: well under 200 000. The scene imports only types from core, so zod must not be in it; if the file is near 750 kB, something imported a value from `@clawd/core` and that import is the thing to fix.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/widget/page.html apps/desktop/src/widget/page.css apps/desktop/src/widget/page.ts apps/desktop/src/widget/page.test.ts apps/desktop/tsconfig.json apps/desktop/tsconfig.page.json apps/desktop/tsconfig.page-test.json apps/desktop/build/bundle.mjs
git commit -m "feat(desktop): the widget page draws the one pane it is sent, tells a click from a drag by how far the press moved on the screen, and leaves the moving to main"
```

---

### Task 12: The page's host, its window, and an icon for every window

**Files:**
- Modify: `apps/desktop/src/scheme.ts`, `apps/desktop/src/paths.ts`, `apps/desktop/src/navigation.ts`, `apps/desktop/src/window.ts`
- Modify: `apps/desktop/build/bundle.mjs`
- Test: `apps/desktop/src/scheme.test.ts`, `apps/desktop/src/paths.test.ts`, `apps/desktop/src/navigation.test.ts`

**Interfaces:**
- Consumes: `WidgetWindow` (Task 9); `WIDGET_CHANNELS` (Task 10); `Bounds` (Task 5).
- Produces: `WIDGET_HOST = "widget"`, `WIDGET_URL = "app://widget/"`; `SchemeDirs` and `DistPaths` gain `widget`; `DistPaths` gains `appIcon`; `sessionUrl(base: string, alias: string): string`; `createMainWindow(url, title, bounds, maximized, icon)`, `createSettingsWindow(preload, icon)`, `createWidgetWindow(preload: string, bounds: Bounds, icon: string): BrowserWindow`, `asWidgetWindow(win: BrowserWindow): WidgetWindow`.

`window.ts` loads Electron at run time and has no test, like `main.ts`: it is the thin side. Everything it decides is an option passed to Electron; Task 15's checklist is what checks it.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/scheme.test.ts`:

Add `WIDGET_URL` to the import from `./scheme`. Replace the `DIRS` line and add a directory above it:

```ts
const WIDGET = resolve("widget-root");
const DIRS = { clawd: ROOT, settings: SETTINGS, widget: WIDGET };
```

Every `createSchemeHandler({ dirs: { clawd: dir, settings: dir }, ...` in the file gains `widget: dir`; find them with `grep -n "settings: dir" src/scheme.test.ts` and any other `dirs:` literal with `grep -n "dirs:" src/scheme.test.ts`, and add `widget` to each so the file type-checks.

Add after `describe("the settings host", ...)`:

```ts
describe("the widget host", () => {
  it("serves the widget page from its own directory, and nothing outside it", () => {
    expect(WIDGET_URL).toBe("app://widget/");
    expect(mapRequest("app://widget/", DIRS)).toBe(join(WIDGET, "index.html"));
    expect(mapRequest("app://widget/page.js", DIRS)).toBe(join(WIDGET, "page.js"));
    expect(mapRequest("app://widget/..%2Fsettings%2Fpage.js", DIRS)).toBeNull();
  });

  it("gives a widget the policy that lets a page reach nothing: it is sent its snapshot, and fetches none", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<canvas></canvas>");
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir, widget: dir }, port: () => 4750, fallbackPort: 4750 });
    const page = await handle({ url: "app://widget/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(SETTINGS_POLICY);
    expect(SETTINGS_POLICY).toContain("connect-src 'none'");
  });
});
```

In `apps/desktop/src/paths.test.ts`, add to the first test's expected object:

```ts
      widget: "C:\\repo\\apps\\desktop\\dist\\widget",
      appIcon: "C:\\repo\\apps\\desktop\\dist\\tray\\app.ico",
```

and to the second's:

```ts
      widget: "C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist\\widget",
      appIcon: "C:\\Apps\\Clawd Visualiser\\resources\\tray\\app.ico",
```

In `apps/desktop/src/navigation.test.ts`, add `sessionUrl` to the import from `./navigation`, and add at the end of the file:

```ts
describe("sessionUrl", () => {
  it("is the page's URL with the session named in the hash, which the page reads as a link", () => {
    expect(sessionUrl("app://clawd/", "agent-3")).toBe("app://clawd/#session=agent-3");
    expect(sessionUrl("http://localhost:3000/", "agent-12")).toBe("http://localhost:3000/#session=agent-12");
  });

  it("replaces a hash already there, and encodes what a URL cannot carry", () => {
    expect(sessionUrl("app://clawd/#session=agent-1", "agent-2")).toBe("app://clawd/#session=agent-2");
    expect(sessionUrl("app://clawd/", "a b#c")).toBe("app://clawd/#session=a%20b%23c");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/scheme.test.ts src/paths.test.ts src/navigation.test.ts`
Expected: FAIL: `WIDGET_URL` and `sessionUrl` are not exported, `app://widget/` maps to null, and `distPaths` has no `widget` or `appIcon`.

- [ ] **Step 3: Implement the host, the paths and the link**

In `apps/desktop/src/scheme.ts`:

Update the header comment's `from one of two directories — the visualiser's and the settings page's —` to `from one of three directories (the visualiser's, the settings page's and the widget page's),`. After the `SETTINGS_URL` line add:

```ts
/** The widget windows' host; their page is served from dist/widget. Every widget loads this one URL. */
export const WIDGET_HOST = "widget";
export const WIDGET_URL = `${APP_SCHEME}://${WIDGET_HOST}/`;
```

Replace `SchemeDirs`:

```ts
export type SchemeDirs = { clawd: string; settings: string; widget: string };
```

Add to `HOSTS`, after the settings entry:

```ts
  // A widget is sent its snapshot over its bridge and fetches nothing, so it gets the policy that lets a page reach nothing.
  [WIDGET_HOST, { dir: (dirs) => dirs.widget, policy: () => SETTINGS_POLICY, notFound: null }],
```

and change the comment above `HOSTS`' type from `between our two hosts` to `between our three hosts`.

In `apps/desktop/src/paths.ts`, replace the type and the function:

```ts
export type DistPaths = { renderer: string; tray: string; settings: string; widget: string; hooks: string; appIcon: string };

/**
 * `dir` is the bundle's directory. `resources` is where the icons and the scripts are: the same
 * directory in development, `process.resourcesPath` when packaged. The app's own icon is beside the
 * tray's: a window's `icon` is a path too, and an asar is transparent only to Node's read calls.
 */
export function distPaths(dir: string, resources: string): DistPaths {
  return {
    renderer: join(dir, "renderer"),
    settings: join(dir, "settings"),
    widget: join(dir, "widget"),
    tray: join(resources, "tray"),
    hooks: join(resources, "hooks"),
    appIcon: join(resources, "tray", "app.ico"),
  };
}
```

and in its header comment change `fills four directories next to it` to `fills five directories next to it` and `main.cjs and the two pages travel` to `main.cjs and the three pages travel`.

In `apps/desktop/src/navigation.ts`, add at the end:

```ts
/** The page's URL with one session named in the hash, which the web app reads as a link to that session's detail sheet. */
export function sessionUrl(base: string, alias: string): string {
  return `${base.split("#")[0] ?? base}#session=${encodeURIComponent(alias)}`;
}
```

In `apps/desktop/build/bundle.mjs`, after the line that copies `../resources/tray` to `../dist/tray`, add:

```js
// The app's own icon goes beside the tray's, so the one extraResources entry carries it: every
// window is given it by path, and a development run is electron.exe, whose icon is Electron's.
await cp(here("../resources/icon.ico"), here("../dist/tray/app.ico"));
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/scheme.test.ts src/paths.test.ts src/navigation.test.ts`
Expected: PASS.

- [ ] **Step 5: The windows**

Replace `apps/desktop/src/window.ts` with:

```ts
import { BrowserWindow, Menu, type BrowserWindowConstructorOptions } from "electron";
import type { Bounds } from "./desktop-state";
import { sameOrigin } from "./navigation";
import { SETTINGS_URL, WIDGET_URL } from "./scheme";
import { WIDGET_CHANNELS } from "./widget/channels";
import type { WidgetWindow } from "./widgets/controller";

export const WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The scene's night background, so the window never flashes white before the page paints. */
export const BACKGROUND = "#0a0b10";

type WindowSpec = {
  url: string;
  title: string;
  size: { width: number; height: number };
  /** The app's icon, by path. Packaged, the exe carries it anyway; a development run is electron.exe, which carries Electron's. */
  icon: string;
  bounds?: Bounds | null;
  preload?: string;
  /** What differs from an ordinary window: a widget's lack of a frame, a background and a taskbar entry. */
  chrome?: BrowserWindowConstructorOptions;
};

/**
 * Every window the app makes: sandboxed, no Node access, its title set by main, no new windows, and
 * no navigation away from the origin it was loaded from. The one copy of the hardening.
 */
function createHardenedWindow(spec: WindowSpec): BrowserWindow {
  const win = new BrowserWindow({
    ...(spec.bounds ?? spec.size),
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: spec.title,
    icon: spec.icon,
    ...spec.chrome,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, ...(spec.preload === undefined ? {} : { preload: spec.preload }) },
  });
  // A page's <title> replaces the window's by default; main sets the title instead.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(spec.url, target)) event.preventDefault();
  });
  void win.loadURL(spec.url);
  return win;
}

/**
 * The one visualiser window: a web page that talks to the agent over HTTP, as a browser tab does,
 * with no preload. `bounds` puts it back where it was, and `maximized` how it was; without bounds it
 * opens at the default size, centred.
 */
export function createMainWindow(url: string, title: string, bounds: Bounds | null, maximized: boolean, icon: string): BrowserWindow {
  const win = createHardenedWindow({ url, title, size: WINDOW_SIZE, bounds, icon });
  if (maximized) win.maximize();
  return win;
}

export const SETTINGS_SIZE = { width: 560, height: 720 } as const;

/**
 * The settings window, with a preload: the one place the app gives a page a way to ask main for
 * something. It loads app://settings/ and nothing else.
 */
export function createSettingsWindow(preload: string, icon: string): BrowserWindow {
  return createHardenedWindow({ url: SETTINGS_URL, title: "Clawd Visualiser settings", size: SETTINGS_SIZE, preload, icon });
}

/**
 * A widget: no frame, no background, no shadow, no taskbar entry, and no way to resize, maximise or
 * minimise it by hand. `transparent` makes what the page does not paint the desktop; the background
 * colour has to be fully transparent too, or the window is filled before the page draws. Made
 * hidden: the controller shows it once its page has said what size it needs.
 */
const WIDGET_CHROME: BrowserWindowConstructorOptions = {
  frame: false,
  transparent: true,
  backgroundColor: "#00000000",
  hasShadow: false,
  resizable: false,
  maximizable: false,
  minimizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  show: false,
};

export function createWidgetWindow(preload: string, bounds: Bounds, icon: string): BrowserWindow {
  return createHardenedWindow({ url: WIDGET_URL, title: "Clawd widget", size: bounds, bounds, preload, icon, chrome: WIDGET_CHROME });
}

/**
 * A widget's BrowserWindow as the controller sees one. Every call checks the window is still there:
 * the controller may hold one a moment after it has gone.
 */
export function asWidgetWindow(win: BrowserWindow): WidgetWindow {
  // Read now: `webContents` cannot be touched once the window is destroyed.
  const id = win.webContents.id;
  let last: Bounds = win.getBounds();
  return {
    id,
    bounds: () => (win.isDestroyed() ? last : (last = win.getBounds())),
    setBounds: (bounds) => {
      if (!win.isDestroyed()) win.setBounds(bounds);
    },
    // A window level, not a z-order nudge: a pinned widget stays above ordinary windows whatever has the focus.
    setPinned: (on) => {
      if (!win.isDestroyed()) win.setAlwaysOnTop(on, "floating");
    },
    // showInactive and moveTop: on screen and above its neighbours, and the keyboard stays where it was.
    reveal: () => {
      if (win.isDestroyed()) return;
      win.showInactive();
      win.moveTop();
    },
    send: (state) => {
      if (!win.isDestroyed()) win.webContents.send(WIDGET_CHANNELS.state, state);
    },
    popupMenu: (template) => {
      if (!win.isDestroyed()) Menu.buildFromTemplate(template).popup({ window: win });
    },
    close: () => {
      if (!win.isDestroyed()) win.close();
    },
    onFailed: (cb) => {
      win.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
        if (isMainFrame) cb();
      });
      win.webContents.on("render-process-gone", () => cb());
    },
    onClosed: (cb) => void win.on("closed", cb),
  };
}
```

- [ ] **Step 6: Keep `main.ts` compiling, and give its two windows the icon**

Three call sites in `apps/desktop/src/main.ts` no longer type-check. Change only these; the widgets are wired in Task 14.

In `showWindow()`:

```ts
      const created = createMainWindow(url, statusText(host.state()), restoredBounds(store.get().bounds, workAreas), store.get().maximized === true, dist.appIcon);
```

In `showSettings()`:

```ts
      const created = createSettingsWindow(join(dist.settings, "preload.js"), dist.appIcon);
```

In the `protocol.handle` call:

```ts
    protocol.handle(APP_SCHEME, createSchemeHandler({ dirs: { clawd: dist.renderer, settings: dist.settings, widget: dist.widget }, port: () => host.state().port ?? DEFAULT_PORT, fallbackPort: DEFAULT_PORT }));
```

Run from `apps/desktop`: `pnpm typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 7: See the icon**

Run: `pnpm --filter @clawd/desktop dev` (with the web app's dev server running, or `pnpm --filter @clawd/desktop start` without it).
Expected: the window's title bar, its taskbar button and its Alt+Tab entry show the Clawd, not Electron's icon; so does the settings window, opened from the tray. Quit from the tray. If you cannot run a GUI, say so and leave this to Task 15's checklist; do not claim it.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/scheme.ts apps/desktop/src/scheme.test.ts apps/desktop/src/paths.ts apps/desktop/src/paths.test.ts apps/desktop/src/navigation.ts apps/desktop/src/navigation.test.ts apps/desktop/src/window.ts apps/desktop/src/main.ts apps/desktop/build/bundle.mjs
git commit -m "feat(desktop): app://widget/ under the policy that reaches nothing, a frameless transparent window for it, and the Clawd icon on every window, which a development run lacked"
```

---

### Task 13: The View setting

**Files:**
- Modify: `apps/desktop/src/settings/state.ts`, `channels.ts`, `preload.ts`, `ipc.ts`, `actions.ts`, `page.ts`
- Modify: `apps/desktop/src/settings-state.ts`, `apps/desktop/src/main.ts`
- Test: `apps/desktop/src/settings/ipc.test.ts`, `actions.test.ts`, `page.test.ts`, `apps/desktop/src/settings-state.test.ts`

**Interfaces:**
- Consumes: `View` (Task 5); the log code `desktop.viewChanged` (Task 6).
- Produces: `SettingsState.view: "window" | "widgets"`; `SettingsApi.setView(view): Promise<SettingsState>`; `CHANNELS.setView`; `ActionDeps.applyView(view: View): boolean` (true when the choice was remembered); `VIEW_NOT_REMEMBERED`; `SettingsInput.view`.

After this task the choice is shown, saved and logged, and nothing is drawn differently yet: Task 14 hands it to the controller.

- [ ] **Step 1: Write the failing tests**

Every `SettingsState` literal in the tests needs the new field, or the type check fails. In `apps/desktop/src/settings/ipc.test.ts`, `actions.test.ts` and `page.test.ts`, add to the `STATE` constant, after `openAtLogin: false,`:

```ts
  view: "window",
```

In `apps/desktop/src/settings-state.test.ts`, add `view: "widgets" as const,` to `INPUT` after `openAtLogin: false,`, and `view: "widgets",` to the first test's expected object after `openAtLogin: false,`.

In `apps/desktop/src/settings/ipc.test.ts`, add to the `base` actions, after `setOpenAtLogin`:

```ts
    setView: async (view) => {
      calls.push(`setView ${view}`);
      return STATE;
    },
```

and add inside the file's `describe`:

```ts
  it("passes a view on, and answers anything that is not one with the state as it is", async () => {
    const { calls, handlers } = actions();
    await handlers[CHANNELS.setView]!("widgets");
    await handlers[CHANNELS.setView]!("window");
    expect(await handlers[CHANNELS.setView]!("floating")).toEqual(STATE);
    expect(await handlers[CHANNELS.setView]!(undefined)).toEqual(STATE);
    expect(calls).toEqual(["setView widgets", "setView window"]);
  });
```

In `apps/desktop/src/settings/actions.test.ts`, add `VIEW_NOT_REMEMBERED` to the import from `./actions`, add to the harness's `deps`, after `applyOpenAtLogin`:

```ts
    applyView: (view) => {
      calls.push(`view ${view}`);
      return true;
    },
```

and add inside `describe("createSettingsActions", ...)`:

```ts
  it("applies the view, logs which it is, and restarts nothing: the agent is not involved", async () => {
    const { calls, codes, fields, actions } = harness();
    expect(await actions.setView("widgets")).toEqual(STATE);
    expect(calls).toEqual(["view widgets"]);
    expect(codes).toEqual(["desktop.viewChanged"]);
    expect(fields).toEqual([{ widgets: true, remembered: true }]);
  });

  it("says so when the view holds for this run only, because desktop.json could not be read", async () => {
    const { fields, actions } = harness({ applyView: () => false });
    expect((await actions.setView("window")).notice).toBe(VIEW_NOT_REMEMBERED);
    expect(fields).toEqual([{ widgets: false, remembered: false }]);
  });

  it("says where to look when the view could not be changed", async () => {
    const { fields, actions } = harness({
      applyView: () => {
        throw new Error("no display");
      },
    });
    expect((await actions.setView("widgets")).notice).toContain("see the log");
    expect(fields).toEqual([{ widgets: true, failed: true }]);
  });
```

In `apps/desktop/src/settings/page.test.ts`, add to the stub `api` in `load()`, after `setOpenAtLogin`:

```ts
    setView: async () => initial,
```

change both `["agent", "folders", "hooks", "detail", "login"]` lists to `["agent", "view", "folders", "hooks", "detail", "login"]`, and add inside `describe("the settings page", ...)`:

```ts
  it("offers the view as two radios after This app, asks main for the one chosen, and puts a notice about it in its own section", async () => {
    const asked: string[] = [];
    const held = "applied for this run; desktop.json could not be read when the app started, so the choice will not be remembered";
    await load({
      setView: async (view) => {
        asked.push(view);
        return { ...STATE, view, notice: held };
      },
    });
    expect(Array.from(document.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(["Agent", "This app", "View", "Watched folders", "Hooks", "Detail level", "Start on login"]);
    expect(radio("view:window").checked).toBe(true);
    choose("view:widgets");
    await flush();
    expect(asked).toEqual(["widgets"]);
    expect(radio("view:widgets").checked).toBe(true);
    expect(sectionRegion("view").textContent).toBe(held);
    expect(region().children).toHaveLength(0);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/settings src/settings-state.test.ts`
Expected: FAIL: no `setView` handler, no `setView` action, no `view:window` control, and `settingsState` carries no `view`.

- [ ] **Step 3: Implement**

`apps/desktop/src/settings/state.ts`: add to `SettingsState` after `openAtLogin: boolean;`:

```ts
  /** One window holding the whole scene, or a frameless window per pane. */
  view: "window" | "widgets";
```

and to `SettingsApi` after `setOpenAtLogin`:

```ts
  setView(view: SettingsState["view"]): Promise<SettingsState>;
```

`apps/desktop/src/settings/channels.ts`: after the `setOpenAtLogin` line:

```ts
  setView: "clawd:settings/setView",
```

`apps/desktop/src/settings/preload.ts`: after the `setOpenAtLogin` line:

```ts
  setView: (view: SettingsState["view"]) => invoke<SettingsState>(CHANNELS.setView, view),
```

`apps/desktop/src/settings/ipc.ts`: after the `setOpenAtLogin` line:

```ts
    [CHANNELS.setView]: checked(z.enum(["window", "widgets"]), (view) => actions.setView(view)),
```

`apps/desktop/src/settings-state.ts`: import the type, check the page's copy of the union against it, carry the field:

```ts
import type { View } from "./desktop-state";
```

```ts
type ViewMatches = Extends<View, SettingsState["view"]>;
```

Add `view: View;` to `SettingsInput` after `openAtLogin: boolean;`, and `view: input.view,` to the returned object after `openAtLogin: input.openAtLogin,`.

`apps/desktop/src/settings/actions.ts`: add the import, the dependency, the sentence and the action.

```ts
import type { View } from "../desktop-state";
```

In `ActionDeps`, after `applyOpenAtLogin`:

```ts
  /** Applies the view now and remembers it. False when desktop.json could not be read at launch: the choice then holds for this run only. */
  applyView(view: View): boolean;
```

After `NO_CONFIG_TO_CHANGE`:

```ts
export const VIEW_NOT_REMEMBERED = "applied for this run; desktop.json could not be read when the app started, so the choice will not be remembered";
```

In the returned object, after `setOpenAtLogin`:

```ts
    async setView(view) {
      let remembered: boolean;
      try {
        remembered = deps.applyView(view);
      } catch {
        deps.log("desktop.viewChanged", { widgets: view === "widgets", failed: true });
        return answer(`the view could not be changed; ${SEE_LOG}`);
      }
      deps.log("desktop.viewChanged", { widgets: view === "widgets", remembered });
      return answer(remembered ? null : VIEW_NOT_REMEMBERED);
    },
```

`apps/desktop/src/settings/page.ts`. The file already has a type and a variable called `View` and `view` (the page's nodes), so the setting is `Mode` here.

After `type Login = "on" | "off";`:

```ts
type Mode = SettingsState["view"];
```

After `LOGIN_CHOICES`:

```ts
const MODE_CHOICES: readonly { value: Mode; label: string }[] = [
  { value: "window", label: "window: the whole scene in one window" },
  { value: "widgets", label: "widgets: each folder's box on its own, to drag and to pin on top" },
];
```

In `SECTION_OF`, add `view: "view",`. In the `View` type, add `mode: Choices<Mode>;` after `login: Choices<Login>;`. In `build()`, after the `login` line:

```ts
  const mode = choices<Mode>("view", "How sessions are shown", MODE_CHOICES, (value) => window.clawd.setView(value));
```

Change the `notices` line's list to `["agent", "view", "folders", "hooks", "detail", "login"]`, add the section after `This app` in `app.replaceChildren(...)`:

```ts
    section("View", [mode.group], notices.get("view")),
```

and add `mode` to the returned object. In `render()`, after the `check(v.login, ...)` line:

```ts
  check(v.mode, "view", state.view, answered);
```

`apps/desktop/src/main.ts`: the state and the dependency, so the package compiles. In `currentState()`, after `openAtLogin: openAtLogin(),`:

```ts
      view: store.get().view ?? "window",
```

In `createSettingsActions({...})`, after `applyOpenAtLogin,`:

```ts
    // Remembered here; Task 14 hands it to the widgets' controller too.
    applyView: (next) => {
      store.update({ view: next });
      return store.usable();
    },
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings apps/desktop/src/settings-state.ts apps/desktop/src/settings-state.test.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): the settings window offers the view, window or widgets, remembers it, and says so beside the control when it cannot"
```

---

### Task 14: The tray's entry, and the wiring

**Files:**
- Modify: `apps/desktop/src/tray.ts`
- Modify: `apps/desktop/src/main.ts`
- Test: `apps/desktop/src/tray.test.ts`

**Interfaces:**
- Consumes: everything above. `createWidgetController`, `createWidgetHandlers`, `createAttachedFeed`, `feedPort`, `fetchSnapshot`, `placementOf`, `withPlacement`, `sessionUrl`, `createWidgetWindow`, `asWidgetWindow`, the host's `onSnapshot(s, run)`.
- Produces: `TrayActions.showWidgets(): void`; `trayMenuTemplate(openAtLogin: boolean, actions: TrayActions, view?: View)`, with **Show widgets** first in widget view.

- [ ] **Step 1: Write the failing tray test**

In `apps/desktop/src/tray.test.ts`, add to the recorder's `actions`, after `open`:

```ts
      showWidgets: () => void calls.push("widgets"),
```

and add inside `describe("trayMenuTemplate", ...)`:

```ts
  it("puts Show widgets above Open in widget view only; Open is the full window in either", () => {
    const { calls, actions } = recorder();
    const menu = trayMenuTemplate(false, actions, "widgets");
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Show widgets", "Open", "Settings", "Start on login", "separator", "Quit"]);
    click(menu[0]);
    click(menu[1]);
    expect(calls).toEqual(["widgets", "open"]);
    expect(trayMenuTemplate(false, actions, "window").map((item) => item.label ?? item.type)).toEqual(["Open", "Settings", "Start on login", "separator", "Quit"]);
  });
```

Run from `apps/desktop`: `npx vitest run src/tray.test.ts`
Expected: FAIL: the menu has no `Show widgets`.

- [ ] **Step 2: Implement the tray's entry**

In `apps/desktop/src/tray.ts`, add the import, the action, and replace the template:

```ts
import type { View } from "./desktop-state";
```

```ts
export type TrayActions = {
  open(): void;
  /** Brings the widgets forward. Offered in widget view only. */
  showWidgets(): void;
  settings(): void;
  setOpenAtLogin(on: boolean): void;
  quit(): void;
};

/** Show widgets (in widget view), Open, Settings, Start on login, Quit. Open is the full window in either view. */
export function trayMenuTemplate(openAtLogin: boolean, actions: TrayActions, view: View = "window"): MenuItemConstructorOptions[] {
  return [
    ...(view === "widgets" ? [{ label: "Show widgets", click: () => actions.showWidgets() }] : []),
    { label: "Open", click: () => actions.open() },
    { label: "Settings", click: () => actions.settings() },
    { label: "Start on login", type: "checkbox", checked: openAtLogin, click: () => actions.setOpenAtLogin(!openAtLogin) },
    { type: "separator" },
    { label: "Quit", click: () => actions.quit() },
  ];
}
```

Run from `apps/desktop`: `npx vitest run src/tray.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire `main.ts`**

All in `apps/desktop/src/main.ts`. `main.ts` has no tests; every rule it calls has.

Imports: extend three existing lines and add five.

```ts
import { checkToken, fetchCounts, fetchSnapshot, probeHealth } from "./agent-client";
import { createAttachedFeed, feedPort } from "./attached-feed";
import { createDesktopStore, desktopStatePath, placementOf, withPlacement, type View } from "./desktop-state";
import { sessionUrl } from "./navigation";
import { createWidgetHandlers } from "./widget/ipc";
import { createWidgetController } from "./widgets/controller";
import { asWidgetWindow, createMainWindow, createSettingsWindow, createWidgetWindow } from "./window";
```

After `let quitting = false;` add the view, the controller and the feed. `showWindow` and `showSettings` are function declarations further down, so they can be named here; `screen` is only touched when a widget is made, long after `ready`.

```ts
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
  const followFeed = (): void => feed.watch(quitting ? null : feedPort(host.state(), view()));
```

In `createAgentHost({...})`, add the listener and extend `onChange`:

```ts
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
```

Replace `showWindow` down to its closing brace (the body of the `create` callback is unchanged apart from `target`):

```ts
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
    if (existed && alias !== undefined && !quitting && win !== null && !win.isDestroyed()) void win.loadURL(target);
  }

  /** What clicking the tray icon or launching the app a second time does: the widgets come forward in widget view, and the full window opens otherwise, or when no widget is open, so the click always does something. */
  function revealApp(): void {
    if (quitting) return;
    if (view() === "widgets" && widgets.showAll() > 0) return;
    showWindow();
  }
```

Replace `refreshMenu`:

```ts
  /** The menu is rebuilt whenever the login checkbox or the view could have changed. */
  function refreshMenu(): void {
    tray?.setContextMenu(
      Menu.buildFromTemplate(
        trayMenuTemplate(
          openAtLogin(),
          { open: () => showWindow(), showWidgets: () => void widgets.showAll(), settings: showSettings, setOpenAtLogin: (on: boolean) => { applyOpenAtLogin(on); pushState(); }, quit: () => app.quit() },
          view(),
        ),
      ),
    );
  }
```

Replace the `applyView` dependency Task 13 wrote in `createSettingsActions({...})` with a function declared beside `applyOpenAtLogin`, and pass it by name (`applyView,`):

```ts
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
```

Inside `app.whenReady().then(async () => { ... })`:

After `if (quitting) return;` (the one that follows `await store.load();`) add:

```ts
    // desktop.json is read: the remembered view takes effect, and with it the question of whom to ask for snapshots.
    widgets.setView(view());
    followFeed();
```

Replace `tray.on("click", () => showWindow());` with:

```ts
    tray.on("click", () => revealApp());
```

After the loop that registers the settings handlers, add:

```ts
    // Every widget window sends on the same channels. The sender's id is the only thing that tells
    // them apart, and the only identity main trusts. `handle` answers; `on` does not.
    const widgetHandlers = createWidgetHandlers(widgets);
    for (const [channel, handler] of Object.entries(widgetHandlers.invoke)) ipcMain.handle(channel, (event, arg: unknown) => handler(event.sender.id, arg));
    for (const [channel, handler] of Object.entries(widgetHandlers.on)) ipcMain.on(channel, (event, arg: unknown) => handler(event.sender.id, arg));
```

Replace the last line, `if (!args.hidden) showWindow();`, with:

```ts
    // In widget view the widgets are the app's face, and they appear with the sessions; --hidden holds back only the full window.
    if (!args.hidden && view() === "window") showWindow();
```

In the `second-instance` handler, replace `void started.then(showWindow, () => {});` with:

```ts
    void started.then(revealApp, () => {});
```

In the `before-quit` handler, after `pushStateSoon.cancel();`:

```ts
    // The flag is set, so followFeed asks nobody; the widgets go with the window.
    feed.stop();
    widgets.closeAll();
```

Update the file's first comment to: `// The main process: the one Node program in the app. It owns the lifecycle, the window, the widgets and the tray, and runs the agent itself; Chromium draws, in a sandboxed renderer process per window.`

- [ ] **Step 4: Check it compiles and every test passes**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

- [ ] **Step 5: Run it**

Use scratch folders, so the real `~/.clawd` is not touched. In PowerShell, from the repository root:

```powershell
$env:CLAWD_HOME = "$env:TEMP\clawd-stage9"; pnpm --filter @clawd/desktop start
```

Open Settings from the tray, choose **widgets** under View. With no Claude session running nothing appears, which is right. If you can start a session in a watched folder of that scratch home, a box appears at the top right of the primary display; drag it, right-click it, click its pin, click a Clawd. Expected: the box follows the cursor and stays where it is dropped; the menu has Pin on top, Open full window and Settings; the pin lights amber and the box stays above other windows; clicking a Clawd opens the full window on that session's sheet. Choose **window** again: the box goes and the full window shows. Quit from the tray: no window is left behind and `desktop-dev.json` in the scratch home holds `view` and `widgets`.

If you cannot run a GUI or a session, say exactly which of these you did not see; they are all in Task 15's checklist for the maintainer. Do not claim them.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/tray.ts apps/desktop/src/tray.test.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): widget view: main hands every snapshot to the controller, tells the widget windows apart by event.sender, moves them with the cursor, and the tray shows them"
```

---

### Task 15: The documents, the package, and the maintainer's checklist

**Files:**
- Modify: `apps/desktop/README.md`, `docs/PRD.md`, `docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`, `README.md` (only if it describes the desktop app's window; check)

- [ ] **Step 1: The desktop README**

In `apps/desktop/README.md`, in the Run section, after the paragraph that begins `Settings opens from the tray.`, add:

```markdown
**Widget view.** Settings has a View choice: *window*, the whole scene in one window, or *widgets*,
where each folder's box is its own frameless, transparent window. Drag a box anywhere; it is found
again where it was left, by folder name, in `desktop.json`. The pin in its title row, or **Pin on
top** in its right-click menu, keeps it above other windows. Clicking a Clawd opens the full window
on that session's detail sheet, and the tray's **Open** opens it in either view. In widget view a
plain launch shows no window: the boxes appear with the sessions. Clicking the tray icon brings the
boxes forward, or opens the full window when there are none.
```

Add a stage note after `### Stage 8: hardening, the second half` and its paragraphs, before whatever follows them:

```markdown
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
and `moveTop()` show a window and raise it without giving it the keyboard.

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

**The icon.** The packaged exe always carried the Clawd, stamped by electron-builder. A development
run is `electron.exe`, which carries Electron's, and no window was given an `icon`. Every window is
now, from `app.ico` beside the tray's icons.
```

- [ ] **Step 2: The PRD**

In `docs/PRD.md`, replace the end of the M8 row, from `Done when a teammate unzips` to the row's closing `|`, keeping the sentence and adding one after it:

```markdown
Done when a teammate unzips the folder, runs the exe and sets up the hooks from the settings window, and moving the folder and relaunching repairs the hooks and the login item. Stage 9 adds a widget view, each pane its own frameless window that can be dragged and pinned on top; stage 10 adds a popup when a turn finishes (`docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`). |
```

and add a row at the end of the decision log:

```markdown
| 21 Sep 2026 | Desktop widgets: a widget is a pane, drawn by a page of the desktop package that main feeds over IPC and that may open no connection; the Next app gains only a `#session=` link. Windows are dragged by hand, since a CSS drag region swallows clicks. A finished turn means working to idle, and its popup goes down on a press or the next prompt, never on a timer. |
```

- [ ] **Step 3: The root README**

Run: `grep -n -i "window\|tray" README.md`
If a sentence describes what the desktop app shows, add after it: `Its settings can also show each folder's box as its own small window, to drag anywhere and pin on top.` If nothing does, change nothing.

- [ ] **Step 4: Package it and run the smoke**

Run from the repository root:

```bash
pnpm --filter @clawd/desktop package
pnpm --filter @clawd/desktop smoke
ls apps/desktop/release/win-unpacked/resources/tray
```

Expected: the package builds, the smoke passes, and `ls` prints `app.ico`, `tray-waiting.ico` and `tray.ico`. The earlier packaged build in `release/` is replaced by this one, which is what the checklist below is walked on.

- [ ] **Step 5: Write the checklist into the spec, for the maintainer**

In `docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`, add at the end of §10:

```markdown
### 10.1 Stage 9's manual checks

Walked by the maintainer on the packaged build, against scratch folders (`CLAWD_HOME`,
`CLAUDE_CONFIG_DIR`), with at least two Claude sessions in two watched folders. Not yet done.

- [ ] Settings shows View after This app; choosing widgets closes nothing and makes a box per folder at the top right of the primary display, one under the other.
- [ ] Each box is transparent outside its border, its interior dark, its text in JetBrains Mono; no box is in the taskbar or Alt+Tab.
- [ ] A new session in a folder walks in from behind the bottom border and is never drawn outside the box; sessions already there when the box opened were seated at once.
- [ ] A third session in one folder grows its box downward, the top-left corner fixed; when it leaves, the box shrinks back.
- [ ] The last session in a folder ending makes its Clawd walk out, and then the box closes.
- [ ] Dragging: the box follows the cursor with no lag that matters, keeps its size at 100, 125 and 150% scaling, and crosses between two displays with different scaling without changing size in CSS terms or blurring.
- [ ] A box dropped mostly off the screen can still be grabbed; one flung wholly off comes back inside.
- [ ] A click on a Clawd opens the full window on that session's detail sheet; doing it again after closing the sheet opens it again, and the scene in the full window does not reload (its Clawds do not walk in again).
- [ ] The pin appears on hover, sits on the title row clear of the collision mark, lights amber when pressed, and the box then stays above a maximised window. At 125% it is no more than two pixels off the row.
- [ ] Narrator reads the pin as a toggle button, "Pin on top", pressed or not; Tab reaches it.
- [ ] Right-click: Pin on top (ticked when pinned), Open full window, Settings, each doing what it says.
- [ ] Quit and relaunch: each box is where it was left, pinned if it was. With a display unplugged, a box remembered there takes a default slot.
- [ ] Tray: clicking the icon brings the boxes above other windows without taking the keyboard from the app in use; with no session running it opens the full window. The menu has Show widgets above Open in widget view only.
- [ ] `--hidden` in widget view: no full window, and boxes appear when sessions do.
- [ ] Choosing window again closes every box at once and shows the full window.
- [ ] Attached: with the CLI's agent holding the port, boxes still appear and follow the sessions within a second or so; stopping that agent, the app takes over and the boxes stay, their Clawds re-seated rather than walking in.
- [ ] Settings changed while widgets are shown (a folder added): the agent restarts and the boxes stay.
- [ ] A development run shows the Clawd, not Electron's icon, in the taskbar, the title bar and Alt+Tab, for the full window and the settings window.
- [ ] The log holds `desktop.viewChanged` with `widgets` and `remembered`, and no folder name anywhere.
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/README.md docs/PRD.md docs/superpowers/specs/2026-09-21-desktop-widgets-design.md README.md
git commit -m "docs: stage 9's Electron ideas in the desktop README, the widget view in the PRD, and the checks the maintainer has still to walk"
```

- [ ] **Step 7: Report**

Say what was built, what `pnpm test`, `pnpm typecheck`, the package and the smoke printed, and which hands-on steps (Task 4 Step 6, Task 12 Step 7, Task 14 Step 5) you could not do. The stage is not done until the maintainer has walked §10.1; do not mark it done, do not merge, and do not push.

