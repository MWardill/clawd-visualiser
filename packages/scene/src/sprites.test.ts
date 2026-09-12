import { describe, expect, it } from "vitest";
import { CLAWD_BODY, PALETTE, createEngine } from "./engine";
import { MINI, drawBox, drawClawdWalking, drawClawdWave, drawExclaim, drawMini, drawSparkle, drawSweat, drawZzz } from "./sprites";
import { fakeContext, lastColourAt } from "./testing/fake-context";

const BODY = PALETTE.clawd.body;

describe("sprites", () => {
  it("draws the mini Clawd as 19 body cells with two eyes on top", () => {
    const { ctx, cellsOf } = fakeContext();
    drawMini(createEngine(ctx, 1), 10, 20, false);
    const cells = cellsOf(1);
    expect(cells.filter((c) => c.col === BODY)).toHaveLength(19);
    expect(cells.filter((c) => c.col === PALETTE.clawd.eye).map((c) => [c.x, c.y])).toEqual([[12, 20], [14, 20]]);
    expect(MINI.width).toBe(7);
    expect(MINI.height).toBe(4);
  });

  it("shifts the mini's legs one cell on the step frame", () => {
    const { ctx, cellsOf } = fakeContext();
    drawMini(createEngine(ctx, 1), 0, 0, true);
    const legs = cellsOf(1).filter((c) => c.y === 3 && c.col === BODY).map((c) => c.x);
    expect(legs).toEqual([2, 6]);
  });

  it("erases and redraws the leg rows on a walking step", () => {
    const { ctx, cellsOf } = fakeContext();
    drawClawdWalking(createEngine(ctx, 1), 0, 0, "forward", true, "#000");
    const cells = cellsOf(1);
    // the resting leg at column 3 is erased with the background; the stepping leg lands at column 4
    expect(lastColourAt(cells, 3, 6)).toBe("#000");
    expect(lastColourAt(cells, 4, 6)).toBe(BODY);
    expect(lastColourAt(cells, 4, 7)).toBe(BODY);
  });

  it("leaves the legs alone between steps", () => {
    const { ctx, cellsOf } = fakeContext();
    drawClawdWalking(createEngine(ctx, 1), 0, 0, "forward", false, "#000");
    const cells = cellsOf(1);
    expect(lastColourAt(cells, 3, 6)).toBe(BODY);
    expect(cells.some((c) => c.col === "#000")).toBe(false);
  });

  it("raises a claw on the chosen side when waving", () => {
    const { ctx, cellsOf, reset } = fakeContext();
    const engine = createEngine(ctx, 1);
    drawClawdWave(engine, 5, 5, "forward", "right");
    let cells = cellsOf(1);
    expect(lastColourAt(cells, 5 + 14, 5)).toBe(BODY);
    expect(lastColourAt(cells, 5 + 13, 6)).toBe(BODY);
    reset();
    drawClawdWave(engine, 5, 5, "forward", "left");
    cells = cellsOf(1);
    expect(lastColourAt(cells, 4, 5)).toBe(BODY);
    expect(lastColourAt(cells, 5, 6)).toBe(BODY);
  });

  it("draws the exclamation mark as three cells above the head with a gap", () => {
    const { ctx, cellsOf } = fakeContext();
    drawExclaim(createEngine(ctx, 1), 0, 10, PALETTE.state.amber);
    expect(cellsOf(1).map((c) => [c.x, c.y])).toEqual([[7, 6], [7, 7], [7, 9]]);
  });

  it("draws the sweat drop, the sparkles and the zZ in their colours", () => {
    const { ctx, cellsOf, reset } = fakeContext();
    const engine = createEngine(ctx, 1);
    drawSweat(engine, 0, 10);
    expect(cellsOf(1).map((c) => [c.x, c.y, c.col])).toEqual([[13, 9, PALETTE.state.blue], [13, 10, PALETTE.state.blue]]);
    reset();
    drawSparkle(engine, 0, 0);
    expect(cellsOf(1).map((c) => c.x)).toEqual([3, 5, 8, 10]);
    expect(cellsOf(1).every((c) => c.col === PALETTE.ui.white && c.y === 1)).toBe(true);
    reset();
    drawZzz(engine, 0, 20, 0);
    const z = cellsOf(1);
    expect(z.length).toBeGreaterThan(10);
    expect(z.every((c) => c.col === PALETTE.state.blue && c.y < 20)).toBe(true);
  });

  it("outlines a box one cell thick", () => {
    const { ctx, cellsOf } = fakeContext();
    drawBox(createEngine(ctx, 1), 2, 3, 5, 4, "#abc");
    const cells = cellsOf(1);
    expect(cells).toHaveLength(2 * 5 + 2 * (4 - 2));
    expect(cells.every((c) => c.col === "#abc")).toBe(true);
    expect(cells.some((c) => c.x === 3 && c.y === 4)).toBe(false);
  });

  it("does not touch the body definition", () => {
    expect(CLAWD_BODY.data[6]).toEqual([0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0]);
  });
});
