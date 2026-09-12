import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { PALETTE } from "./engine";
import { CELL, MARGIN, SEAT_H, SEAT_W, TITLE_ROWS, seatOrigin } from "./layout";
import { mountPanesScene } from "./panes";
import { fakeContext } from "./testing/fake-context";

const T0 = 1_700_000_000_000;
const iso = (t: number): string => new Date(t).toISOString();

const SNAPSHOT: Snapshot = {
  version: 1,
  generatedAt: iso(T0),
  panes: [{ pane: "pane-1", label: "Oak" }],
  sessions: [{ alias: "agent-1", label: "Otter", pane: "pane-1", state: "waiting", activity: null, subagents: 1, contextPct: 50, since: iso(T0), updatedAt: iso(T0) }],
};

function harness(dpr = 1) {
  const { ctx, cellsOf, texts, reset } = fakeContext();
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
  return { scene, canvas, cellsOf, texts, reset, frames, events, selected, setNow: (t: number) => (now = t), frame };
}

describe("mountPanesScene", () => {
  it("draws the empty state, then a pane, a Clawd and its nameplate after a snapshot", () => {
    const h = harness();
    expect(h.texts.some((t) => t.text === "no sessions")).toBe(true);
    h.reset();
    h.scene.setSnapshot(SNAPSHOT);
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
    const x = (MARGIN + seat.x + SEAT_W / 2) * cssPerCell;
    const y = (MARGIN + seat.y + SEAT_H / 2) * cssPerCell;
    expect(h.scene.hitTest(x, y)).toBe("agent-1");
    // the same point measured in nominal 6 px cells lands in the wrong place
    expect(h.scene.hitTest((MARGIN + seat.x + SEAT_W - 1) * cssPerCell + 2 * CELL, y)).toBeNull();
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
});
