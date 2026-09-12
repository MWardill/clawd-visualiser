import { describe, expect, it } from "vitest";
import { CLAWD_BODY, EYES, PALETTE, createEngine, type PixelContext, SCENE_VERSION } from "./index";

/** A fake 2D context that records every filled cell by colour. */
function fakeContext() {
  const cells: { x: number; y: number; col: string }[] = [];
  const ctx = {
    fillStyle: "" as string,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "top" as CanvasTextBaseline,
    globalAlpha: 1,
    fillRect(x: number, y: number) { cells.push({ x, y, col: String(this.fillStyle) }); },
    fillText() {},
  } satisfies PixelContext;
  return { ctx, cells };
}

describe("@clawd/scene", () => {
  it("exports a version", () => {
    expect(SCENE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("keeps the canonical 14 by 8 Clawd with its eye anchors inside the body", () => {
    expect(CLAWD_BODY.width).toBe(14);
    expect(CLAWD_BODY.height).toBe(8);
    expect(CLAWD_BODY.data).toHaveLength(8);
    for (const row of CLAWD_BODY.data) expect(row).toHaveLength(14);
    const { eyeLeft, eyeRight } = CLAWD_BODY.anchors;
    expect(CLAWD_BODY.data[eyeLeft.y]![eyeLeft.x]).toBe(1);
    expect(CLAWD_BODY.data[eyeRight.y]![eyeRight.x]).toBe(1);
  });

  it("draws every body pixel in Clawd orange and two black eyes", () => {
    const { ctx, cells } = fakeContext();
    const engine = createEngine(ctx, 10);
    engine.drawClawd(0, 0, { eyes: "forward" });
    const bodyPixels = CLAWD_BODY.data.flat().filter((v) => v === 1).length;
    expect(cells.filter((c) => c.col === PALETTE.clawd.body)).toHaveLength(bodyPixels);
    const eyes = cells.filter((c) => c.col === PALETTE.clawd.eye);
    expect(eyes).toHaveLength(2);
    expect(eyes.map((e) => [e.x / 10, e.y / 10])).toEqual([[4, 1], [9, 1]]);
  });

  it("hides the eyes on a blink and shifts them for a glance", () => {
    expect(EYES.blink).toEqual({ type: "hidden" });
    const { ctx, cells } = fakeContext();
    const engine = createEngine(ctx, 1);
    engine.drawClawd(0, 0, { eyes: "blink" });
    expect(cells.filter((c) => c.col === PALETTE.clawd.eye)).toHaveLength(0);
    engine.drawClawd(0, 0, { eyes: "look_right" });
    expect(cells.filter((c) => c.col === PALETTE.clawd.eye).map((e) => e.x)).toEqual([5, 10]);
  });
});
