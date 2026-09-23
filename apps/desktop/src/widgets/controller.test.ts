import type { LogFields } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import type { MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bounds, Placement } from "../desktop-state";
import type { WidgetState } from "../widget/state";
import { CLOSE_CAP_MS, MAX_TRIES, createWidgetController, type ControllerDeps, type WidgetLevel, type WidgetWindow } from "./controller";
import { DEFAULT_WIDGET_SIZE, SLOT_GAP } from "./placement";

const AREA: Bounds = { x: 0, y: 0, width: 1920, height: 1040 };
const FIRST: Bounds = { x: AREA.width - DEFAULT_WIDGET_SIZE.width - SLOT_GAP, y: SLOT_GAP, ...DEFAULT_WIDGET_SIZE };
const SECOND: Bounds = { ...FIRST, y: FIRST.y + DEFAULT_WIDGET_SIZE.height + SLOT_GAP };

const at = (ms: number): string => new Date(ms).toISOString();
const move = (b: Bounds): string => `bounds ${b.x},${b.y} ${b.width}x${b.height}`;

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

type FakeWindow = { win: WidgetWindow; calls: string[]; sent: WidgetState[]; menus: MenuItemConstructorOptions[][]; fail(): void; closedByUser(): void; backFails(): void };

function fakeWindow(id: number, initial: Bounds): FakeWindow {
  let bounds = initial;
  let failed: () => void = () => {};
  let closed: () => void = () => {};
  let backWorks = true;
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
    setLevel: (level: WidgetLevel) => void calls.push(`level ${level}`),
    reveal: () => void calls.push("reveal"),
    sendToBack: () => {
      calls.push("back");
      return backWorks;
    },
    send: (state) => void sent.push(state),
    popupMenu: (template) => void menus.push(template),
    close: () => {
      calls.push("close");
      // Electron's closed event is asynchronous; tests fire it themselves with closedByUser() when they mean it.
    },
    onFailed: (cb) => {
      failed = cb;
    },
    onClosed: (cb) => {
      closed = cb;
    },
  };
  return { win, calls, sent, menus, fail: () => failed(), closedByUser: () => closed(), backFails: () => (backWorks = false) };
}

function harness(over: Partial<ControllerDeps> = {}) {
  const windows: FakeWindow[] = [];
  const saved: Array<[string, Placement]> = [];
  const opened: string[] = [];
  const focused_: string[] = [];
  const logged: Array<[string, LogFields]> = [];
  let cursor = { x: 0, y: 0 };
  let focused = false;
  const c = createWidgetController({
    createWindow: (bounds) => {
      const made = fakeWindow(100 + windows.length, bounds);
      windows.push(made);
      return made.win;
    },
    cursor: () => cursor,
    workAreas: () => [AREA],
    primaryWorkArea: () => AREA,
    windowFocused: () => focused,
    placement: () => undefined,
    savePlacement: (label, placement) => void saved.push([label, placement]),
    focusSession: (alias) => void focused_.push(alias),
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
  return { c, windows, w, saved, opened, focused: focused_, logged, setCursor: (x: number, y: number) => (cursor = { x, y }), setFocused: (on: boolean) => (focused = on) };
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
    expect(h.w(0).calls).toContain("level pinned");
    expect(h.w(1).win.bounds()).toEqual(FIRST);
    expect(h.w(1).calls).not.toContain("level pinned");
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

  it("a late closed event from a window already replaced leaves the replacement alone", () => {
    const h = shown();
    h.c.setSnapshot(snap({ docs: ["agent-2"] }), "own:1"); // a snapshot without repo
    vi.advanceTimersByTime(CLOSE_CAP_MS); // w0 closed, entry dropped
    h.c.setSnapshot(TWO, "own:1"); // a new window, w2, for repo
    h.w(0).closedByUser(); // a late closed event from the original, now-stale window
    expect(h.c.ready(h.w(2).win.id)).not.toBeNull();
    expect(h.windows).toHaveLength(3);
  });

  it("a late failure from a window already replaced is not counted", () => {
    const h = shown();
    h.c.setSnapshot(snap({ docs: ["agent-2"] }), "own:1"); // a snapshot without repo
    vi.advanceTimersByTime(CLOSE_CAP_MS); // w0 closed, entry dropped
    h.c.setSnapshot(TWO, "own:1"); // a new window, w2, for repo
    h.w(0).fail(); // a late failure from the original, now-stale window
    expect(h.logged).toEqual([]);
    expect(h.w(2).calls).not.toContain("close");
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

  it("a page that asks again is sent the next change", () => {
    const h = shown();
    h.c.ready(h.w(0).win.id); // a reload keeps the webContents id
    h.c.setSnapshot(snap({ repo: ["agent-1", "agent-3"], docs: ["agent-2"] }), "own:1");
    expect(h.w(0).sent.map((s) => s.snapshot?.sessions.length)).toEqual([2]);
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
    expect(h.w(0).sent.at(-1)?.snapshot).toMatchObject({ panes: [], sessions: [] });
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
    expect(h.w(0).calls).toHaveLength(3); // a sender no window has is ignored
  });

  it("brings every widget already shown forward, and says how many windows there are", () => {
    const h = shown();
    expect(h.c.showAll()).toBe(2);
    expect(h.windows.map((made) => made.calls)).toEqual([["reveal"], ["reveal"]]);
    expect(harness().c.showAll()).toBe(0);
    // a pane that has left, still waiting out the cap, is not showing: not counted, not revealed again
    h.c.setSnapshot(snap({ docs: ["agent-2"] }), "own:1");
    h.w(0).calls.length = 0;
    h.w(1).calls.length = 0;
    expect(h.c.showAll()).toBe(1);
    expect(h.w(0).calls).toEqual([]);
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

  it("a drag keeps the size the page last reported, not the default", () => {
    const h = shown();
    const id = h.w(0).win.id;
    h.c.resize(id, { width: 346, height: 384 });
    h.setCursor(FIRST.x + 16, FIRST.y + 28);
    h.c.dragStart(id);
    h.setCursor(1000, 500);
    h.c.dragMove(id);
    expect(h.w(0).calls.at(-1)).toBe("bounds 984,472 346x384");
    h.c.dragEnd(id);
    expect(h.saved).toEqual([["repo", { x: 984, y: 472, pinned: false }]]);
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
    expect(h.w(0).calls).toEqual(["level pinned"]);
    expect(h.saved).toEqual([["repo", { x: FIRST.x, y: FIRST.y, pinned: true }]]);
    expect(h.w(0).sent.at(-1)).toMatchObject({ pinned: true });
    h.c.togglePin(id);
    expect(h.w(0).calls).toEqual(["level pinned", "level normal"]);
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
    expect(h.w(1).calls).toEqual(["level pinned"]);
    expect(h.opened).toEqual(["window", "settings"]);
  });

  it("focuses a clicked session's terminal only when it is one main sent that window, and never opens the full window", () => {
    const h = shown();
    h.c.select(h.w(0).win.id, "agent-1");
    h.c.select(h.w(0).win.id, "agent-2"); // the other pane's
    h.c.select(h.w(0).win.id, "agent-9");
    h.c.select(999, "agent-1");
    expect(h.focused).toEqual(["agent-1"]);
    expect(h.opened).toEqual([]);
  });

  it("a menu item clicked after its window has gone does nothing", () => {
    const h = shown();
    h.c.menu(h.w(0).win.id);
    const menu = h.w(0).menus[0] ?? [];
    h.c.setSnapshot(snap({ docs: ["agent-2"] }), "own:1"); // a snapshot without repo
    vi.advanceTimersByTime(CLOSE_CAP_MS); // the window closes, its entry dropped
    h.w(0).calls.length = 0;
    const sentBefore = h.w(0).sent.length;
    (menu[0]?.click as () => void)(); // Pin on top, on the closure's now-stale entry
    expect(h.w(0).calls).toEqual([]);
    expect(h.saved).toEqual([]);
    expect(h.w(0).sent).toHaveLength(sentBefore);
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

  it("tries are counted per label", () => {
    const h = shown();
    h.w(h.windows.length - 2).fail(); // repo, try 1
    h.c.setSnapshot(TWO, "own:1"); // repo replaced
    h.w(h.windows.length - 1).fail(); // repo's replacement, try 2
    h.w(1).fail(); // docs, untouched until now: try 1
    expect(h.logged).toEqual([
      ["desktop.widgetFailed", { tries: 1 }],
      ["desktop.widgetFailed", { tries: 2 }],
      ["desktop.widgetFailed", { tries: 1 }],
    ]);
    // repo's tries (2) has not hit the cap, so a further TWO snapshot would remake it too; a
    // docs-only snapshot isolates the check to the last log entry's label.
    const before = h.windows.length;
    h.c.setSnapshot(snap({ docs: ["agent-2"] }), "own:1");
    expect(h.windows).toHaveLength(before + 1);
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

describe("shutdown", () => {
  it("closes every window and makes a later snapshot or view change open nothing", () => {
    const h = shown();
    h.c.shutdown();
    expect(h.windows.map((made) => made.calls)).toEqual([["close"], ["close"]]);
    h.c.setSnapshot(TWO, "own:2");
    h.c.setView("window");
    h.c.setView("widgets");
    h.c.setSnapshot(TWO, "own:3");
    expect(h.windows).toHaveLength(2);
    expect(h.c.ready(999)).toBeNull();
  });
});

const BOTTOM: Bounds = { x: FIRST.x, y: AREA.height - DEFAULT_WIDGET_SIZE.height - SLOT_GAP, ...DEFAULT_WIDGET_SIZE };
/** TWO with repo's session idle: agent-1 finished its turn. */
const REPO_IDLE: Snapshot = { ...TWO, sessions: TWO.sessions.map((s) => (s.alias === "agent-1" ? { ...s, state: "idle" as const } : s)) };
const REPO_ASLEEP: Snapshot = { ...TWO, sessions: TWO.sessions.map((s) => (s.alias === "agent-1" ? { ...s, state: "asleep" as const } : s)) };
/** TWO with both sessions idle: both finished in the same snapshot. */
const BOTH_IDLE: Snapshot = { ...TWO, sessions: TWO.sessions.map((s) => ({ ...s, state: "idle" as const })) };
/** The slot above the bottom-right one: where a second box raised at the same time goes. */
const ABOVE_BOTTOM: Bounds = { ...BOTTOM, y: BOTTOM.y - DEFAULT_WIDGET_SIZE.height - SLOT_GAP };

describe("the finished popup in widget view", () => {
  it("raises the pane's widget when a turn there finishes: the highest level, brought forward, drawn green, and logged", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", move(BOTTOM), "reveal"]);
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

  it("lowers the widget when the session works again, or leaves, and not when it falls asleep", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.setSnapshot(REPO_ASLEEP, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", move(BOTTOM), "reveal"]);
    h.c.setSnapshot(TWO, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", move(BOTTOM), "reveal", "level normal"]);
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
    expect(h.w(0).calls).toEqual(["level raised", move(BOTTOM), "reveal"]);
  });

  it("lowers everything when the popup is switched off, and when the source changes", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.setPopup(false);
    expect(h.w(0).calls).toEqual(["level raised", move(BOTTOM), "reveal", "level normal"]);

    h.c.setPopup(true);
    h.c.setSnapshot(TWO, "own:1");
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls.at(-1)).toBe("reveal");
    h.c.setSnapshot(REPO_IDLE, "attached:4750");
    expect(h.w(0).calls.at(-1)).toBe("level normal");
    expect(h.w(0).sent.at(-1)).toMatchObject({ generation: 2, raised: false });
  });

  it("keeps its baseline while the popup is off, so switching it on fires only for new transitions", () => {
    const h = shown();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual([]);
    h.c.setSnapshot(TWO, "own:1");
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual(["level raised", move(BOTTOM), "reveal"]);
  });

  it("leaves a raised widget at the bottom right once it is lowered, and remembers nothing", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.dragStart(h.w(0).win.id);
    h.c.dragEnd(h.w(0).win.id);
    expect(h.w(0).win.bounds()).toEqual(BOTTOM);
    expect(h.saved).toEqual([]);
  });

  it("sends a clicked widget behind every other window, and one dragged or pinned stays in front", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.dragStart(h.w(0).win.id);
    h.c.dragEnd(h.w(0).win.id);
    expect(h.w(0).calls.slice(-2)).toEqual(["level normal", "back"]);

    h.c.setSnapshot(TWO, "own:1");
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.setCursor(BOTTOM.x, BOTTOM.y);
    h.c.dragStart(h.w(0).win.id);
    h.setCursor(BOTTOM.x - 100, BOTTOM.y - 50);
    h.c.dragMove(h.w(0).win.id);
    h.c.dragEnd(h.w(0).win.id);
    expect(h.w(0).calls.at(-1)).toBe("level normal");

    h.c.togglePin(h.w(1).win.id);
    h.c.setSnapshot({ ...TWO, sessions: TWO.sessions.map((s) => (s.alias === "agent-2" ? { ...s, state: "working" as const } : s)) }, "own:1");
    h.c.setSnapshot(BOTH_IDLE, "own:1");
    h.c.dragStart(h.w(1).win.id);
    h.c.dragEnd(h.w(1).win.id);
    expect(h.w(1).calls.at(-1)).toBe("level pinned");
  });

  it("logs a click that could not send the widget back", () => {
    const h = shown();
    h.w(0).backFails();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    h.c.dragStart(h.w(0).win.id);
    h.c.dragEnd(h.w(0).win.id);
    expect(h.logged.at(-1)).toEqual(["desktop.sendToBackFailed", {}]);
  });

  it("sends nothing back when a widget that was not raised is clicked", () => {
    const h = shown();
    h.c.dragStart(h.w(0).win.id);
    h.c.dragEnd(h.w(0).win.id);
    expect(h.w(0).calls).toEqual([]);
  });

  it("leaves a pinned widget where it was pinned", () => {
    const h = shown();
    h.c.togglePin(h.w(0).win.id);
    const pinnedAt = h.w(0).win.bounds();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).calls).toEqual(["level pinned", "level raised", "reveal"]);
    expect(h.w(0).win.bounds()).toEqual(pinnedAt);
  });

  it("stacks a second widget raised in the same snapshot above the first", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(BOTH_IDLE, "own:1");
    expect(h.w(0).win.bounds()).toEqual(BOTTOM);
    expect(h.w(1).win.bounds()).toEqual(ABOVE_BOTTOM);
  });

  it("keeps a raised widget in the corner when its page reports a taller box", () => {
    const h = shown();
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    const size = { width: DEFAULT_WIDGET_SIZE.width, height: 300 };
    h.c.resize(h.w(0).win.id, size);
    expect(h.w(0).win.bounds()).toEqual({ x: BOTTOM.x, y: AREA.height - size.height - SLOT_GAP, ...size });
  });

  it("grows a pinned widget from its top-left corner, raised or not", () => {
    const h = shown();
    h.c.togglePin(h.w(0).win.id);
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    const size = { width: DEFAULT_WIDGET_SIZE.width, height: 300 };
    h.c.resize(h.w(0).win.id, size);
    expect(h.w(0).win.bounds()).toEqual({ x: FIRST.x, y: FIRST.y, ...size });
  });

  it("moves a raised widget by the size its page reported, not the default", () => {
    const h = shown();
    const size = { width: 400, height: 240 };
    h.c.resize(h.w(0).win.id, size);
    h.c.setPopup(true);
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).win.bounds()).toEqual({ x: AREA.width - size.width - SLOT_GAP, y: AREA.height - size.height - SLOT_GAP, ...size });
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

  it("makes a temporary widget at the bottom right whatever the folder's widget remembers", () => {
    const h = windowView({ placement: (label) => (label === "repo" ? { x: 40, y: 60, pinned: true } : undefined) });
    h.c.setSnapshot(REPO_IDLE, "own:1");
    expect(h.w(0).win.bounds()).toEqual(BOTTOM);
    // the remembered pin is not honoured either: a temporary widget has no pin, and its level is raised anyway
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

  it("closes a temporary widget at once when it is pressed, moved or not, and does not remake it", () => {
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
    // a popup is always made at the bottom right, so where one was dragged is nobody's place to keep
    expect(h.saved).toEqual([]);
    expect(h.w(0).calls.at(-1)).toBe("close");
    h.c.setSnapshot(REPO_ASLEEP, "own:1");
    expect(h.windows).toHaveLength(1);
  });

  it("focuses the session a click on a temporary widget names, then closes the popup", () => {
    const h = windowView();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    const id = h.w(0).win.id;
    h.c.ready(id);
    h.c.resize(id, DEFAULT_WIDGET_SIZE);
    h.c.select(id, "agent-1");
    h.c.dragStart(id);
    h.c.dragEnd(id);
    expect(h.focused).toEqual(["agent-1"]);
    expect(h.opened).toEqual([]);
    expect(h.w(0).calls.at(-1)).toBe("close");
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

  it("a press on a temporary widget already walking out does nothing, and it goes with the cap", () => {
    const h = windowView();
    h.c.setSnapshot(REPO_IDLE, "own:1");
    const id = h.w(0).win.id;
    h.c.ready(id);
    h.c.resize(id, DEFAULT_WIDGET_SIZE);
    h.c.setSnapshot(TWO, "own:1"); // walking out: agent-1 back at work, the raise is gone
    expect(h.w(0).calls.at(-1)).toBe("level normal");
    h.c.dragStart(id);
    h.c.dragEnd(id);
    expect(h.w(0).calls).not.toContain("close");
    expect(h.saved).toEqual([]);
    vi.advanceTimersByTime(CLOSE_CAP_MS);
    expect(h.w(0).calls.at(-1)).toBe("close");
  });
});
