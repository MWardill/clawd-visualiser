import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { PALETTE } from "./engine";
import { CELL, MARGIN, PANE_W, SEAT_H, SEAT_W, TITLE_ROWS, paneHeight, seatOrigin } from "./layout";
import { mountPanesScene, type PanesSceneOptions } from "./panes";
import { SCENE_COLOURS } from "./sprites";
import { fakeContext } from "./testing/fake-context";

const T0 = 1_700_000_000_000;
const iso = (t: number): string => new Date(t).toISOString();

const SNAPSHOT: Snapshot = {
  version: 1,
  generatedAt: iso(T0),
  panes: [{ pane: "pane-1", label: "Oak" }],
  sessions: [{ alias: "agent-1", label: "Otter", pane: "pane-1", state: "waiting", activity: null, subagents: 1, contextPct: 50, since: iso(T0), updatedAt: iso(T0) }],
};

function harness(dpr = 1, extra: Partial<PanesSceneOptions> = {}) {
  const { ctx, rects, cellsOf, texts, cleared, clips, saved, reset } = fakeContext();
  const frames: ((ts: number) => void)[] = [];
  const events = new Map<string, (e: unknown) => void>();
  const canvas = {
    width: 960,
    height: 600,
    style: { cursor: "" },
    getContext: () => ctx,
    addEventListener: (type: string, fn: (e: unknown) => void) => events.set(type, fn),
    removeEventListener: (type: string) => events.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  let now = T0;
  const selected: string[] = [];
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
  /** Runs the pending frame callback with a timestamp; the scene renders once the accumulator passes 1/30 s. */
  const frame = (ms: number): void => {
    const fn = frames.pop();
    frames.length = 0;
    fn?.(ms);
  };
  return { scene, canvas, rects, cellsOf, texts, cleared, clips, saved, reset, frames, events, selected, setNow: (t: number) => (now = t), frame };
}

describe("mountPanesScene", () => {
  it("draws the empty state, then a pane, a Clawd and its nameplate after a snapshot", () => {
    const h = harness();
    expect(h.texts.some((t) => t.text === "no sessions")).toBe(true);
    h.reset();
    h.scene.setSnapshot(SNAPSHOT);
    h.setNow(T0 + 5000); // seated, not walking in: a walking Clawd carries no nameplate
    h.frame(0);
    h.frame(100);
    const cells = h.cellsOf(CELL);
    expect(cells.some((c) => c.col === PALETTE.clawd.body)).toBe(true);
    // the pane border is amber because its one session is waiting
    expect(cells.some((c) => c.col === PALETTE.state.amber && c.x === MARGIN && c.y === MARGIN)).toBe(true);
    expect(h.texts.some((t) => t.text === "─ oak")).toBe(true);
    expect(h.texts.some((t) => t.text === "otter")).toBe(true);
    expect(h.texts.some((t) => t.text === " ×1")).toBe(true);
    expect(h.texts.some((t) => t.text.startsWith("waiting "))).toBe(true);
  });

  it("hit-tests the seated Clawd and reports clicks through onSelect", () => {
    const h = harness();
    h.scene.setSnapshot(SNAPSHOT);
    h.setNow(T0 + 5000);
    h.frame(0);
    h.frame(100);
    const seat = seatOrigin(0);
    const inside = { x: (MARGIN + seat.x + SEAT_W / 2) * CELL, y: (MARGIN + seat.y + SEAT_H / 2) * CELL };
    expect(h.scene.hitTest(inside.x, inside.y)).toBe("agent-1");
    expect(h.scene.hitTest(inside.x, (MARGIN + TITLE_ROWS + 3 * SEAT_H) * CELL)).toBeNull();
    h.events.get("click")?.({ clientX: inside.x, clientY: inside.y });
    expect(h.selected).toEqual(["agent-1"]);
  });

  it("hit-tests correctly when a cell is not a whole number of device pixels", () => {
    const h = harness(1.25);
    h.scene.setSnapshot(SNAPSHOT);
    h.setNow(T0 + 5000);
    h.frame(0);
    h.frame(100);
    // PX = round(6 * 1.25) = 8 device px per cell, so a cell is 8 / 1.25 = 6.4 CSS px
    const cssPerCell = 8 / 1.25;
    const seat = seatOrigin(0);
    // near the seat's right edge: in true cells this is 28.5 (inside); measured in nominal 6 px cells it would be 30.4 (outside)
    const x = (MARGIN + seat.x + SEAT_W - 0.5) * cssPerCell;
    const y = (MARGIN + seat.y + SEAT_H / 2) * cssPerCell;
    expect(h.scene.hitTest(x, y)).toBe("agent-1");
    // the same point measured in nominal 6 px cells lands in the wrong place
    expect(h.scene.hitTest((MARGIN + seat.x + SEAT_W + 0.5) * cssPerCell, y)).toBeNull();
  });

  it("clears every actor at once and stops scheduling frames after destroy", () => {
    const h = harness();
    h.scene.setSnapshot(SNAPSHOT);
    h.frame(0);
    h.frame(100);
    h.scene.clear();
    h.reset();
    h.frame(200);
    h.frame(300);
    expect(h.cellsOf(CELL).some((c) => c.col === PALETTE.clawd.body)).toBe(true); // the empty-state Clawd
    expect(h.texts.some((t) => t.text === "no sessions")).toBe(true);
    h.scene.destroy();
    h.frames.length = 0;
    h.frame(400);
    expect(h.frames).toHaveLength(0);
  });

  it("does not schedule frames while paused and resumes afterwards", () => {
    const h = harness();
    h.frames.length = 0;
    h.scene.setPaused(true);
    expect(h.frames).toHaveLength(0);
    h.scene.setPaused(false);
    expect(h.frames).toHaveLength(1);
  });

  it("captions a working Clawd with its subject and leaves an idle one without", () => {
    const h = harness();
    const working = { ...SNAPSHOT.sessions[0]!, state: "working" as const, activity: "edit" as const, detail: { name: "Fix Login", subject: { kind: "file" as const, text: "src/lib/feed/agent.ts" } } };
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: [working] });
    h.setNow(T0 + 5000);
    h.frame(0);
    h.frame(100);
    expect(h.texts.some((t) => t.text === "fix login")).toBe(true);
    const cap = h.texts.find((t) => t.text === "feed/agent.ts");
    expect(cap?.col).toBe(PALETTE.state.green);
    h.reset();
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: [{ ...working, state: "idle", activity: null }] });
    h.setNow(T0 + 10_000);
    h.frame(200);
    h.frame(300);
    expect(h.texts.some((t) => t.text === "feed/agent.ts")).toBe(false);
  });

  it("captions a working Clawd's web activity with the same colour the particle uses", () => {
    const h = harness();
    const working = { ...SNAPSHOT.sessions[0]!, state: "working" as const, activity: "web" as const, detail: { name: "Fix Login", subject: { kind: "host" as const, text: "example.com" } } };
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: [working] });
    h.setNow(T0 + 5000);
    h.frame(0);
    h.frame(100);
    const cap = h.texts.find((t) => t.text === "example.com");
    expect(cap?.col).toBe(SCENE_COLOURS.web);
  });
});

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
});
