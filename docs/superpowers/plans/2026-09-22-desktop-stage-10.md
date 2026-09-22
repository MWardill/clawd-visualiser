# Desktop Stage 10 (The finished popup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A setting that, when a Claude turn finishes, raises that folder's box above every other window without taking the keyboard: the pane's widget in widget view, a temporary widget in window view, drawn green, and lowered by a press or by the session being prompted again.

**Architecture:** Everything sits on stage 9's parts. The scene gains one call, `setFinished`, for the green cue. A pure tracker in `widgets/finished.ts` tells which turns finished between two snapshots and which sessions still hold a raise. The controller keeps the raised set (label → the aliases that raised it), asks a `windowFocused` dependency at trigger time, and drives each window's level (`normal`, `pinned`, `raised`) through one `setLevel` call that replaces `setPinned`; `plan.ts` wants a temporary widget for a raised label in window view; `placement.ts` can stack upward from the bottom right. The widget page draws `raised` green and hides its pin when `temporary`. The setting travels the settings bridge as the View did. `main.ts` stays wiring.

**Tech Stack:** Electron 44, electron-builder 26, esbuild 0.28, zod 4, vitest 5, happy-dom 20, TypeScript 5.9, pnpm workspaces. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`, §3.3 (behaviour), §4 (`setFinished`), §5 (`raised`, `temporary`), §6 (`finished.ts`, the raised set, levels), §6.1 (`finishedPopup`), §6.2 (the two log codes), and the stage 10 row of §10. Stage 9 is merged (main `458e049`); this plan builds on that code as it is, not as the stage 9 plan described it.

**Stage ideas** (say them in commit messages and in the README's stage note):

- **Window levels.** `setAlwaysOnTop(true, level)` puts a window in a band. Stage 9 used `floating` for a pinned widget; a raised one uses `screen-saver`, the highest, which sits above a pinned widget, a maximised window and the taskbar. Lowering is a change of band, not a nudge.
- **Showing without activating, from the background.** A raise happens while another app has the focus. Stage 9's walk found the rule: a background process cannot move a window above the active one, only a topmost window sits there. A raised widget is topmost, so it needs no trick; a lowered one drops to its band and stays where it is.
- **A temporary window.** A window that exists for one purpose and closes when that purpose is met, made and destroyed by the same controller that owns the permanent ones, so its lifecycle is the same code path with one flag.
- **`isFocused()`.** Main can ask whether the full window has the keyboard, which is how it knows the maintainer is already looking.

## Decisions already made (do not reopen them)

From the spec's §2 and §3.3: "finished" means a session shown `working` in one snapshot and `idle` in the next; the first snapshot from a source is only the baseline; a raised box goes down on a press (when released), or when every session that raised it is working or waiting again or has left the snapshot, never on a timer, and `asleep` does not lower it; in window view a temporary widget is made unless the full window is focused; the cue is green, with amber for waiting winning; the setting defaults to off.

The plan's author chose these; each is recorded in the spec by Task 10:

- **The setting is a radio pair, off or on, like Start on login**, not a checkbox: the settings page has radio groups and no checkbox control, and one kind of control reads better than two. §3.1 is amended.
- **The focus check happens at trigger time**, in the controller, not in `plan.ts`: a finish that arrives while the full window is focused is simply not recorded, so nothing pops up later when the focus moves. §6's `plan.ts` signature is amended to `(snapshot, view, raised)`.
- **A press lowers a temporary widget by closing it at once**; a state change (the session prompted again, or gone) lowers it through the walk-out, like any pane that leaves. §3.3's "a temporary one closes" says which is which.
- **A change of view clears the raised set**, so a raise from one view never pops a box in the other. A raise happens only from a snapshot that arrives while the view is what it is.
- **`setLevel` replaces `setPinned`** on the controller's window interface: pinned and raised are two of three levels of one thing, and one call cannot leave the two flags disagreeing.
- **`feedPort` asks the attached agent while either setting is on**, as §6 says: in window view with the popup on, main still needs every snapshot.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere; a test may spell Windows paths.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first. `window.ts` and `main.ts` are the only files here that load Electron at run time.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: never assign `undefined` to an optional property, omit it; an indexed read is `T | undefined`.
- No new dependencies in any package. `apps/web` is not touched this stage.
- The widget page may open no connection; it is served under `SETTINGS_POLICY`.
- Every widget IPC handler identifies its window by `event.sender.id` and ignores a sender the controller did not create. No handler may throw.
- Log lines carry a time, a code and numbers or booleans only. New codes this stage: `desktop.popupChanged` (`on`, `remembered` or `failed`), `desktop.popupRaised` (`temporary`). A pane's label is never logged.
- No session content anywhere: a raise is decided from the states in the snapshot the page already draws.
- Never use `closable: false` on a widget: it makes `win.close()` a no-op and stalls the quit (stage 9's walk). Never raise an unpinned widget with `moveTop()` alone from the background; a raised widget is topmost, which is why it needs no toggle. A tray menu raise waits `MENU_SETTLE_MS`.
- Automated checks never run the app against the real `~/.clawd` or `~/.claude`.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-10` in the worktree `C:\mw\visualiser-desktop` (Task 0). Run a package's tests from its directory: `npx vitest run <file>`; the desktop's type check is `pnpm typecheck` there (three projects).
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app or the packager.
- If a step cannot be done as written, stop and say so; do not quietly narrow it. A timing assumption that fails is measured before anything is rewritten.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/scene/src/panes.ts`, `panes.test.ts`, `README.md` | `setFinished(panes)`: the green border and title, under amber. |
| `apps/agent/src/log.ts` | Two log codes. |
| `apps/desktop/src/desktop-state.ts` | `finishedPopup`. |
| `apps/desktop/src/attached-feed.ts` | `feedPort(host, view, popup)`. |
| `apps/desktop/src/widgets/finished.ts` | New. `finishedTurns`, `stillRaising`. Pure. |
| `apps/desktop/src/widgets/placement.ts` | Stacking upward from the bottom right. |
| `apps/desktop/src/widgets/plan.ts`, `menu.ts` | A temporary widget for a raised label in window view; a menu without the pin. |
| `apps/desktop/src/widget/state.ts`, `page.ts`, `page.css`, `page.test.ts` | `raised` and `temporary`: the cue and the hidden pin. |
| `apps/desktop/src/widgets/controller.ts`, `controller.test.ts` | The raised set, `setPopup`, `windowFocused`, `setLevel`, temporary entries. |
| `apps/desktop/src/window.ts` | `setLevel` in the adapter. |
| `apps/desktop/src/settings/*`, `settings-state.ts` | The popup control. |
| `apps/desktop/src/main.ts` | Wiring. |
| `docs/PRD.md`, `apps/desktop/README.md`, the spec | What was built, the ideas, the checklist. |

---

### Task 0: The branch

- [ ] **Step 1: Cut the branch in the desktop worktree**

The worktree `C:\mw\visualiser-desktop` has `feat/desktop-stage-9` checked out, which is merged.

```bash
git -C C:/mw/visualiser-desktop status --short
git -C C:/mw/visualiser-desktop checkout -b feat/desktop-stage-10 main
cd C:/mw/visualiser-desktop && pnpm install
```

Expected: `status --short` prints nothing (if it prints anything, stop and ask). All later paths are relative to `C:\mw\visualiser-desktop`. The plan must be in the branch at `docs/superpowers/plans/2026-09-22-desktop-stage-10.md`; if it is not, the maintainer has not committed it to `main`: stop and say so.

- [ ] **Step 2: Confirm the starting point is green**

Run: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace (core 201, scene 66, web 53, agent 258, desktop 287). If anything fails before you have changed a line, stop and report it.

---

### Task 1: The green cue

**Files:**
- Modify: `packages/scene/src/panes.ts`, `packages/scene/README.md`
- Test: `packages/scene/src/panes.test.ts`

**Interfaces:**
- Produces: `PanesScene.setFinished(panes: readonly string[]): void`. The pane aliases drawn green: border and title in `PALETTE.state.green`. Amber for a waiting session wins. With no call, nothing changes.

- [ ] **Step 1: Write the failing tests**

In `packages/scene/src/panes.test.ts`, add inside `describe("mountPanesScene as a widget", ...)`:

```ts
  it("draws a finished pane's border and title green, until told otherwise, and amber for a waiting session wins", () => {
    const h = harness(1, WIDGET);
    const idle = { ...SNAPSHOT.sessions[0]!, state: "idle" as const };
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: [idle] }, { seated: true });
    h.scene.setFinished(["pane-1"]);
    h.reset();
    h.frame(0);
    h.frame(100);
    expect(h.cellsOf(CELL).some((c) => c.col === PALETTE.state.green && c.x === 1 && c.y === 1)).toBe(true);
    expect(h.texts.find((t) => t.text === "─ oak")?.col).toBe(PALETTE.state.green);

    // the session waits: amber, whatever setFinished said
    h.scene.setSnapshot(SNAPSHOT);
    h.reset();
    h.frame(200);
    h.frame(300);
    expect(h.cellsOf(CELL).some((c) => c.col === PALETTE.state.amber && c.x === 1 && c.y === 1)).toBe(true);
    expect(h.cellsOf(CELL).some((c) => c.col === PALETTE.state.green && c.x === 1 && c.y === 1)).toBe(false);

    // lowered: back to the night line
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: [idle] });
    h.scene.setFinished([]);
    h.reset();
    h.frame(400);
    h.frame(500);
    expect(h.cellsOf(CELL).some((c) => c.col === PALETTE.night.line && c.x === 1 && c.y === 1)).toBe(true);
    expect(h.texts.find((t) => t.text === "─ oak")?.col).toBe(PALETTE.night.text);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run from `packages/scene`: `npx vitest run src/panes.test.ts`
Expected: FAIL: `h.scene.setFinished is not a function`.

- [ ] **Step 3: Implement**

In `packages/scene/src/panes.ts`:

Add to `PanesScene`, after `clear(): void;`:

```ts
  /** The panes drawn green, border and title: a turn there has finished and nobody has looked yet. Amber for a waiting session wins. */
  setFinished(panes: readonly string[]): void;
```

Add to `NOOP_SCENE`: `setFinished() {},`.

After `let hover: string | null = null;` add:

```ts
  let finished = new Set<string>();
```

In `drawPane`, replace the `const line = ...` line and the title's colour so they read:

```ts
    const waiting = world.actors.some((a) => a.pane === p.alias && a.state === "waiting" && (a.phase === "entering" || a.phase === "seated"));
    const done = !waiting && finished.has(p.alias);
    const line = waiting ? PALETTE.state.amber : done ? PALETTE.state.green : PALETTE.night.line;
    const text = waiting ? PALETTE.state.amber : done ? PALETTE.state.green : PALETTE.night.text;
```

and in the `drawText(ctx, PX, title, ...)` call replace `waiting ? PALETTE.state.amber : PALETTE.night.text` with `text`.

In the returned object, after `clear() {...},` add:

```ts
    setFinished(panes) {
      finished = new Set(panes);
    },
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `packages/scene`: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: The README**

In `packages/scene/README.md`, after the line `scene.setSnapshot(snapshot, { seated: true });   // the sessions were already there: no walk in`, add:

```ts
scene.setFinished(["pane-1"]);   // a turn there finished: border and title green until told []
```

- [ ] **Step 6: Commit**

```bash
git add packages/scene
git commit -m "feat(scene): a pane can be drawn green, border and title, for a turn that has finished, with amber for a waiting session winning"
```

---

### Task 2: Which turns finished, and who still holds a raise

**Files:**
- Create: `apps/desktop/src/widgets/finished.ts`, `apps/desktop/src/widgets/finished.test.ts`

**Interfaces:**
- Produces: `type FinishedTurn = { label: string; alias: string }`; `finishedTurns(previous: Snapshot | null, next: Snapshot): FinishedTurn[]`; `stillRaising(aliases: ReadonlySet<string>, next: Snapshot): Set<string>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/widgets/finished.test.ts`:

```ts
import type { SessionPhase, Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { finishedTurns, stillRaising } from "./finished";

const t = new Date(0).toISOString();
const session = (alias: string, pane: string, state: SessionPhase) => ({ alias, label: alias, pane, state, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t });
const snap = (...sessions: ReturnType<typeof session>[]): Snapshot => ({
  version: 1,
  generatedAt: t,
  panes: [
    { pane: "pane-1", label: "repo" },
    { pane: "pane-2", label: "docs" },
  ],
  sessions,
});

describe("finishedTurns", () => {
  it("names the pane and the session where working became idle, and nothing else", () => {
    const before = snap(session("agent-1", "pane-1", "working"), session("agent-2", "pane-2", "working"), session("agent-3", "pane-1", "idle"));
    const after = snap(session("agent-1", "pane-1", "idle"), session("agent-2", "pane-2", "waiting"), session("agent-3", "pane-1", "idle"));
    expect(finishedTurns(before, after)).toEqual([{ label: "repo", alias: "agent-1" }]);
  });

  it("is the baseline with no previous snapshot: nothing has finished", () => {
    expect(finishedTurns(null, snap(session("agent-1", "pane-1", "idle")))).toEqual([]);
  });

  it("does not count a session that went from working to asleep, done or gone, nor one first seen idle", () => {
    const before = snap(session("agent-1", "pane-1", "working"), session("agent-2", "pane-2", "working"), session("agent-3", "pane-1", "working"));
    const after = snap(session("agent-1", "pane-1", "asleep"), session("agent-2", "pane-2", "done"), session("agent-4", "pane-1", "idle"));
    expect(finishedTurns(before, after)).toEqual([]);
  });

  it("names every pane whose session finished, two in one snapshot too", () => {
    const before = snap(session("agent-1", "pane-1", "working"), session("agent-2", "pane-2", "working"));
    const after = snap(session("agent-1", "pane-1", "idle"), session("agent-2", "pane-2", "idle"));
    expect(finishedTurns(before, after)).toEqual([
      { label: "repo", alias: "agent-1" },
      { label: "docs", alias: "agent-2" },
    ]);
  });
});

describe("stillRaising", () => {
  const raised = new Set(["agent-1", "agent-2"]);

  it("keeps a session that is idle, asleep or done, and drops one working or waiting again, or gone", () => {
    expect(stillRaising(raised, snap(session("agent-1", "pane-1", "idle"), session("agent-2", "pane-2", "working")))).toEqual(new Set(["agent-1"]));
    expect(stillRaising(raised, snap(session("agent-1", "pane-1", "asleep"), session("agent-2", "pane-2", "waiting")))).toEqual(new Set(["agent-1"]));
    expect(stillRaising(raised, snap(session("agent-1", "pane-1", "done")))).toEqual(new Set(["agent-1"]));
    expect(stillRaising(raised, snap(session("agent-3", "pane-1", "idle")))).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widgets/finished.test.ts`
Expected: FAIL: cannot find `./finished`.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/widgets/finished.ts`:

```ts
// Which turns just finished, and which sessions still hold a box up. Pure: two snapshots in, names out.
import type { Snapshot } from "@clawd/core";

/** A session that was working in the previous snapshot and is idle in this one, with its pane's label. */
export type FinishedTurn = { label: string; alias: string };

/**
 * The turns that finished between two snapshots: a session shown `working` in the previous one and
 * `idle` in this one, by alias. The snapshot carries the displayed state, which core holds for a
 * moment, so a short turn still shows as working first. With no previous snapshot (the first from a
 * source) nothing has finished: that is the baseline, so nothing fires at launch or at a restart.
 * A session that vanished, or went to asleep or done, did not finish a turn.
 */
export function finishedTurns(previous: Snapshot | null, next: Snapshot): FinishedTurn[] {
  if (previous === null) return [];
  const wasWorking = new Set(previous.sessions.filter((s) => s.state === "working").map((s) => s.alias));
  const labels = new Map(next.panes.map((p) => [p.pane, p.label]));
  const out: FinishedTurn[] = [];
  for (const s of next.sessions) {
    if (s.state !== "idle" || !wasWorking.has(s.alias)) continue;
    const label = labels.get(s.pane);
    if (label !== undefined) out.push({ label, alias: s.alias });
  }
  return out;
}

/**
 * Of the sessions that raised a box, those still holding it up: present in the snapshot and neither
 * working nor waiting. One that is working or waiting again was answered in its terminal, so it was
 * seen; one that has left the snapshot is gone. `asleep` holds the raise: a popup that fired while
 * nobody was there should still be there on return.
 */
export function stillRaising(aliases: ReadonlySet<string>, next: Snapshot): Set<string> {
  const kept = new Set<string>();
  for (const s of next.sessions) {
    if (aliases.has(s.alias) && s.state !== "working" && s.state !== "waiting") kept.add(s.alias);
  }
  return kept;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widgets/finished.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/widgets/finished.ts apps/desktop/src/widgets/finished.test.ts
git commit -m "feat(desktop): which turns finished between two snapshots, and which sessions still hold a raised box up"
```

---

### Task 3: The setting's state, the log codes, and the feed's rule

**Files:**
- Modify: `apps/agent/src/log.ts`
- Modify: `apps/desktop/src/desktop-state.ts`, `apps/desktop/src/attached-feed.ts`
- Test: `apps/desktop/src/desktop-state.test.ts`, `apps/desktop/src/attached-feed.test.ts`

**Interfaces:**
- Produces: log codes `"desktop.popupChanged"`, `"desktop.popupRaised"`; `DesktopState.finishedPopup?: boolean`; `feedPort(host, view: View, popup: boolean): number | null`.

- [ ] **Step 1: The log codes**

In `apps/agent/src/log.ts`, after `  | "desktop.widgetFailed"` add:

```ts
  | "desktop.popupChanged"
  | "desktop.popupRaised"
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src/desktop-state.test.ts`, inside `describe("parseDesktopState", ...)`, add:

```ts
  it("keeps the popup choice, a boolean judged on its own", () => {
    expect(parseDesktopState({ version: 2, finishedPopup: true })).toEqual({ finishedPopup: true });
    expect(parseDesktopState({ version: 2, finishedPopup: "yes", view: "widgets" })).toEqual({ view: "widgets" });
  });
```

In `apps/desktop/src/attached-feed.test.ts`, replace the `describe("feedPort", ...)` block with:

```ts
describe("feedPort", () => {
  it("is the attached agent's port while widgets are shown or the popup is on, and nothing otherwise", () => {
    expect(feedPort({ mode: "attached", port: 4750 }, "widgets", false)).toBe(4750);
    expect(feedPort({ mode: "attached", port: 4750 }, "window", true)).toBe(4750);
    expect(feedPort({ mode: "attached", port: 4750 }, "window", false)).toBeNull();
    expect(feedPort({ mode: "own", port: 4750 }, "widgets", true)).toBeNull();
    expect(feedPort({ mode: "attached", port: null }, "widgets", true)).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/desktop-state.test.ts src/attached-feed.test.ts`
Expected: FAIL: `finishedPopup` is dropped, and `feedPort` ignores its third argument (the `"window", true` case is null).

- [ ] **Step 4: Implement**

`apps/desktop/src/desktop-state.ts`: in the `DesktopState` type add `finishedPopup?: boolean;` after `view?: View;`. In `parseDesktopState`, widen the cast with `finishedPopup?: unknown` and, after the `view` line, add:

```ts
  if (typeof file.finishedPopup === "boolean") state.finishedPopup = file.finishedPopup;
```

Extend the header comment's list of what the file remembers with `whether a finished turn pops its box up`.

`apps/desktop/src/attached-feed.ts`: replace `feedPort` and its comment:

```ts
/** The port to ask: only while attached, and only while something draws from snapshots main would otherwise lack: widgets on screen, or a popup waiting to be raised. */
export function feedPort(host: Pick<HostState, "mode" | "port">, view: View, popup: boolean): number | null {
  return host.mode === "attached" && (view === "widgets" || popup) ? host.port : null;
}
```

`apps/desktop/src/main.ts` calls `feedPort(host.state(), view())`; make it compile by passing `false` for now, with a comment `// Task 9 passes the popup setting.`: `feedPort(host.state(), view(), false)`.

- [ ] **Step 5: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/desktop-state.test.ts src/attached-feed.test.ts && pnpm typecheck`; and from `apps/agent`: `npx tsc --noEmit`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/log.ts apps/desktop/src/desktop-state.ts apps/desktop/src/desktop-state.test.ts apps/desktop/src/attached-feed.ts apps/desktop/src/attached-feed.test.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): desktop.json remembers the popup choice, the attached feed runs for it too, and the two log codes exist"
```

---

### Task 4: Stacking upward from the bottom right

**Files:**
- Modify: `apps/desktop/src/widgets/placement.ts`
- Test: `apps/desktop/src/widgets/placement.test.ts`

**Interfaces:**
- Produces: `PlaceInput.stack?: "down" | "up"` (default `"down"`). `"up"`: the first slot sits at the bottom right of the primary work area, the next ones above it, then a new column to the left.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/widgets/placement.test.ts`, inside `describe("placeWidget", ...)`, add:

```ts
  it("can stack upward from the bottom right, for a popup, and starts a new column to the left there too", () => {
    const bottom = { x: FIRST.x, y: PRIMARY.height - SIZE.height - SLOT_GAP, ...SIZE };
    expect(place({ stack: "up" })).toEqual(bottom);
    const above = place({ stack: "up", taken: [bottom] });
    expect(above).toEqual({ ...bottom, y: bottom.y - SIZE.height - SLOT_GAP });
    const column = Array.from({ length: 5 }, (_, i) => ({ ...bottom, y: bottom.y - i * (SIZE.height + SLOT_GAP) }));
    expect(place({ stack: "up", taken: column })).toEqual({ ...bottom, x: bottom.x - SIZE.width - SLOT_GAP });
    // a remembered place wins whichever way the slots stack
    expect(place({ stack: "up", remembered: { x: 40, y: 60, pinned: false } })).toEqual({ x: 40, y: 60, ...SIZE });
  });
```

- [ ] **Step 2: Run it to see it fail**

Run from `apps/desktop`: `npx vitest run src/widgets/placement.test.ts`
Expected: FAIL: the first expectation gets the top-right slot.

- [ ] **Step 3: Implement**

In `apps/desktop/src/widgets/placement.ts`, add to `PlaceInput` after `taken`:

```ts
  /** Which way the default slots run: down from the top right (widgets), or up from the bottom right (popups). Default down. */
  stack?: "down" | "up";
```

and replace the body of `placeWidget` from `const first: Bounds = ...` to the end of the function with:

```ts
  const up = stack === "up";
  const x0 = primary.x + primary.width - size.width - SLOT_GAP;
  const first: Bounds = { x: x0, y: up ? primary.y + primary.height - size.height - SLOT_GAP : primary.y + SLOT_GAP, ...size };
  let slot = first;
  for (let i = 0; i < MAX_SLOTS; i++) {
    const candidate = slot;
    if (!taken.some((other) => overlaps(candidate, other))) return candidate;
    const step = size.height + SLOT_GAP;
    const next = { ...candidate, y: up ? candidate.y - step : candidate.y + step };
    const fits = up ? next.y >= primary.y : next.y + size.height <= primary.y + primary.height;
    slot = fits ? next : { ...candidate, x: candidate.x - size.width - SLOT_GAP, y: first.y };
  }
  return first;
```

with the destructuring at the top of the function gaining `stack = "down"`: `export function placeWidget({ remembered, size, workAreas, primary, taken, stack = "down" }: PlaceInput): Bounds {`.

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widgets/placement.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/widgets/placement.ts apps/desktop/src/widgets/placement.test.ts
git commit -m "feat(desktop): default slots can stack upward from the bottom right, where a popup goes"
```

---

### Task 5: A temporary widget in the plan, and its menu

**Files:**
- Modify: `apps/desktop/src/widgets/plan.ts`, `apps/desktop/src/widgets/menu.ts`
- Test: `apps/desktop/src/widgets/plan.test.ts`, `apps/desktop/src/widgets/menu.test.ts`

**Interfaces:**
- Produces: `WantedWidget = { label: string; pane: string; temporary: boolean }`; `planWidgets(input: { snapshot: Snapshot; view: View; raised: ReadonlySet<string> })`: in widget view every pane, not temporary; in window view the panes whose label is raised, temporary. `widgetMenuTemplate(pinned, actions, temporary = false)`: with `temporary`, only Open full window and Settings.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/widgets/plan.test.ts`, replace the `describe("planWidgets", ...)` block with:

```ts
const NONE: ReadonlySet<string> = new Set();

describe("planWidgets", () => {
  it("wants one widget per pane in widget view, by label, in the snapshot's order, none of them temporary", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "widgets", raised: NONE })).toEqual([
      { label: "repo", pane: "pane-1", temporary: false },
      { label: "docs", pane: "pane-2", temporary: false },
    ]);
  });

  it("wants none in window view unless a pane is raised, and then a temporary one for it", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "window", raised: NONE })).toEqual([]);
    expect(planWidgets({ snapshot: SNAPSHOT, view: "window", raised: new Set(["docs", "gone"]) })).toEqual([{ label: "docs", pane: "pane-2", temporary: true }]);
  });

  it("wants a raised pane's widget in widget view as the ordinary one, not a second temporary one", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "widgets", raised: new Set(["docs"]) }).map((w) => [w.label, w.temporary])).toEqual([
      ["repo", false],
      ["docs", false],
    ]);
  });

  it("keeps the first of two panes that share a label, which core does not send", () => {
    const doubled = { ...SNAPSHOT, panes: [...SNAPSHOT.panes, { pane: "pane-3", label: "repo" }] };
    expect(planWidgets({ snapshot: doubled, view: "widgets", raised: NONE }).map((w) => w.pane)).toEqual(["pane-1", "pane-2"]);
  });
});
```

In `apps/desktop/src/widgets/menu.test.ts`, add inside `describe("widgetMenuTemplate", ...)`:

```ts
  it("has no pin for a temporary widget: Open full window, then Settings", () => {
    const calls: string[] = [];
    const actions = { togglePin: () => void calls.push("pin"), openWindow: () => void calls.push("window"), settings: () => void calls.push("settings") };
    const menu = widgetMenuTemplate(false, actions, true);
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Open full window", "Settings"]);
    click(menu[0]);
    click(menu[1]);
    expect(calls).toEqual(["window", "settings"]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widgets/plan.test.ts src/widgets/menu.test.ts`
Expected: FAIL: type errors on `raised` and `temporary`, and the temporary menu still has four items.

- [ ] **Step 3: Implement**

`apps/desktop/src/widgets/plan.ts`: replace `WantedWidget` and `planWidgets`:

```ts
/** A window that should exist: keyed by the pane's label, which outlives an agent restart; its alias does not. A temporary one is a popup in window view, gone once lowered. */
export type WantedWidget = { label: string; pane: string; temporary: boolean };

export type PlanInput = {
  snapshot: Snapshot;
  view: View;
  /** The labels of panes where a turn has finished and nobody has looked yet. */
  raised: ReadonlySet<string>;
};

/**
 * One widget per pane in widget view, whether raised or not: a raised pane's own widget is what is
 * raised. In window view, a temporary widget for each raised pane, and nothing else. Core makes
 * labels unique within a snapshot; were two ever alike, the first is kept.
 */
export function planWidgets(input: PlanInput): WantedWidget[] {
  const seen = new Set<string>();
  const wanted: WantedWidget[] = [];
  for (const p of input.snapshot.panes) {
    if (seen.has(p.label)) continue;
    seen.add(p.label);
    if (input.view === "widgets") wanted.push({ label: p.label, pane: p.pane, temporary: false });
    else if (input.raised.has(p.label)) wanted.push({ label: p.label, pane: p.pane, temporary: true });
  }
  return wanted;
}
```

`apps/desktop/src/widgets/menu.ts`: replace `widgetMenuTemplate` and its comment:

```ts
/** Pin on top, Open full window, Settings. A temporary widget, a popup in window view, has no pin: it goes when it is pressed. */
export function widgetMenuTemplate(pinned: boolean, actions: WidgetMenuActions, temporary = false): MenuItemConstructorOptions[] {
  const pin: MenuItemConstructorOptions[] = temporary
    ? []
    : [
        { label: "Pin on top", type: "checkbox", checked: pinned, click: () => actions.togglePin() },
        { type: "separator" },
      ];
  return [...pin, { label: "Open full window", click: () => actions.openWindow() }, { label: "Settings", click: () => actions.settings() }];
}
```

`apps/desktop/src/widgets/controller.ts` calls `planWidgets({ snapshot: current, view })`; make it compile by passing `raised: new Set()` for now (Task 7 replaces it).

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widgets && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/widgets/plan.ts apps/desktop/src/widgets/plan.test.ts apps/desktop/src/widgets/menu.ts apps/desktop/src/widgets/menu.test.ts apps/desktop/src/widgets/controller.ts
git commit -m "feat(desktop): in window view a raised pane wants a temporary widget, whose menu has no pin"
```

---

### Task 6: The page draws the cue and hides its pin

**Files:**
- Modify: `apps/desktop/src/widget/state.ts`, `apps/desktop/src/widget/page.ts`, `apps/desktop/src/widget/page.css`
- Test: `apps/desktop/src/widget/page.test.ts`

**Interfaces:**
- Consumes: `PanesScene.setFinished` (Task 1).
- Produces: `WidgetState.raised: boolean`, `WidgetState.temporary: boolean`. The page calls `scene.setFinished` with its pane's alias while `raised`, and `[]` otherwise; the pin is `hidden` while `temporary`.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/widget/page.test.ts`:

Change the `STATE` constant to `const STATE: WidgetState = { snapshot: snapshotOf("agent-1"), generation: 1, pinned: false, raised: false, temporary: false };`.

In `load()`'s stub `scene`, add after `clear`: `setFinished: (panes) => void drawn.push(`finished ${panes.join(",") || "-"}`),`.

Add inside `describe("the widget page", ...)`:

```ts
  it("tells the scene its pane has finished while raised, and that it has not once lowered", async () => {
    const page = await load();
    expect(page.drawn).toEqual(["snapshot 1 seated=true", "finished -"]);
    page.push({ ...STATE, raised: true });
    expect(page.drawn.at(-1)).toBe("finished pane-1");
    page.push({ ...STATE, raised: false });
    expect(page.drawn.at(-1)).toBe("finished -");
  });

  it("clears the cue with the scene when the generation changes, before the next snapshot is drawn", async () => {
    const page = await load({ ...STATE, raised: true });
    page.push({ ...STATE, generation: 2, raised: false });
    expect(page.drawn).toEqual(["snapshot 1 seated=true", "finished pane-1", "clear", "snapshot 1 seated=true", "finished -"]);
  });

  it("hides the pin for a temporary widget and shows it again for an ordinary one", async () => {
    const page = await load({ ...STATE, temporary: true });
    expect(page.pin.hidden).toBe(true);
    page.push({ ...STATE, temporary: false });
    expect(page.pin.hidden).toBe(false);
  });
```

The first existing test asserts `page.drawn` equals `["snapshot 1 seated=true"]`; change that expectation, and the one in "subscribes before it asks", to `["snapshot 1 seated=true", "finished -"]`. In "seats the sessions of its first snapshot at once, and walks later arrivals in" the expectation becomes `["snapshot 1 seated=true", "finished -", "snapshot 2 seated=false", "finished -"]`, and in "clears the scene when the generation changes" it becomes `["snapshot 1 seated=true", "finished -", "clear", "snapshot 1 seated=true", "finished -"]`. Any other test that asserts the whole of `drawn` gains a `"finished -"` after each `snapshot` entry.

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widget/page.test.ts`
Expected: FAIL: type errors on `raised`/`temporary`, and no `finished` entries.

- [ ] **Step 3: Implement**

`apps/desktop/src/widget/state.ts`: add to `WidgetState` after `pinned: boolean;`:

```ts
  /** A turn in this pane has finished and nobody has looked yet: the box is on top and drawn green. */
  raised: boolean;
  /** A popup in window view: made for the raise and gone once lowered. It has no pin. */
  temporary: boolean;
```

`apps/desktop/src/widget/page.ts`: replace `draw`:

```ts
  const draw = (state: WidgetState): void => {
    pin.setAttribute("aria-pressed", String(state.pinned));
    // A temporary widget goes when it is pressed; a pin on it would promise something it cannot keep.
    pin.hidden = state.temporary;
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
    // The snapshot holds this window's one pane, so that is the pane the cue names.
    scene.setFinished(state.raised ? state.snapshot.panes.map((p) => p.pane) : []);
  };
```

`apps/desktop/src/widget/page.css`: after the `#pin { ... }` rule add:

```css
/* A hidden pin stays hidden whatever the pointer does; the attribute would otherwise lose to the opacity rules below. */
#pin[hidden] { display: none; }
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widget && pnpm typecheck`
Expected: the page tests PASS. `pnpm typecheck` FAILS in `src/widgets/controller.ts` only (`stateOf` builds a `WidgetState` without the two fields); Task 7 is next and fixes it. Nothing else may fail.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/widget/state.ts apps/desktop/src/widget/page.ts apps/desktop/src/widget/page.css apps/desktop/src/widget/page.test.ts
git commit -m "feat(desktop): the widget page draws its pane green while raised and hides its pin while temporary"
```

---

### Task 7: The controller raises and lowers

**Files:**
- Modify: `apps/desktop/src/widgets/controller.ts`, `apps/desktop/src/window.ts`
- Test: `apps/desktop/src/widgets/controller.test.ts`

**Interfaces:**
- Consumes: `finishedTurns`, `stillRaising` (Task 2); `placeWidget`'s `stack` (Task 4); `planWidgets` with `raised`, `widgetMenuTemplate` with `temporary` (Task 5); `WidgetState.raised`/`temporary` (Task 6).
- Produces: `type WidgetLevel = "normal" | "pinned" | "raised"`; `WidgetWindow.setLevel(level: WidgetLevel): void` replaces `setPinned`; `ControllerDeps.windowFocused(): boolean`; `WidgetController.setPopup(on: boolean): void`.

The rules, so the code below can be read against them: a finish is recorded only while the popup is on, and, in window view, only while the full window is not focused; the raised set maps a label to the aliases holding it up, pruned on every snapshot with `stillRaising`; an entry is raised when its label is in the set and lowered when it is not; a press (the release of any press, in `dragEnd`) takes the label out of the set and lowers the entry, closing a temporary one at once; a generation rise, a view change, `noSource` and the popup going off empty the set; a temporary entry never pins.

- [ ] **Step 1: Change the fake window and the harness**

In `apps/desktop/src/widgets/controller.test.ts`:

Import `WidgetLevel` too: `import { CLOSE_CAP_MS, MAX_TRIES, createWidgetController, type ControllerDeps, type WidgetLevel, type WidgetWindow } from "./controller";`.

In `fakeWindow`, replace `setPinned: (on) => void calls.push(`pinned ${on}`),` with `setLevel: (level: WidgetLevel) => void calls.push(`level ${level}`),`.

In `harness`, add a focus flag: before `const c = createWidgetController({`, add `let focused = false;`; in the deps, after `primaryWorkArea`, add `windowFocused: () => focused,`; and in the returned object add `setFocused: (on: boolean) => (focused = on),`.

Replace every existing expectation of `"pinned true"` with `"level pinned"` and `"pinned false"` with `"level normal"` (three tests: "puts a folder's widget back where it was left, pinned if it was", "pins and unpins, remembers it with the place the window is in, and tells the page", "pops the menu on the window that asked, and its items do what they say"). In "pins and unpins" the pushed state is also checked: `toMatchObject({ pinned: true })` stays true.

- [ ] **Step 2: Write the failing tests**

Add at the end of `controller.test.ts`:

```ts
const BOTTOM: Bounds = { x: FIRST.x, y: AREA.height - DEFAULT_WIDGET_SIZE.height - SLOT_GAP, ...DEFAULT_WIDGET_SIZE };
/** TWO with repo's session idle: agent-1 finished its turn. */
const REPO_IDLE: Snapshot = { ...TWO, sessions: TWO.sessions.map((s) => (s.alias === "agent-1" ? { ...s, state: "idle" as const } : s)) };
const REPO_ASLEEP: Snapshot = { ...TWO, sessions: TWO.sessions.map((s) => (s.alias === "agent-1" ? { ...s, state: "asleep" as const } : s)) };

describe("the finished popup in widget view", () => {
  it("raises the pane's widget when a turn there finishes: the highest level, brought forward, drawn green, and logged", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", "reveal"]);
    expect(h.w(0).sent.at(-1)).toMatchObject({ raised: true, temporary: false });
    expect(h.w(1).calls).toEqual([]);
    expect(h.w(1).sent).toEqual([]);
    expect(h.logged).toEqual([["desktop.popupRaised", { temporary: false }]]);
  });

  it("raises nothing while the popup is off, and nothing from the first snapshot of a source", () => {
    const h = shown();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual([]);
    h.c.setPopup(true);
    // a new source: REPO_IDLE is its baseline, and agent-1 was never seen working under it
    h.c.setSnapshot(REPO_IDLE, "own:2");
    expect(h.w(0).calls).toEqual([]);
    expect(h.logged).toEqual([]);
  });

  it("lowers the widget when the session works or waits again, or leaves, and not when it falls asleep", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.setSnapshot(REPO_ASLEEP, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", "reveal"]);
    h.c.setSnapshot(TWO, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", "reveal", "level normal"]);
    expect(h.w(0).sent.at(-1)).toMatchObject({ raised: false });

    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls.at(-1)).toBe("reveal");
    h.c.setSnapshot(snap({ repo: [], docs: ["agent-2"] }), "own:1");
    expect(h.w(0).calls.at(-1)).toBe("level normal");
  });

  it("lowers the widget when it is pressed, back to pinned if it was pinned, and the next finish raises it again", () => {
    const h = shown();
    h.c.togglePin(h.w(0).win.id);
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual(["level pinned", "level raised", "reveal"]);
    h.c.dragStart(h.w(0).win.id);
    h.c.dragEnd(h.w(0).win.id);
    expect(h.w(0).calls).toEqual(["level pinned", "level raised", "reveal", "level pinned"]);
    expect(h.w(0).sent.at(-1)).toMatchObject({ raised: false, pinned: true });
    // still idle: pressing it was the answer, and no new turn has finished
    h.c.setSnapshot(REPO_ASLEEP, "own:1");
    expect(h.w(0).calls).toHaveLength(4);
    h.c.setSnapshot(TWO, "own:1");
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls.at(-2)).toBe("level raised");
  });

  it("raises a widget the full window's focus does not stop, in widget view", () => {
    const h = shown();
    h.setFocused(true);
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", "reveal"]);
  });

  it("lowers everything when the popup is switched off, and when the source changes", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.setPopup(false);
    expect(h.w(0).calls).toEqual(["level raised", "reveal", "level normal"]);

    h.c.setPopup(true);
    h.c.setSnapshot(TWO, "own:1");
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls.at(-1)).toBe("reveal");
    h.c.setSnapshot(REPO_IDLE, "attached:4750");
    expect(h.w(0).calls.at(-1)).toBe("level normal");
    expect(h.w(0).sent.at(-1)).toMatchObject({ generation: 2, raised: false });
  });
});

describe("the finished popup in window view", () => {
  /** Window view, the popup on, TWO as the baseline. */
  function windowView(over: Partial<ControllerDeps> = {}) {
    const h = harness(over);
    h.c.setPopup(true);
    h.c.setSnapshot(TWO, "own:1");
    return h;
  }

  it("makes a temporary widget for the pane at the bottom right, raised from the start, with no pin", () => {
    const h = windowView();
    expect(h.windows).toHaveLength(0);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.windows).toHaveLength(1);
    expect(h.w(0).win.bounds()).toEqual(BOTTOM);
    expect(h.w(0).calls).toEqual(["level raised"]);
    expect(h.logged).toEqual([["desktop.popupRaised", { temporary: true }]]);
    const state = h.c.ready(h.w(0).win.id);
    expect(state).toMatchObject({ raised: true, temporary: true, pinned: false });
    expect(state?.snapshot?.panes).toEqual([{ pane: "pane-1", label: "repo" }]);
    h.c.resize(h.w(0).win.id, DEFAULT_WIDGET_SIZE);
    expect(h.w(0).calls).toEqual(["level raised", `bounds ${BOTTOM.x},${BOTTOM.y} ${DEFAULT_WIDGET_SIZE.width}x${DEFAULT_WIDGET_SIZE.height}`, "reveal"]);
    h.c.menu(h.w(0).win.id);
    expect(h.w(0).menus[0]?.map((item) => item.label ?? item.type)).toEqual(["Open full window", "Settings"]);
    h.c.togglePin(h.w(0).win.id);
    expect(h.saved).toEqual([]);
    expect(h.w(0).calls).toHaveLength(3);
  });

  it("puts a temporary widget back where the folder's widget was left, if anywhere", () => {
    const h = windowView({ placement: (label) => (label === "repo" ? { x: 40, y: 60, pinned: true } : undefined) });
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).win.bounds()).toEqual({ x: 40, y: 60, ...DEFAULT_WIDGET_SIZE });
    // the remembered pin is not honoured: a temporary widget has no pin, and its level is raised anyway
    expect(h.w(0).calls).toEqual(["level raised"]);
  });

  it("makes none while the full window is focused, and does not pop it up later when the focus moves", () => {
    const h = windowView();
    h.setFocused(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.windows).toHaveLength(0);
    h.setFocused(false);
    h.c.setSnapshot(REPO_ASLEEP, "own:1");
    expect(h.windows).toHaveLength(0);
    expect(h.logged).toEqual([]);
  });

  it("closes a temporary widget at once when it is pressed, remembering a drag first, and does not remake it", () => {
    const h = windowView();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    const id = h.w(0).win.id;
    h.c.ready(id);
    h.c.resize(id, DEFAULT_WIDGET_SIZE);
    h.setCursor(BOTTOM.x, BOTTOM.y);
    h.c.dragStart(id);
    h.setCursor(BOTTOM.x - 100, BOTTOM.y - 50);
    h.c.dragMove(id);
    h.c.dragEnd(id);
    expect(h.saved).toEqual([["repo", { x: BOTTOM.x - 100, y: BOTTOM.y - 50, pinned: false }]]);
    expect(h.w(0).calls.at(-1)).toBe("close");
    h.c.setSnapshot(REPO_ASLEEP, "own:1");
    expect(h.windows).toHaveLength(1);
  });

  it("walks a temporary widget out and closes it when the session is prompted again or leaves", () => {
    const h = windowView();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    const id = h.w(0).win.id;
    h.c.ready(id);
    h.c.setSnapshot(TWO, "own:1");
    expect(h.w(0).sent.at(-1)?.snapshot).toMatchObject({ panes: [], sessions: [] });
    expect(h.w(0).calls.at(-1)).toBe("level normal");
    h.c.resize(id, null);
    expect(h.w(0).calls.at(-1)).toBe("close");
  });

  it("closes a temporary widget after the cap when the popup is switched off", () => {
    const h = windowView();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.setPopup(false);
    vi.advanceTimersByTime(CLOSE_CAP_MS);
    expect(h.w(0).calls.at(-1)).toBe("close");
    expect(h.windows).toHaveLength(1);
  });

  it("closes the temporary widgets when the view changes to widgets, and the ordinary ones then open unraised", () => {
    const h = windowView();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.setView("widgets");
    expect(h.w(0).calls.at(-1)).toBe("close");
    expect(h.windows).toHaveLength(3);
    expect(h.c.ready(h.w(1).win.id)).toMatchObject({ raised: false, temporary: false });
  });

  it("raises a temporary widget for a second pane too, above the first", () => {
    const h = windowView();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    const both: Snapshot = { ...REPO_IDLE, sessions: REPO_IDLE.sessions.map((s) => ({ ...s, state: "idle" as const })) };
    h.c.setSnapshot(both, "own:1");
    expect(h.windows).toHaveLength(2);
    expect(h.w(1).win.bounds()).toEqual({ ...BOTTOM, y: BOTTOM.y - DEFAULT_WIDGET_SIZE.height - SLOT_GAP });
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/widgets/controller.test.ts`
Expected: FAIL to compile (`setPopup`, `windowFocused`, `setLevel` unknown).

- [ ] **Step 4: Rewrite the controller**

Replace `apps/desktop/src/widgets/controller.ts` with:

```ts
// The widgets' controller: which windows exist, what each was last sent, where each is, which are
// raised, and what a page may ask of main. One window per pane, keyed by the pane's label, which
// outlives an agent restart where its alias does not. Electron-free: main hands in a window
// factory, the cursor, the displays and whether the full window has the keyboard, so every rule
// here is tested over doubles.
import type { Logger } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import type { MenuItemConstructorOptions } from "electron";
import type { Bounds, Placement, View } from "../desktop-state";
import type { WidgetSize, WidgetState } from "../widget/state";
import { finishedTurns, stillRaising } from "./finished";
import { widgetMenuTemplate } from "./menu";
import { DEFAULT_WIDGET_SIZE, clampDrop, placeWidget } from "./placement";
import { emptied, paneSnapshot, planWidgets } from "./plan";

/** How a widget sits among other windows: an ordinary window; above ordinary ones, pinned; above everything, raised. Each is a band, not a nudge. */
export type WidgetLevel = "normal" | "pinned" | "raised";

/** A widget's window, as much of it as the controller uses. `window.ts` fits a BrowserWindow to it. */
export type WidgetWindow = {
  /** The id of the window's webContents: how a message's sender is matched to its window. */
  readonly id: number;
  bounds(): Bounds;
  setBounds(bounds: Bounds): void;
  setLevel(level: WidgetLevel): void;
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
  /** Whether the full window has the keyboard: then the maintainer is already looking, and no popup is made. */
  windowFocused(): boolean;
  /** A Clawd was clicked: the full window, on that session. */
  openSession(alias: string): void;
  openWindow(): void;
  openSettings(): void;
  log: Logger;
};

export type WidgetController = {
  setView(view: View): void;
  /** Whether a finished turn raises its pane's box. Off lowers every raised one. */
  setPopup(on: boolean): void;
  /** `source` names the agent the snapshot came from (`own:<run>`, `attached:<port>`); a new name is a new generation. */
  setSnapshot(s: Snapshot, source: string): void;
  /** There is no agent to hear from: the Clawds walk out, same as any pane that leaves, and what is shown goes after the cap. */
  noSource(): void;
  /** Brings every widget already shown forward; answers how many are showing. */
  showAll(): number;
  closeAll(): void;
  /**
   * Closes every window and ignores everything after: snapshots, view changes and page calls that
   * would make a window. For the quit, when the agent may still emit.
   */
  shutdown(): void;
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
  /** Its label is in the raised set: on top at the highest level and drawn green. */
  raised: boolean;
  /** A popup in window view: made for a raise, closed once lowered, never pinned. */
  temporary: boolean;
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

/**
 * A state as text, less the time the snapshot was made, which changes with every snapshot and draws
 * nothing. Compares JSON text, which is order-sensitive: the attached feed's snapshots are normalised
 * by core's SnapshotSchema.parse (through fetchSnapshot), and the app's own agent's arrive in-process
 * from core's builder, unparsed, whose key order is stable too; paneSnapshot/emptied spread that same
 * object either way, so key order never drifts in practice. The worst case of a differently ordered
 * snapshot is one extra push, not a wrong one.
 */
const keyOf = (state: WidgetState): string => JSON.stringify({ ...state, snapshot: state.snapshot === null ? null : { ...state.snapshot, generatedAt: "" } });

const levelOf = (e: Entry): WidgetLevel => (e.raised ? "raised" : e.pinned ? "pinned" : "normal");

export function createWidgetController(deps: ControllerDeps): WidgetController {
  let view: View = "window";
  let popup = false;
  let snapshot: Snapshot | null = null;
  /** The snapshot before `snapshot`, from the same source: what a finish is measured against. Null at a source's first. */
  let previous: Snapshot | null = null;
  let source: string | null = null;
  let generation = 0;
  // Set by shutdown, for the quit: once true, nothing here opens a window again.
  let down = false;
  const entries = new Map<string, Entry>();
  const tries = new Map<string, number>();
  /** The panes where a turn has finished and nobody has looked: the label, and the sessions holding the raise. */
  const raised = new Map<string, Set<string>>();

  const bySender = (sender: number): Entry | undefined => {
    for (const e of entries.values()) if (e.win.id === sender) return e;
    return undefined;
  };

  const stateOf = (e: Entry): WidgetState => ({ snapshot: e.shown, generation, pinned: e.pinned, raised: e.raised, temporary: e.temporary });

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

  const open = (label: string, pane: string, temporary: boolean): Entry | undefined => {
    if ((tries.get(label) ?? 0) >= MAX_TRIES) return undefined;
    const remembered = deps.placement(label);
    const bounds = placeWidget({
      remembered,
      size: DEFAULT_WIDGET_SIZE,
      workAreas: deps.workAreas(),
      primary: deps.primaryWorkArea(),
      taken: [...entries.values()].map((other) => other.win.bounds()),
      // A popup comes up from the bottom right, away from where the widgets stack.
      stack: temporary ? "up" : "down",
    });
    const win = deps.createWindow(bounds);
    // A temporary widget has no pin, so a remembered one is not honoured; its level is raised anyway.
    const pinned = !temporary && (remembered?.pinned ?? false);
    const e: Entry = { label, win, pane, size: DEFAULT_WIDGET_SIZE, pinned, raised: false, temporary, ready: false, revealed: false, shown: null, sent: "", closing: null, drag: null };
    entries.set(label, e);
    if (pinned) win.setLevel("pinned");
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

  /** Puts an entry's level where the raised set says, and brings a newly raised one forward. Called before its push, so the page hears of it in the same state. */
  const settleLevel = (e: Entry): void => {
    const shouldRaise = raised.has(e.label);
    if (shouldRaise === e.raised) return;
    e.raised = shouldRaise;
    e.win.setLevel(levelOf(e));
    if (!shouldRaise) return;
    deps.log("desktop.popupRaised", { temporary: e.temporary });
    // Not yet revealed: the first size report shows it, raised already.
    if (e.revealed) e.win.reveal();
  };

  const reconcile = (leaving: Snapshot | null = snapshot): void => {
    if (down) return;
    const current = snapshot;
    const wanted = new Set<string>();
    if (current !== null) {
      for (const w of planWidgets({ snapshot: current, view, raised: new Set(raised.keys()) })) {
        const e = entries.get(w.label) ?? open(w.label, w.pane, w.temporary);
        if (e === undefined) continue;
        wanted.add(w.label);
        if (e.closing !== null) clearTimeout(e.closing);
        e.closing = null;
        e.pane = w.pane;
        e.shown = paneSnapshot(current, w.pane);
        settleLevel(e);
        push(e);
      }
    }
    for (const e of [...entries.values()]) {
      if (wanted.has(e.label)) continue;
      // Its pane has left (or there is no source at all): the page plays the walk out and then says it has nothing left to draw.
      settleLevel(e);
      if (leaving !== null) {
        e.shown = emptied(leaving);
        push(e);
      }
      if (e.closing === null) e.closing = setTimeout(() => close(e), CLOSE_CAP_MS);
    }
  };

  const closeAll = (): void => {
    for (const e of [...entries.values()]) close(e);
  };

  /** Forgets every raise. The entries follow on the next reconcile. */
  const lowerAll = (): void => {
    raised.clear();
  };

  /**
   * A press on a raised box lowers it: the maintainer has looked. The label leaves the set, so the
   * next snapshot does not raise it again, until a new turn finishes there. A temporary widget goes
   * at once; an ordinary one drops to its own level where it stands.
   */
  const lowerByPress = (e: Entry): void => {
    if (!e.raised) return;
    raised.delete(e.label);
    if (e.temporary) {
      close(e);
      return;
    }
    e.raised = false;
    e.win.setLevel(levelOf(e));
    push(e);
  };

  const togglePin = (e: Entry): void => {
    // The menu's closure may outlive its entry.
    if (entries.get(e.label) !== e) return;
    // A temporary widget goes when it is pressed; a pin on it would promise something it cannot keep.
    if (e.temporary) return;
    e.pinned = !e.pinned;
    e.win.setLevel(levelOf(e));
    // A pinned widget should be where it was pinned next time too, dragged or not.
    const b = e.win.bounds();
    deps.savePlacement(e.label, { x: b.x, y: b.y, pinned: e.pinned });
    push(e);
  };

  return {
    setView(next) {
      if (down) return;
      if (next === view) return;
      view = next;
      // A raise belongs to the view it happened in: never carried across, and never a popup left behind.
      lowerAll();
      closeAll();
      if (view === "widgets") reconcile();
    },
    setPopup(on) {
      if (on === popup) return;
      popup = on;
      if (on) return;
      lowerAll();
      reconcile();
    },
    setSnapshot(s, from) {
      if (from !== source) {
        source = from;
        generation++;
        // A new agent: its aliases and states owe nothing to the last one's, so nothing has finished and nothing is raised.
        previous = null;
        lowerAll();
      }
      if (popup) {
        for (const turn of finishedTurns(previous, s)) {
          // In window view the box would pop up over what the maintainer is looking at; a finish seen then is a finish seen.
          if (view === "window" && deps.windowFocused()) continue;
          const holders = raised.get(turn.label) ?? new Set<string>();
          holders.add(turn.alias);
          raised.set(turn.label, holders);
        }
      }
      // A raise holds while any of its sessions is neither working nor waiting again, and still there.
      for (const [label, holders] of [...raised]) {
        const kept = stillRaising(holders, s);
        if (kept.size === 0) raised.delete(label);
        else raised.set(label, kept);
      }
      previous = s;
      snapshot = s;
      reconcile();
    },
    noSource() {
      const leaving = snapshot;
      source = null;
      snapshot = null;
      previous = null;
      lowerAll();
      reconcile(leaving);
    },
    showAll() {
      let showing = 0;
      for (const e of entries.values()) {
        if (!e.revealed || e.closing !== null) continue;
        e.win.reveal();
        showing++;
      }
      return showing;
    },
    closeAll,
    shutdown() {
      down = true;
      closeAll();
    },
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
      if (moved) {
        const b = e.win.bounds();
        const kept = clampDrop({ x: b.x, y: b.y, ...e.size }, deps.workAreas());
        if (kept.x !== b.x || kept.y !== b.y) e.win.setBounds(kept);
        deps.savePlacement(e.label, { x: kept.x, y: kept.y, pinned: e.pinned });
      }
      // Every press ends here, moved or not: the one place a press lowers anything. After the save, so a moved popup is remembered before it goes.
      lowerByPress(e);
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
      e.win.popupMenu(widgetMenuTemplate(e.pinned, { togglePin: () => togglePin(e), openWindow: deps.openWindow, settings: deps.openSettings }, e.temporary));
    },
  };
}
```

- [ ] **Step 5: The window adapter**

In `apps/desktop/src/window.ts`, add `WidgetLevel` to the import from `./widgets/controller` (`import type { WidgetLevel, WidgetWindow } from "./widgets/controller";`) and replace the `setPinned` member of `asWidgetWindow` with:

```ts
    // Levels are bands, not nudges. "raised" is `screen-saver`, the highest, above a pinned widget,
    // a maximised window and the taskbar; "pinned" is `floating`, above ordinary windows; "normal" is
    // one of them. A raised widget is topmost, so it needs no toggle to come forward from the background.
    setLevel: (level) => {
      if (win.isDestroyed()) return;
      if (level === "normal") win.setAlwaysOnTop(false);
      else win.setAlwaysOnTop(true, level === "raised" ? "screen-saver" : "floating");
    },
```

- [ ] **Step 6: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/widgets && pnpm typecheck`
Expected: the controller tests PASS (43, the 29 there were plus 14). `pnpm typecheck` FAILS in `src/main.ts` only, on the missing `windowFocused` dependency; Task 9 adds it. Nothing else may fail.

If a test's expected `calls` sequence differs from what you see, read the sequence against the rules at the top of this task before touching either; a wrong expectation is possible, a wrong rule is a defect. Record which in the report.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/widgets/controller.ts apps/desktop/src/widgets/controller.test.ts apps/desktop/src/window.ts
git commit -m "feat(desktop): the controller raises a pane's widget when a turn there finishes, makes a temporary one in window view, and lowers it on a press or the next prompt, through one setLevel"
```

---

### Task 8: The popup setting

**Files:**
- Modify: `apps/desktop/src/settings/state.ts`, `channels.ts`, `preload.ts`, `ipc.ts`, `actions.ts`, `page.ts`
- Modify: `apps/desktop/src/settings-state.ts`, `apps/desktop/src/main.ts`
- Test: `apps/desktop/src/settings/ipc.test.ts`, `actions.test.ts`, `page.test.ts`, `apps/desktop/src/settings-state.test.ts`

**Interfaces:**
- Consumes: `DesktopState.finishedPopup` (Task 3); the log code `desktop.popupChanged`.
- Produces: `SettingsState.finishedPopup: boolean`; `SettingsApi.setFinishedPopup(on: boolean): Promise<SettingsState>`; `CHANNELS.setFinishedPopup`; `ActionDeps.applyPopup(on: boolean): boolean`; `SettingsInput.finishedPopup`. The page's control is a radio pair, off or on, in the View section under the view radios.

This task mirrors how `view` went through in stage 9's Task 13: the same files, the same shape. After it the choice is shown, saved and logged; Task 9 hands it to the controller.

- [ ] **Step 1: Write the failing tests**

Every `SettingsState` literal in the tests gains the field. In `apps/desktop/src/settings/ipc.test.ts`, `actions.test.ts` and `page.test.ts`, add to the `STATE` constant after `view: "window",`:

```ts
  finishedPopup: false,
```

In `apps/desktop/src/settings-state.test.ts`, add `finishedPopup: true,` to `INPUT` after `view: "widgets" as const,`, and `finishedPopup: true,` to the first test's expected object after `view: "widgets",`.

In `apps/desktop/src/settings/ipc.test.ts`, add to the `base` actions after `setView`:

```ts
    setFinishedPopup: async (on) => {
      calls.push(`setFinishedPopup ${on}`);
      return STATE;
    },
```

and inside the file's `describe`:

```ts
  it("passes the popup choice on, and answers anything that is not a boolean with the state as it is", async () => {
    const { calls, handlers } = actions();
    await handlers[CHANNELS.setFinishedPopup]!(true);
    await handlers[CHANNELS.setFinishedPopup]!(false);
    expect(await handlers[CHANNELS.setFinishedPopup]!("yes")).toEqual(STATE);
    expect(calls).toEqual(["setFinishedPopup true", "setFinishedPopup false"]);
  });
```

In `apps/desktop/src/settings/actions.test.ts`, add to the harness's `deps` after `applyView`:

```ts
    applyPopup: (on) => {
      calls.push(`popup ${on}`);
      return true;
    },
```

and inside `describe("createSettingsActions", ...)`:

```ts
  it("applies the popup choice, logs it, and restarts nothing", async () => {
    const { calls, codes, fields, actions } = harness();
    expect(await actions.setFinishedPopup(true)).toEqual(STATE);
    expect(calls).toEqual(["popup true"]);
    expect(codes).toEqual(["desktop.popupChanged"]);
    expect(fields).toEqual([{ on: true, remembered: true }]);
  });

  it("says so when the popup choice holds for this run only, and where to look when it could not be applied", async () => {
    const held = harness({ applyPopup: () => false });
    expect((await held.actions.setFinishedPopup(false)).notice).toBe(VIEW_NOT_REMEMBERED);
    expect(held.fields).toEqual([{ on: false, remembered: false }]);
    const broken = harness({
      applyPopup: () => {
        throw new Error("no store");
      },
    });
    expect((await broken.actions.setFinishedPopup(true)).notice).toContain("see the log");
    expect(broken.fields).toEqual([{ on: true, failed: true }]);
  });
```

In `apps/desktop/src/settings/page.test.ts`, add to the stub `api` in `load()` after `setView`:

```ts
    setFinishedPopup: async () => initial,
```

and inside `describe("the settings page", ...)`:

```ts
  it("offers the popup as an off/on pair in the View section, asks main for the one chosen, and keeps the view radios where they were", async () => {
    const asked: boolean[] = [];
    await load({
      setFinishedPopup: async (on) => {
        asked.push(on);
        return { ...STATE, finishedPopup: on };
      },
    });
    expect(radio("popup:off").checked).toBe(true);
    expect(radio("popup:off").closest("section")?.querySelector("h2")?.textContent).toBe("View");
    choose("popup:on");
    await flush();
    expect(asked).toEqual([true]);
    expect(radio("popup:on").checked).toBe(true);
    expect(radio("view:window").checked).toBe(true);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run from `apps/desktop`: `npx vitest run src/settings src/settings-state.test.ts`
Expected: FAIL: no `setFinishedPopup` handler or action, no `popup:off` control, and `settingsState` carries no `finishedPopup`.

- [ ] **Step 3: Implement**

`apps/desktop/src/settings/state.ts`: add to `SettingsState` after `view: "window" | "widgets";`:

```ts
  /** Whether a finished turn pops its pane's box up over everything until it is looked at. */
  finishedPopup: boolean;
```

and to `SettingsApi` after `setView`:

```ts
  setFinishedPopup(on: boolean): Promise<SettingsState>;
```

`apps/desktop/src/settings/channels.ts`: after the `setView` line:

```ts
  setFinishedPopup: "clawd:settings/setFinishedPopup",
```

`apps/desktop/src/settings/preload.ts`: after the `setView` line:

```ts
  setFinishedPopup: (on: boolean) => invoke<SettingsState>(CHANNELS.setFinishedPopup, on),
```

`apps/desktop/src/settings/ipc.ts`: after the `setView` line:

```ts
    [CHANNELS.setFinishedPopup]: checked(z.boolean(), (on) => actions.setFinishedPopup(on)),
```

`apps/desktop/src/settings-state.ts`: add `finishedPopup: boolean;` to `SettingsInput` after `view: View;`, and `finishedPopup: input.finishedPopup,` to the returned object after `view: input.view,`.

`apps/desktop/src/settings/actions.ts`: in `ActionDeps`, after `applyView`:

```ts
  /** Applies the popup choice now and remembers it. False when desktop.json could not be read at launch: the choice then holds for this run only. */
  applyPopup(on: boolean): boolean;
```

Change the comment on `VIEW_NOT_REMEMBERED` (add one above it if there is none): `/** For either View choice: the view, and the popup. */`. In the returned object, after `setView`:

```ts
    async setFinishedPopup(on) {
      let remembered: boolean;
      try {
        remembered = deps.applyPopup(on);
      } catch {
        deps.log("desktop.popupChanged", { on, failed: true });
        return answer(`the popup setting could not be changed; ${SEE_LOG}`);
      }
      deps.log("desktop.popupChanged", { on, remembered });
      return answer(remembered ? null : VIEW_NOT_REMEMBERED);
    },
```

`apps/desktop/src/settings/page.ts`: after `type Mode = SettingsState["view"];` add `type Popup = "off" | "on";`. After `MODE_CHOICES` add:

```ts
const POPUP_CHOICES: readonly { value: Popup; label: string }[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on: a finished turn pops its box up over everything until it is clicked or prompted again" },
];
```

In `SECTION_OF` add `popup: "view",`. In the `View` type add `popup: Choices<Popup>;` after `mode: Choices<Mode>;`. In `build()`, after the `mode` line:

```ts
  const popup = choices<Popup>("popup", "Pop a box up when a turn finishes", POPUP_CHOICES, (value) => window.clawd.setFinishedPopup(value === "on"));
```

change the View section to `section("View", [mode.group, popup.group], notices.get("view")),` and add `popup` to the returned object. In `render()`, after the `check(v.mode, ...)` line:

```ts
  check(v.popup, "popup", state.finishedPopup ? "on" : "off", answered);
```

`apps/desktop/src/main.ts`: in `currentState()`, after `view: store.get().view ?? "window",`:

```ts
      finishedPopup: store.get().finishedPopup ?? false,
```

and in `createSettingsActions({...})`, after `applyView,`:

```ts
    // Remembered here; Task 9 hands it to the widgets' controller too.
    applyPopup: (on) => {
      store.update({ finishedPopup: on });
      return store.usable();
    },
```

- [ ] **Step 4: Run the tests to see them pass**

Run from `apps/desktop`: `npx vitest run src/settings src/settings-state.test.ts && pnpm typecheck`
Expected: the settings tests PASS; `pnpm typecheck` still FAILS in `src/main.ts` on `windowFocused` only (Task 9). Nothing else.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings apps/desktop/src/settings-state.ts apps/desktop/src/settings-state.test.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): the settings window offers the finished popup, off or on, under the view, and remembers it"
```

---

### Task 9: The wiring

**Files:**
- Modify: `apps/desktop/src/main.ts`

**Interfaces:**
- Consumes: `WidgetController.setPopup`, `ControllerDeps.windowFocused` (Task 7); `feedPort(host, view, popup)` (Task 3); `applyPopup` (Task 8).

All in `apps/desktop/src/main.ts`; it has no tests, and every rule it calls has.

- [ ] **Step 1: The popup setting, read fresh**

After the `view` function (`const view = (): View => store.get().view ?? "window";`) add:

```ts
  /** Whether a finished turn pops its box up. Read fresh, as `view` is. */
  const popup = (): boolean => store.get().finishedPopup ?? false;
```

- [ ] **Step 2: The controller's new dependency**

In `createWidgetController({...})`, after `primaryWorkArea`:

```ts
    // The maintainer is already looking at the full window: no popup is made over it.
    windowFocused: () => win !== null && !win.isDestroyed() && win.isFocused(),
```

- [ ] **Step 3: The feed follows the popup too**

In `followFeed`, change `feedPort(host.state(), view(), false)` to `feedPort(host.state(), view(), popup())` and remove the `// Task 9 passes the popup setting.` comment. Change the comment above the `noSource` line from `Leaving widget view while attached stops the feed` to `Leaving widget view, or turning the popup off, while attached stops the feed`.

- [ ] **Step 4: Applying the choice**

Replace the inline `applyPopup` dependency Task 8 wrote in `createSettingsActions({...})` with a named function declared beside `applyView`, passed by name (`applyPopup,`):

```ts
  /** The popup choice, from the settings window: remembered, applied at once, and answered with whether it could be remembered. Off lowers every raised box. */
  function applyPopup(on: boolean): boolean {
    store.update({ finishedPopup: on });
    widgets.setPopup(on);
    followFeed();
    return store.usable();
  }
```

- [ ] **Step 5: Startup**

In the `whenReady` block, just before `widgets.setView(view());`, add:

```ts
    widgets.setPopup(popup());
```

- [ ] **Step 6: Check it compiles and every test passes**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

- [ ] **Step 7: Run it**

Use scratch folders, never the real `~/.clawd`. From the repository root in Git Bash:

```bash
unset ELECTRON_RUN_AS_NODE
export CLAWD_HOME="$TEMP\\clawd-stage10"
export CLAUDE_CONFIG_DIR="$TEMP\\clawd-stage10-claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
pnpm --filter @clawd/desktop start
```

If you can run a GUI and a Claude session (Settings → add a folder → Install hooks; then in a terminal with the same three lines, `claude` in that folder and a prompt): Settings → View → popup **on**; leave the full window unfocused (click an editor); send a prompt to the session and wait for its answer. Expected: as the turn finishes, a box for that folder rises at the bottom right over the editor, border and title green, without taking the keyboard; a click on it closes it; a second prompt and answer raise it again; with the full window focused instead, nothing appears. Then View → widgets: the same finish turns that folder's widget green and brings it to the top; the next prompt lowers it. Quit from the tray.

If you cannot run a GUI or a session, say exactly which of these you did not see: they are all in Task 10's checklist for the maintainer. Do not claim them. Make sure no `electron.exe` is left running (`tasklist //FI "IMAGENAME eq electron.exe"`).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): the finished popup: main tells the controller the setting and whether the full window has the keyboard, and the attached feed runs for it"
```

---

### Task 10: The documents, the package, and the maintainer's checklist

**Files:**
- Modify: `apps/desktop/README.md`, `docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`, `docs/PRD.md`

- [ ] **Step 1: The desktop README**

In `apps/desktop/README.md`, after the `**Widget view.**` paragraph in the Run section, add:

```markdown
**The finished popup.** Under View, *Pop a box up when a turn finishes* raises a folder's box over
every other window, drawn green, the moment a session there stops working, without taking the
keyboard: in widget view the folder's own widget, in window view a temporary box at the bottom right
that has no pin and goes when it is clicked. Nothing pops up while the full window has the focus,
since you are already looking. A raised box goes down when you click it, or when that session is
prompted again; it stays up while the session sleeps, so a turn that finished while you were away is
still there when you come back. Off by default.
```

After the `### Stage 9: widgets` note and its paragraphs, add:

```markdown
### Stage 10: the finished popup

`docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`, §3.3. A turn finishing raises its box.

**Window levels.** `setAlwaysOnTop(true, level)` puts a window in a band. A pinned widget sits in
`floating`, above ordinary windows; a raised one in `screen-saver`, the highest, above a pinned
widget, a maximised window and the taskbar. Lowering is a change of band, `setAlwaysOnTop(false)`
or back to `floating`, and the window stays where it is. The controller's window has one call for
this, `setLevel`, so pinned and raised cannot disagree.

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
```

- [ ] **Step 2: The spec**

In `docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`:

- §3.1: replace `- A checkbox, **Pop a box up when a turn finishes**.` with `- A second radio pair, off or on, **Pop a box up when a turn finishes**: the page has radio groups and no checkbox control, and one kind of control reads better than two (decided in stage 10's plan).`
- §3.3, the **In window view** bullet: after `None is made while the full window is focused, since the maintainer is already looking at it.` add ` The check is made when the turn finishes: a finish seen then is a finish seen, and nothing pops up later when the focus moves.`
- §3.3, the **Afterwards** bullet: replace `and a temporary one closes.` with `and a temporary one closes: at once when a press lowered it, after its Clawds walk out when the session being prompted again or leaving did.`
- §6, the file list: `plan.ts` becomes `plan.ts         which windows should exist: (snapshot, view, raised) → [{ label, pane, temporary }]; the popup setting and the focus are the controller's, at trigger time`.
- §6, after the **Dragging in main** bullet, add: `- **The raised set.** The controller keeps, per label, the sessions holding a raise. A finish adds one (unless in window view with the full window focused); every snapshot prunes each label with `stillRaising` and drops it when empty; a press on the box, the release of any press, takes its label out; a generation rise, a change of view, `noSource` and the popup going off empty the set. An entry's level follows the set through one `setLevel(normal | pinned | raised)`, which replaced `setPinned`; a temporary entry is never pinned.`
- §10.1's paragraph stays. Add after it:

```markdown
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
- [ ] Widget view, popup on: a finish turns that folder's widget green and brings it above a maximised window; a pinned widget turns green too; the raised widget sits above a pinned one.
- [ ] A click on the raised widget lowers it: a pinned one stays pinned, an unpinned one becomes ordinary and stays where it is.
- [ ] The next prompt in that session lowers it without a click.
- [ ] Popup off in Settings: every raised box lowers; a temporary one walks out and closes.
- [ ] Quit and relaunch with a session still idle: nothing is raised (the first snapshot is the baseline).
- [ ] Attached (the CLI agent holding the port), window view, popup on: the box still pops up within a second or so of the finish.
- [ ] The log holds `desktop.popupChanged` with `on` and `remembered`, and `desktop.popupRaised` with `temporary`, and no folder name.
- [ ] With boxes raised, Quit from the tray: every box goes and no `electron.exe` remains.
```

- [ ] **Step 3: The PRD**

In `docs/PRD.md`'s decision log, after the `21 Sep 2026 | Desktop widgets` row, add:

```markdown
| 22 Sep 2026 | The finished popup raises a box by window level (`screen-saver` above the pinned `floating`), never by a z-order move, since Windows refuses those from a background process; the full window's focus at the moment of the finish decides whether a popup is made; a press lowers a temporary box by closing it at once. |
```

- [ ] **Step 4: Package it and run the smoke**

Run from the repository root:

```bash
unset ELECTRON_RUN_AS_NODE
pnpm --filter @clawd/desktop package
pnpm --filter @clawd/desktop smoke
```

Expected: the package builds and the smoke passes. The earlier packaged build in `release/` is replaced, which is intended: the checklist is walked on this one.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/README.md docs/superpowers/specs/2026-09-21-desktop-widgets-design.md docs/PRD.md
git commit -m "docs: stage 10's Electron ideas in the desktop README, the popup's decisions in the spec and the PRD, and the checks the maintainer has still to walk"
```

- [ ] **Step 6: Report**

Say what was built, what `pnpm test`, `pnpm typecheck`, the package and the smoke printed, and which hands-on steps (Task 9 Step 7) you could not do. The stage is not done until the maintainer has walked §10.2; do not mark it done, do not merge, and do not push.

