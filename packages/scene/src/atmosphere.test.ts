import { describe, expect, it } from "vitest";
import { createAtmosphere, drawNight } from "./atmosphere";
import { PALETTE, createEngine } from "./engine";
import { fakeContext } from "./testing/fake-context";

describe("atmosphere", () => {
  it("is deterministic for a seed and scales the star count with the area", () => {
    const a = createAtmosphere(160, 100);
    const b = createAtmosphere(160, 100);
    expect(a).toEqual(b);
    expect(a.stars).toHaveLength(140);
    expect(createAtmosphere(320, 100).stars).toHaveLength(281);
    expect(a.clouds).toHaveLength(4);
  });

  it("keeps every star and cloud inside the grid", () => {
    const a = createAtmosphere(120, 60, 3);
    for (const s of a.stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(120);
      expect(s.y).toBeGreaterThanOrEqual(4);
      expect(s.y).toBeLessThan(60 - 4);
    }
    for (const c of a.clouds) {
      expect(c.y).toBeGreaterThanOrEqual(4);
      expect(c.y).toBeLessThan(60);
    }
  });

  it("fills the background first, then draws stars and cloud cells", () => {
    const { ctx, rects, cellsOf } = fakeContext();
    const atmo = createAtmosphere(40, 20);
    drawNight(ctx, createEngine(ctx, 2), atmo, 0);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 80, h: 40, col: PALETTE.night.bg });
    const cells = cellsOf(2);
    expect(cells.some((c) => c.col === PALETTE.night.cloud)).toBe(true);
    const starColours: string[] = [PALETTE.night.starDim, PALETTE.night.starMid, PALETTE.night.starBright];
    expect(cells.some((c) => starColours.includes(c.col))).toBe(true);
  });

  it("drifts clouds and wraps them around the grid", () => {
    const { ctx, cellsOf, reset } = fakeContext();
    const engine = createEngine(ctx, 1);
    const atmo = createAtmosphere(40, 20);
    drawNight(ctx, engine, atmo, 0);
    const first = cellsOf(1).filter((c) => c.col === PALETTE.night.cloud).map((c) => c.x);
    reset();
    drawNight(ctx, engine, atmo, 5000);
    const later = cellsOf(1).filter((c) => c.col === PALETTE.night.cloud).map((c) => c.x);
    expect(later).not.toEqual(first);
    expect(later.every((x) => x >= -10 && x < 40 + 10)).toBe(true);
  });
});
