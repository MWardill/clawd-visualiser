# Panes Scene (`packages/scene`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the panes scene in `@clawd/scene`: given a `Snapshot`, draw the terminal night sky, one box-drawn pane per repository and one animated Clawd per session on a single canvas, with arrivals, departures, subagent minis, nameplates, attention colouring, hit-testing and a visibility-aware draw loop.

**Architecture:** Everything new is written around the untouched engine (`engine.ts`, the clawd-animation template's pixel engine). Pure modules do the thinking: `layout.ts` (geometry), `actors.ts` (the world and its reconciliation with a snapshot), `poses.ts` (what a Clawd looks like this frame), `text.ts` (strings). `panes.ts` owns the canvas, the loop and pointer events and is the only module with side effects. The scene depends on `@clawd/core` for types only.

**Tech Stack:** TypeScript 5 strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (from `tsconfig.base.json`), Vitest 5, pnpm 12 workspace, Node 24. No runtime dependencies beyond the workspace.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-12-web-app-design.md`, section 4. Read it before starting.
- Work in the worktree `C:\mw\visualiser-web` on branch `feat/web-app`. Run every command from that directory. Package filter: `pnpm --filter @clawd/scene <script>`.
- `packages/scene/src/engine.ts` is never modified. New colours go in `SCENE_COLOURS` in `sprites.ts`, not in `PALETTE`.
- `@clawd/core` is never modified. The scene imports it with `import type` only.
- All drawing goes through the engine's `px()` on the cell grid, except text, which is drawn with `fillText` at a cell boundary. No anti-aliased shapes.
- The Clawd has no mouth. Mood is eyes, accessories and particles only.
- No animation libraries. Tweens are the engine's `easeOut`, `easeInOut` and `lerp` on wall-clock time.
- Every `*.test.ts` sits next to the file it tests and uses the recording fake context from `src/testing/fake-context.ts`.
- Commit after each task with a one-line message and **no trailers of any kind** (no `Co-Authored-By`). Add files by name, never `git add -A`. **Never push.**
- Line endings LF (enforced by `.gitattributes`).

---

## File structure

```
packages/scene/
  package.json                 add "@clawd/core": "workspace:*" (Task 1)
  README.md                    what the package is and how to use it (Task 7)
  src/
    engine.ts                  untouched
    idle.ts                    untouched
    index.ts                   public barrel (Task 7)
    index.test.ts              existing; switched to the shared fake context (Task 1)
    testing/fake-context.ts    recording PixelContext for tests (Task 1)
    sprites.ts                 accessories: walking, wave, exclaim, sweat, zZ, sparkle, mini, box (Task 2)
    atmosphere.ts              seeded stars and clouds, drawNight (Task 3)
    layout.ts                  geometry constants, seat and door origins, pane flow (Task 4)
    actors.ts                  World, Actor, ScenePane; reconcile() and tick() (Task 5)
    poses.ts                   poseFor() (Task 6)
    text.ts                    mmss, nameplate, paneTitle, drawText (Task 6)
    panes.ts                   mountPanesScene() (Task 7)
```

---

### Task 1: Core types dependency and the shared fake context

**Files:**
- Modify: `packages/scene/package.json`
- Create: `packages/scene/src/testing/fake-context.ts`
- Modify: `packages/scene/src/index.test.ts`

**Interfaces:**
- Produces: `fakeContext(): { ctx, rects, texts, cellsOf(px), reset() }` used by every later test.

- [ ] **Step 1: Add the core dependency**

Run from `C:\mw\visualiser-web`:

```bash
pnpm --filter @clawd/scene add "@clawd/core@workspace:*"
```

Expected: `packages/scene/package.json` gains `"dependencies": { "@clawd/core": "workspace:*" }` and `pnpm-lock.yaml` links it. If the command refuses the specifier, add the block by hand and run `pnpm install`.

- [ ] **Step 2: Write the fake context**

Create `packages/scene/src/testing/fake-context.ts`:

```ts
import type { PixelContext } from "../engine";

export type FilledRect = { x: number; y: number; w: number; h: number; col: string; alpha: number };
export type DrawnText = { text: string; x: number; y: number; col: string; font: string; align: CanvasTextAlign; alpha: number };
export type Cell = { x: number; y: number; col: string };

/**
 * A fake 2D context that records every filled rectangle and every string of text, so a test can
 * ask what a scene drew. Test-only; not exported from the package.
 */
export function fakeContext() {
  const rects: FilledRect[] = [];
  const texts: DrawnText[] = [];
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
  } satisfies PixelContext;
  /** The rectangles that are exactly one cell of `px` canvas pixels, in cell coordinates, in draw order. */
  const cellsOf = (px: number): Cell[] => rects.filter((r) => r.w === px && r.h === px).map((r) => ({ x: r.x / px, y: r.y / px, col: r.col }));
  const reset = (): void => {
    rects.length = 0;
    texts.length = 0;
  };
  return { ctx, rects, texts, cellsOf, reset };
}

/** The colour last drawn at a cell, or undefined when nothing was. */
export function lastColourAt(cells: Cell[], x: number, y: number): string | undefined {
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i]!;
    if (c.x === x && c.y === y) return c.col;
  }
  return undefined;
}
```

- [ ] **Step 3: Switch the existing test to it**

Replace the top of `packages/scene/src/index.test.ts` (the import block and the local `fakeContext` function) so the file reads:

```ts
import { describe, expect, it } from "vitest";
import { CLAWD_BODY, EYES, PALETTE, createEngine, SCENE_VERSION } from "./index";
import { fakeContext } from "./testing/fake-context";

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
    const { ctx, cellsOf } = fakeContext();
    const engine = createEngine(ctx, 10);
    engine.drawClawd(0, 0, { eyes: "forward" });
    const cells = cellsOf(10);
    const bodyPixels = CLAWD_BODY.data.flat().filter((v) => v === 1).length;
    expect(cells.filter((c) => c.col === PALETTE.clawd.body)).toHaveLength(bodyPixels);
    const eyes = cells.filter((c) => c.col === PALETTE.clawd.eye);
    expect(eyes).toHaveLength(2);
    expect(eyes.map((e) => [e.x, e.y])).toEqual([[4, 1], [9, 1]]);
  });

  it("hides the eyes on a blink and shifts them for a glance", () => {
    expect(EYES.blink).toEqual({ type: "hidden" });
    const { ctx, cellsOf, reset } = fakeContext();
    const engine = createEngine(ctx, 1);
    engine.drawClawd(0, 0, { eyes: "blink" });
    expect(cellsOf(1).filter((c) => c.col === PALETTE.clawd.eye)).toHaveLength(0);
    reset();
    engine.drawClawd(0, 0, { eyes: "look_right" });
    expect(cellsOf(1).filter((c) => c.col === PALETTE.clawd.eye).map((e) => e.x)).toEqual([5, 10]);
  });
});
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @clawd/scene test && pnpm --filter @clawd/scene typecheck`
Expected: `Tests  4 passed (4)` and a clean `tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/package.json pnpm-lock.yaml packages/scene/src/testing/fake-context.ts packages/scene/src/index.test.ts
git commit -m "test(scene): shared recording context; core types dependency"
```

---

### Task 2: Sprites and accessories

**Files:**
- Create: `packages/scene/src/sprites.ts`
- Test: `packages/scene/src/sprites.test.ts`

**Interfaces:**
- Consumes: `Engine`, `EyeVariant`, `CLAWD_BODY`, `PALETTE` from `./engine`.
- Produces: `SCENE_COLOURS`, `MINI`, `drawClawdWalking(engine, ox, oy, eyes, step, bg)`, `drawClawdWave(engine, ox, oy, eyes, side)`, `drawExclaim(engine, ox, oy, col)`, `drawSweat(engine, ox, oy)`, `drawSparkle(engine, ox, oy)`, `drawZzz(engine, ox, oy, frame)`, `drawMini(engine, ox, oy, step)`, `drawBox(engine, x, y, w, h, col)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/scene/src/sprites.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/scene test -- sprites`
Expected: FAIL, `Cannot find module './sprites'` (or equivalent).

- [ ] **Step 3: Write the sprites**

Create `packages/scene/src/sprites.ts`:

```ts
// Accessories drawn over or beside a Clawd. Pure draw functions over an Engine; the body itself
// is always the engine's drawClawd, so there is one definition of the character.
import { CLAWD_BODY, PALETTE, type Engine, type EyeVariant } from "./engine";

/** Colours the scene adds to the template's palette. `PALETTE` in engine.ts is never edited. */
export const SCENE_COLOURS = {
  /** the `web` activity; the other activities use PALETTE.state */
  web: "#b48cf0",
} as const;

/** Legs shifted one cell to the right: the scuttle frame from the proof of concept. */
const WALK_LEGS = [0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0] as const;

/** A Clawd mid-step: on the step frame the leg rows are erased with `bg` and redrawn shifted. */
export function drawClawdWalking(engine: Engine, ox: number, oy: number, eyes: EyeVariant, step: boolean, bg: string): void {
  engine.drawClawd(ox, oy, { eyes });
  if (!step) return;
  for (let c = 0; c < CLAWD_BODY.width; c++) {
    if (CLAWD_BODY.data[6]![c] === 1) {
      engine.px(ox + c, oy + 6, bg);
      engine.px(ox + c, oy + 7, bg);
    }
    if (WALK_LEGS[c] === 1) {
      engine.px(ox + c, oy + 6, PALETTE.clawd.body);
      engine.px(ox + c, oy + 7, PALETTE.clawd.body);
    }
  }
}

/** A Clawd raising one claw: two body cells stepping up from the hand anchor on that side. */
export function drawClawdWave(engine: Engine, ox: number, oy: number, eyes: EyeVariant, side: "left" | "right"): void {
  engine.drawClawd(ox, oy, { eyes });
  const col = PALETTE.clawd.body;
  if (side === "right") {
    engine.px(ox + 13, oy + 1, col);
    engine.px(ox + 14, oy, col);
  } else {
    engine.px(ox + 0, oy + 1, col);
    engine.px(ox - 1, oy, col);
  }
}

/** An exclamation mark centred above the head: three cells in a column with a gap before the dot. */
export function drawExclaim(engine: Engine, ox: number, oy: number, col: string): void {
  engine.px(ox + 7, oy - 4, col);
  engine.px(ox + 7, oy - 3, col);
  engine.px(ox + 7, oy - 1, col);
}

/** A sweat drop by the right eye. */
export function drawSweat(engine: Engine, ox: number, oy: number): void {
  engine.px(ox + 13, oy - 1, PALETTE.state.blue);
  engine.px(ox + 13, oy, PALETTE.state.blue);
}

/** Sparkles either side of each eye. */
export function drawSparkle(engine: Engine, ox: number, oy: number): void {
  for (const c of [3, 5, 8, 10]) engine.px(ox + c, oy + 1, PALETTE.ui.white);
}

const Z_SMALL = [
  [1, 1, 1],
  [0, 1, 0],
  [1, 1, 1],
] as const;
const Z_BIG = [
  [1, 1, 1, 1],
  [0, 0, 1, 0],
  [0, 1, 0, 0],
  [1, 1, 1, 1],
] as const;

function drawGlyph(engine: Engine, glyph: readonly (readonly number[])[], gx: number, gy: number, col: string): void {
  for (let r = 0; r < glyph.length; r++) {
    const row = glyph[r]!;
    for (let c = 0; c < row.length; c++) if (row[c] === 1) engine.px(gx + c, gy + r, col);
  }
}

/** A small z by the right claw and a big Z above it that bobs with the frame. Pixel glyphs, not text. */
export function drawZzz(engine: Engine, ox: number, oy: number, frame: number): void {
  const bob = Math.round(Math.sin(frame * 0.08));
  drawGlyph(engine, Z_SMALL, ox + 12, oy - 3, PALETTE.state.blue);
  drawGlyph(engine, Z_BIG, ox + 16, oy - 6 + bob, PALETTE.state.blue);
}

/** The subagent: a 7 by 4 mini Clawd with two eyes. */
export const MINI = {
  width: 7,
  height: 4,
  data: [
    [0, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 1, 0],
  ],
  eyes: [
    [2, 0],
    [4, 0],
  ],
} as const;

export function drawMini(engine: Engine, ox: number, oy: number, step: boolean): void {
  for (let r = 0; r < MINI.height; r++) {
    const row = MINI.data[r]!;
    for (let c = 0; c < MINI.width; c++) if (row[c] === 1) engine.px(ox + c + (r === 3 && step ? 1 : 0), oy + r, PALETTE.clawd.body);
  }
  for (const [ex, ey] of MINI.eyes) engine.px(ox + ex, oy + ey, PALETTE.clawd.eye);
}

/** A box outline one cell thick; the pane border. */
export function drawBox(engine: Engine, x: number, y: number, w: number, h: number, col: string): void {
  for (let i = 0; i < w; i++) {
    engine.px(x + i, y, col);
    engine.px(x + i, y + h - 1, col);
  }
  for (let j = 1; j < h - 1; j++) {
    engine.px(x, y + j, col);
    engine.px(x + w - 1, y + j, col);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @clawd/scene test -- sprites`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/sprites.ts packages/scene/src/sprites.test.ts
git commit -m "feat(scene): sprite accessories, the mini Clawd and the box outline"
```

---

### Task 3: Atmosphere

**Files:**
- Create: `packages/scene/src/atmosphere.ts`
- Test: `packages/scene/src/atmosphere.test.ts`

**Interfaces:**
- Produces: `createAtmosphere(width, height, seed?) -> Atmosphere`, `drawNight(ctx, engine, atmo, frame)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/scene/src/atmosphere.test.ts`:

```ts
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
    const starColours = [PALETTE.night.starDim, PALETTE.night.starMid, PALETTE.night.starBright];
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/scene test -- atmosphere`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the atmosphere**

Create `packages/scene/src/atmosphere.ts`:

```ts
// The night: a filled background, seeded twinkling stars and block clouds that drift and wrap.
import { PALETTE, type Engine, type PixelContext } from "./engine";

export type Star = { x: number; y: number; ph: number; sp: number; big: boolean };
export type Cloud = { x: number; y: number; sp: number; rows: readonly (readonly [number, number])[] };
export type Atmosphere = { width: number; height: number; stars: Star[]; clouds: Cloud[] };

/** The proof of concept's generator: a 31-bit LCG, good enough for stars. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Each row is [left offset, width]; the shapes from the proof of concept. */
const CLOUD_SHAPES: readonly (readonly (readonly [number, number])[])[] = [
  [[4, 6], [2, 12], [0, 16], [0, 16]],
  [[3, 5], [1, 10], [0, 12]],
  [[5, 7], [2, 14], [0, 18], [0, 18]],
  [[2, 5], [0, 9], [0, 9]],
];

/** One star per 114 cells (140 on the proof of concept's 160 by 100 grid) and four clouds, seeded. */
export function createAtmosphere(width: number, height: number, seed = 11): Atmosphere {
  const rnd = lcg(seed);
  const stars: Star[] = [];
  const count = Math.round((width * height) / 114);
  for (let i = 0; i < count; i++) {
    stars.push({ x: Math.floor(rnd() * width), y: 4 + Math.floor(rnd() * Math.max(1, height - 8)), ph: rnd() * Math.PI * 2, sp: 0.03 + rnd() * 0.05, big: rnd() < 0.08 });
  }
  const clouds: Cloud[] = CLOUD_SHAPES.map((rows) => ({ x: Math.floor(rnd() * width), y: 4 + Math.floor(rnd() * Math.max(1, height - 12)), sp: 0.012 + rnd() * 0.014, rows }));
  return { width, height, stars, clouds };
}

/** Fills the night background and draws this frame's stars and clouds. */
export function drawNight(ctx: PixelContext, engine: Engine, atmo: Atmosphere, frame: number): void {
  ctx.fillStyle = PALETTE.night.bg;
  ctx.fillRect(0, 0, atmo.width * engine.PX, atmo.height * engine.PX);
  for (const s of atmo.stars) {
    const tw = Math.sin(frame * s.sp + s.ph);
    const col = s.big ? (tw > 0 ? PALETTE.night.starBright : PALETTE.night.starMid) : tw > 0.3 ? PALETTE.night.starMid : PALETTE.night.starDim;
    engine.px(s.x, s.y, col);
    if (s.big && tw > 0.6) {
      engine.px(s.x - 1, s.y, PALETTE.night.starDim);
      engine.px(s.x + 1, s.y, PALETTE.night.starDim);
      engine.px(s.x, s.y - 1, PALETTE.night.starDim);
      engine.px(s.x, s.y + 1, PALETTE.night.starDim);
    }
  }
  // Clouds drift right for ever and wrap 10 cells past either edge, so one is never cut off abruptly.
  const span = atmo.width + 20;
  for (const c of atmo.clouds) {
    const ox = Math.floor(c.x + frame * c.sp);
    c.rows.forEach(([off, w], r) => {
      for (let i = 0; i < w; i++) engine.px(((ox + off + i) % span) - 10, c.y + r, PALETTE.night.cloud);
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @clawd/scene test -- atmosphere`
Expected: 4 passed. If the star counts differ by one from 140 or 281 because of rounding, adjust the expected numbers to what `Math.round(area / 114)` gives and keep the rule.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/atmosphere.ts packages/scene/src/atmosphere.test.ts
git commit -m "feat(scene): seeded night atmosphere with twinkling stars and drifting clouds"
```

---

### Task 4: Layout geometry

**Files:**
- Create: `packages/scene/src/layout.ts`
- Test: `packages/scene/src/layout.test.ts`

**Interfaces:**
- Produces: constants `CELL`, `SEAT_W`, `SEAT_H`, `PANE_COLS`, `PANE_PAD`, `TITLE_ROWS`, `PANE_GAP`, `MARGIN`, `PANE_W`, `SPRITE_DX`, `SPRITE_DY`, `NAME_ROW`, `STATUS_ROW`, `CONTEXT_ROW`, `CONTEXT_W`, `MINI_HOME`; types `XY`, `Rect`, `PaneSize`, `PaneRect`; functions `paneRows(seatsUsed)`, `paneHeight(seatsUsed)`, `seatOrigin(k)`, `doorOrigin(k, seatsUsed)`, `miniSlot(k)`, `layoutPanes(panes, gridWidth)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/scene/src/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MARGIN, MINI_HOME, PANE_GAP, PANE_W, SEAT_H, SEAT_W, SPRITE_DX, SPRITE_DY, TITLE_ROWS, doorOrigin, layoutPanes, miniSlot, paneHeight, paneRows, seatOrigin } from "./layout";

describe("layout", () => {
  it("sizes a pane by rows of two seats, never less than one row", () => {
    expect(paneRows(0)).toBe(1);
    expect(paneRows(1)).toBe(1);
    expect(paneRows(2)).toBe(1);
    expect(paneRows(3)).toBe(2);
    expect(paneHeight(0)).toBe(TITLE_ROWS + SEAT_H + 1);
    expect(paneHeight(3)).toBe(TITLE_ROWS + 2 * SEAT_H + 1);
    expect(PANE_W).toBe(52);
  });

  it("places seats in two columns from the top-left inside the title rows", () => {
    expect(seatOrigin(0)).toEqual({ x: 2, y: TITLE_ROWS });
    expect(seatOrigin(1)).toEqual({ x: 2 + SEAT_W, y: TITLE_ROWS });
    expect(seatOrigin(2)).toEqual({ x: 2, y: TITLE_ROWS + SEAT_H });
    expect(seatOrigin(5)).toEqual({ x: 2 + SEAT_W, y: TITLE_ROWS + 2 * SEAT_H });
  });

  it("puts the door for a seat under it, just below the pane's bottom border", () => {
    const door = doorOrigin(1, 2);
    expect(door.x).toBe(seatOrigin(1).x);
    // the sprite's top row (door.y + SPRITE_DY) is the first row below the border
    expect(door.y + SPRITE_DY).toBe(paneHeight(2) + 1);
  });

  it("stacks mini slots at the parent's right side, clear of the head", () => {
    expect(miniSlot(0)).toEqual({ x: SPRITE_DX + 15, y: SPRITE_DY - 5 });
    expect(miniSlot(1).y).toBe(miniSlot(0).y + 5);
    expect(MINI_HOME.x).toBeGreaterThan(SPRITE_DX);
  });

  it("flows panes left to right and wraps into bands as tall as the tallest pane", () => {
    const wide = layoutPanes([{ alias: "a", seatsUsed: 1 }, { alias: "b", seatsUsed: 3 }], 160);
    expect(wide.map((r) => [r.x, r.y])).toEqual([[MARGIN, MARGIN], [MARGIN + PANE_W + PANE_GAP, MARGIN]]);
    expect(wide[1]!.h).toBe(paneHeight(3));
    const narrow = layoutPanes([{ alias: "a", seatsUsed: 3 }, { alias: "b", seatsUsed: 1 }, { alias: "c", seatsUsed: 1 }], 100);
    expect(narrow.map((r) => [r.x, r.y])).toEqual([
      [MARGIN, MARGIN],
      [MARGIN, MARGIN + paneHeight(3) + PANE_GAP],
      [MARGIN, MARGIN + paneHeight(3) + PANE_GAP + paneHeight(1) + PANE_GAP],
    ]);
  });

  it("never wraps the first pane of a band, however narrow the grid", () => {
    const tiny = layoutPanes([{ alias: "a", seatsUsed: 1 }], 10);
    expect(tiny[0]).toMatchObject({ x: MARGIN, y: MARGIN, w: PANE_W });
    expect(layoutPanes([], 160)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/scene test -- layout`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the layout**

Create `packages/scene/src/layout.ts`:

```ts
// Geometry on the cell grid. Pure: no canvas, no time. Positions are in cells; the scene multiplies
// by its cell size at draw time.

/** CSS pixels per cell; the proof of concept's density. The backing store is this times the pixel ratio. */
export const CELL = 6;

/** A seat holds one Clawd, its accessories above and its nameplate below. */
export const SEAT_W = 24;
export const SEAT_H = 24;
/** Seat columns per pane; a pane never gets wider, only taller. */
export const PANE_COLS = 2;
export const PANE_PAD = 2;
/** Rows the title takes at the top of a pane, including the border row. */
export const TITLE_ROWS = 3;
export const PANE_GAP = 3;
export const MARGIN = 3;
export const PANE_W = PANE_COLS * SEAT_W + PANE_PAD * 2;

/** The sprite's offset inside its seat: rows 2 to 5 above it hold the exclamation mark, sweat and zZ. */
export const SPRITE_DX = 5;
export const SPRITE_DY = 6;
/** Nameplate rows inside the seat. */
export const NAME_ROW = 15;
export const STATUS_ROW = 17;
export const CONTEXT_ROW = 19;
export const CONTEXT_W = 18;

export type XY = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type PaneSize = { alias: string; seatsUsed: number };
export type PaneRect = Rect & { alias: string };

export function paneRows(seatsUsed: number): number {
  return Math.max(1, Math.ceil(seatsUsed / PANE_COLS));
}

export function paneHeight(seatsUsed: number): number {
  return TITLE_ROWS + paneRows(seatsUsed) * SEAT_H + 1;
}

/** Top-left of seat k, relative to the pane origin. */
export function seatOrigin(k: number): XY {
  return { x: PANE_PAD + (k % PANE_COLS) * SEAT_W, y: TITLE_ROWS + Math.floor(k / PANE_COLS) * SEAT_H };
}

/** Where a Clawd bound for or leaving seat k stands: under the seat, its sprite just below the bottom border. */
export function doorOrigin(k: number, seatsUsed: number): XY {
  return { x: seatOrigin(k).x, y: paneHeight(seatsUsed) + 1 - SPRITE_DY };
}

/** Where a mini appears from and returns to, relative to its parent's seat origin: under the parent's body. */
export const MINI_HOME: XY = { x: SPRITE_DX + 4, y: SPRITE_DY + 3 };

/** Mini k's slot, relative to its parent's seat origin: stacked at the parent's right side. */
export function miniSlot(k: number): XY {
  return { x: SPRITE_DX + 15, y: SPRITE_DY - 5 + 5 * k };
}

/**
 * Flows panes left to right in the order given, wrapping into a new band when the next pane would
 * cross the right margin; a band is as tall as its tallest pane. The first pane of a band is never
 * wrapped, so a grid narrower than a pane still lays out.
 */
export function layoutPanes(panes: readonly PaneSize[], gridWidth: number): PaneRect[] {
  const out: PaneRect[] = [];
  let x = MARGIN;
  let y = MARGIN;
  let bandH = 0;
  for (const p of panes) {
    const h = paneHeight(p.seatsUsed);
    if (x > MARGIN && x + PANE_W > gridWidth - MARGIN) {
      x = MARGIN;
      y += bandH + PANE_GAP;
      bandH = 0;
    }
    out.push({ alias: p.alias, x, y, w: PANE_W, h });
    x += PANE_W + PANE_GAP;
    bandH = Math.max(bandH, h);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @clawd/scene test -- layout`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/layout.ts packages/scene/src/layout.test.ts
git commit -m "feat(scene): pane and seat geometry with flowing bands"
```

---

### Task 5: Actors, reconciliation and tick

**Files:**
- Create: `packages/scene/src/actors.ts`
- Test: `packages/scene/src/actors.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `SessionPhase`, `Activity` types from `@clawd/core`; `easeOut`, `easeInOut`, `lerp` from `./engine`; `seatOrigin`, `doorOrigin`, `miniSlot`, `MINI_HOME`, `XY` from `./layout`.
- Produces: types `Ease`, `Move`, `Mini`, `ActorPhase`, `Actor`, `ScenePane`, `World`; constants `TIMING`, `MAX_MINIS`; functions `emptyWorld()`, `seatsUsed(pane)`, `moveProgress(move, now)`, `nextBlink(alias, now)`, `reconcile(world, snapshot, now)`, `tick(world, now)`. Both `reconcile` and `tick` mutate the world they are given and return it.

- [ ] **Step 1: Write the failing tests**

Create `packages/scene/src/actors.test.ts`:

```ts
import type { SessionSnapshot, Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { MAX_MINIS, TIMING, emptyWorld, reconcile, seatsUsed, tick } from "./actors";
import { MINI_HOME, doorOrigin, miniSlot, seatOrigin } from "./layout";

const T0 = 1_700_000_000_000;
const iso = (t: number): string => new Date(t).toISOString();

function session(over: Partial<SessionSnapshot> & { alias: string }): SessionSnapshot {
  return { label: "Otter", pane: "pane-1", state: "working", activity: "edit", subagents: 0, contextPct: null, since: iso(T0), updatedAt: iso(T0), ...over };
}

function snap(sessions: SessionSnapshot[], panes: Snapshot["panes"] = [{ pane: "pane-1", label: "Oak" }]): Snapshot {
  return { version: 1, generatedAt: iso(T0), panes, sessions };
}

describe("reconcile", () => {
  it("appends a pane and seats a new session at the lowest free seat, walking in from the door", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    expect(w.panes.map((p) => p.alias)).toEqual(["pane-1"]);
    expect(w.panes[0]!.seats).toEqual(["agent-1"]);
    const a = w.actors[0]!;
    expect(a.seat).toBe(0);
    expect(a.phase).toBe("entering");
    expect(a.pos).toEqual(doorOrigin(0, 1));
    expect(a.move).toMatchObject({ to: seatOrigin(0), dur: TIMING.enter, ease: "out" });
    expect(a.since).toBe(T0);
  });

  it("gives the second session seat 1 and reuses a vacated seat before growing", () => {
    let w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" }), session({ alias: "agent-2" })]), T0);
    expect(w.actors.map((a) => a.seat)).toEqual([0, 1]);
    // agent-1 vanishes and walks out; once gone its seat is free
    w = reconcile(w, snap([session({ alias: "agent-2" })]), T0 + 1000);
    expect(w.actors.find((a) => a.alias === "agent-1")!.phase).toBe("leaving");
    expect(w.panes[0]!.seats).toEqual(["agent-1", "agent-2"]);
    tick(w, T0 + 1000 + TIMING.leave + 1);
    expect(w.actors.map((a) => a.alias)).toEqual(["agent-2"]);
    expect(w.panes[0]!.seats).toEqual([null, "agent-2"]);
    w = reconcile(w, snap([session({ alias: "agent-2" }), session({ alias: "agent-3" })]), T0 + 5000);
    expect(w.actors.find((a) => a.alias === "agent-3")!.seat).toBe(0);
    expect(seatsUsed(w.panes[0]!)).toBe(2);
  });

  it("updates a known session in place without moving it", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    tick(w, T0 + TIMING.enter + 1);
    expect(w.actors[0]!.phase).toBe("seated");
    reconcile(w, snap([session({ alias: "agent-1", state: "waiting", activity: null, contextPct: 42, since: iso(T0 + 3000) })]), T0 + 3000);
    const a = w.actors[0]!;
    expect(a.state).toBe("waiting");
    expect(a.contextPct).toBe(42);
    expect(a.since).toBe(T0 + 3000);
    expect(a.seat).toBe(0);
    expect(a.move).toBeNull();
    expect(a.pos).toEqual(seatOrigin(0));
  });

  it("waves on done, then leaves after the wave, then is gone", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    tick(w, T0 + TIMING.enter + 1);
    reconcile(w, snap([session({ alias: "agent-1", state: "done", activity: null })]), T0 + 4000);
    expect(w.actors[0]!.phase).toBe("waving");
    tick(w, T0 + 4000 + TIMING.wave);
    expect(w.actors[0]!.phase).toBe("leaving");
    expect(w.actors[0]!.move).toMatchObject({ to: doorOrigin(0, 1), ease: "inout" });
    tick(w, T0 + 4000 + TIMING.wave + TIMING.leave);
    expect(w.actors).toEqual([]);
  });

  it("leaves at once, without the wave, when a session vanishes", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    reconcile(w, snap([]), T0 + 500);
    expect(w.actors[0]!.phase).toBe("leaving");
  });

  it("keeps a closing pane until its last actor is gone", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    reconcile(w, snap([], []), T0 + 500);
    expect(w.panes[0]!.closing).toBe(true);
    tick(w, T0 + 600);
    expect(w.panes).toHaveLength(1);
    tick(w, T0 + 500 + TIMING.leave);
    expect(w.panes).toEqual([]);
  });

  it("adds minis as the subagent count rises, capped, and sends the newest home as it falls", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1", subagents: 2 })]), T0);
    const a = w.actors[0]!;
    expect(a.subs.map((m) => m.k)).toEqual([0, 1]);
    expect(a.subs[0]!.move).toMatchObject({ from: MINI_HOME, to: miniSlot(0), ease: "out" });
    expect(a.sparkleUntil).toBe(T0 + TIMING.sparkle);
    reconcile(w, snap([session({ alias: "agent-1", subagents: 5 })]), T0 + 100);
    expect(a.subs.filter((m) => !m.leaving)).toHaveLength(MAX_MINIS);
    reconcile(w, snap([session({ alias: "agent-1", subagents: 1 })]), T0 + 200);
    expect(a.subs.filter((m) => m.leaving).map((m) => m.k)).toEqual([2, 1]);
    tick(w, T0 + 200 + TIMING.miniBack);
    expect(a.subs.map((m) => m.k)).toEqual([0]);
  });

  it("never changes an existing seat when the snapshot order changes", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" }), session({ alias: "agent-2" })]), T0);
    reconcile(w, snap([session({ alias: "agent-2" }), session({ alias: "agent-1" })]), T0 + 100);
    expect(w.actors.map((a) => [a.alias, a.seat])).toEqual([["agent-1", 0], ["agent-2", 1]]);
  });

  it("advances the blink clock past a blink window", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    const first = w.actors[0]!.blinkAt;
    expect(first).toBeGreaterThanOrEqual(T0 + 3000);
    expect(first).toBeLessThan(T0 + 7000);
    tick(w, first + TIMING.blink);
    expect(w.actors[0]!.blinkAt).toBeGreaterThan(first);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/scene test -- actors`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the actors module**

Create `packages/scene/src/actors.ts`:

```ts
// The world the scene draws: panes with seats, and actors that walk in, sit, wave and walk out.
// reconcile() brings the world in line with a snapshot; tick() advances tweens and phases. Both
// mutate the world they are given and return it; both are deterministic for a given clock, so the
// tests drive them with fixed times. No canvas here.
import type { Activity, SessionPhase, Snapshot } from "@clawd/core";
import { easeInOut, easeOut, lerp } from "./engine";
import { MINI_HOME, doorOrigin, miniSlot, seatOrigin, type XY } from "./layout";

export type Ease = "out" | "inout";
export type Move = { from: XY; to: XY; t0: number; dur: number; ease: Ease };
export type Mini = { k: number; pos: XY; move: Move | null; leaving: boolean };
export type ActorPhase = "entering" | "seated" | "waving" | "leaving" | "gone";

export type Actor = {
  alias: string;
  label: string;
  pane: string;
  seat: number;
  state: SessionPhase;
  activity: Activity | null;
  subagents: number;
  contextPct: number | null;
  /** Epoch ms the current state began, from the snapshot. */
  since: number;
  phase: ActorPhase;
  phaseAt: number;
  /** Pane-relative origin of the actor's seat-sized box; the sprite sits at pos + (SPRITE_DX, SPRITE_DY). */
  pos: XY;
  move: Move | null;
  blinkAt: number;
  sparkleUntil: number;
  glanceUntil: number;
  /** Minis are positioned relative to the actor's pos, so they travel with it. */
  subs: Mini[];
};

export type ScenePane = { alias: string; label: string; collision: boolean; seats: (string | null)[]; closing: boolean };
export type World = { panes: ScenePane[]; actors: Actor[] };

/** Milliseconds. */
export const TIMING = { enter: 2000, leave: 2600, wave: 1600, miniOut: 1200, miniBack: 1500, sparkle: 600, glance: 1600, blink: 140 } as const;
export const MAX_MINIS = 3;

export function emptyWorld(): World {
  return { panes: [], actors: [] };
}

/** Highest occupied seat index plus one: what the pane's height is computed from. */
export function seatsUsed(p: ScenePane): number {
  let n = p.seats.length;
  while (n > 0 && p.seats[n - 1] === null) n--;
  return n;
}

function firstFreeSeat(seats: (string | null)[]): number {
  const i = seats.indexOf(null);
  return i === -1 ? seats.length : i;
}

export function moveProgress(m: Move, now: number): number {
  return Math.min(1, Math.max(0, (now - m.t0) / m.dur));
}

function positionAt(m: Move, now: number): XY {
  const p = moveProgress(m, now);
  const e = m.ease === "out" ? easeOut(p) : easeInOut(p);
  return { x: lerp(m.from.x, m.to.x, e), y: lerp(m.from.y, m.to.y, e) };
}

/** A deterministic gap of 3 to 7 s until the next blink, from the clock and the alias. */
export function nextBlink(alias: string, now: number): number {
  let h = 0;
  for (const ch of alias) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return now + 3000 + ((h + now) % 4000);
}

function sendMiniHome(m: Mini, now: number): void {
  if (m.leaving) return;
  m.leaving = true;
  m.move = { from: { ...m.pos }, to: { ...MINI_HOME }, t0: now, dur: TIMING.miniBack, ease: "inout" };
}

function startLeaving(a: Actor, pane: ScenePane | undefined, now: number): void {
  a.phase = "leaving";
  a.phaseAt = now;
  const to = doorOrigin(a.seat, pane ? seatsUsed(pane) : a.seat + 1);
  a.move = { from: { ...a.pos }, to, t0: now, dur: TIMING.leave, ease: "inout" };
  for (const m of a.subs) sendMiniHome(m, now);
}

/** Grows or shrinks the visible minis toward `count`, capped at MAX_MINIS; the newest goes home first. */
function syncMinis(a: Actor, count: number, now: number): void {
  const wanted = Math.min(MAX_MINIS, Math.max(0, count));
  const active = a.subs.filter((m) => !m.leaving);
  while (active.length < wanted) {
    const used = new Set(active.map((m) => m.k));
    let k = 0;
    while (used.has(k)) k++;
    const m: Mini = { k, pos: { ...MINI_HOME }, move: { from: { ...MINI_HOME }, to: miniSlot(k), t0: now, dur: TIMING.miniOut, ease: "out" }, leaving: false };
    a.subs.push(m);
    active.push(m);
    a.sparkleUntil = now + TIMING.sparkle;
    a.glanceUntil = now + TIMING.glance;
  }
  while (active.length > wanted) {
    const newest = active.reduce((best, m) => (m.k > best.k ? m : best));
    sendMiniHome(newest, now);
    active.splice(active.indexOf(newest), 1);
  }
}

/**
 * Brings the world in line with a snapshot: new panes are appended, new sessions take the lowest
 * free seat in their pane and walk in from the door, known sessions are updated in place, done
 * sessions wave, vanished sessions leave without the wave.
 */
export function reconcile(world: World, s: Snapshot, now: number): World {
  const livePanes = new Set<string>();
  for (const ps of s.panes) {
    livePanes.add(ps.pane);
    const p = world.panes.find((x) => x.alias === ps.pane);
    if (p) {
      p.label = ps.label;
      p.collision = ps.collision ?? false;
      p.closing = false;
    } else {
      world.panes.push({ alias: ps.pane, label: ps.label, collision: ps.collision ?? false, seats: [], closing: false });
    }
  }
  for (const p of world.panes) if (!livePanes.has(p.alias)) p.closing = true;

  const seen = new Set<string>();
  for (const ss of s.sessions) {
    seen.add(ss.alias);
    let pane = world.panes.find((p) => p.alias === ss.pane);
    if (!pane) {
      // A session whose pane the snapshot did not list: keep it visible rather than lose it.
      pane = { alias: ss.pane, label: ss.pane, collision: false, seats: [], closing: false };
      world.panes.push(pane);
    }
    let a = world.actors.find((x) => x.alias === ss.alias);
    if (!a) {
      const seat = firstFreeSeat(pane.seats);
      pane.seats[seat] = ss.alias;
      const from = doorOrigin(seat, seatsUsed(pane));
      a = {
        alias: ss.alias,
        label: ss.label,
        pane: ss.pane,
        seat,
        state: ss.state,
        activity: ss.activity,
        subagents: 0,
        contextPct: ss.contextPct,
        since: Date.parse(ss.since),
        phase: "entering",
        phaseAt: now,
        pos: { ...from },
        move: { from, to: seatOrigin(seat), t0: now, dur: TIMING.enter, ease: "out" },
        blinkAt: nextBlink(ss.alias, now),
        sparkleUntil: 0,
        glanceUntil: 0,
        subs: [],
      };
      world.actors.push(a);
    }
    a.label = ss.label;
    a.activity = ss.activity;
    a.contextPct = ss.contextPct;
    a.since = Date.parse(ss.since);
    if (ss.state === "done" && (a.phase === "entering" || a.phase === "seated")) {
      a.phase = "waving";
      a.phaseAt = now;
      a.move = null;
    }
    a.state = ss.state;
    syncMinis(a, ss.subagents, now);
    a.subagents = ss.subagents;
  }
  for (const a of world.actors) {
    if (!seen.has(a.alias) && (a.phase === "entering" || a.phase === "seated")) {
      startLeaving(a, world.panes.find((p) => p.alias === a.pane), now);
    }
  }
  return world;
}

/** Advances every tween and phase to `now`, frees the seats of the gone, drops them and any empty closing pane. */
export function tick(world: World, now: number): World {
  for (const a of world.actors) {
    if (a.move) {
      a.pos = positionAt(a.move, now);
      if (moveProgress(a.move, now) >= 1) {
        a.move = null;
        if (a.phase === "entering") a.phase = "seated";
        else if (a.phase === "leaving") a.phase = "gone";
      }
    }
    if (a.phase === "waving" && now - a.phaseAt >= TIMING.wave) {
      startLeaving(a, world.panes.find((p) => p.alias === a.pane), now);
    }
    if (now >= a.blinkAt + TIMING.blink) a.blinkAt = nextBlink(a.alias, now);
    for (const m of a.subs) {
      if (!m.move) continue;
      m.pos = positionAt(m.move, now);
      if (moveProgress(m.move, now) >= 1) m.move = null;
    }
    a.subs = a.subs.filter((m) => !(m.leaving && m.move === null));
  }
  for (const a of world.actors) {
    if (a.phase !== "gone") continue;
    const pane = world.panes.find((p) => p.alias === a.pane);
    if (pane && pane.seats[a.seat] === a.alias) pane.seats[a.seat] = null;
  }
  world.actors = world.actors.filter((a) => a.phase !== "gone");
  world.panes = world.panes.filter((p) => !(p.closing && !world.actors.some((a) => a.pane === p.alias)));
  return world;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @clawd/scene test -- actors`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/actors.ts packages/scene/src/actors.test.ts
git commit -m "feat(scene): actor world with seats, arrivals, departures and subagent minis"
```

---

### Task 6: Poses and text

**Files:**
- Create: `packages/scene/src/poses.ts`
- Create: `packages/scene/src/text.ts`
- Test: `packages/scene/src/poses.test.ts`
- Test: `packages/scene/src/text.test.ts`

**Interfaces:**
- Consumes: `Actor`, `TIMING`, `moveProgress` from `./actors`; `PALETTE`, `EyeVariant`, `PixelContext` from `./engine`; `SCENE_COLOURS` from `./sprites`.
- Produces: `Pose`, `ACTIVITY_COLOURS`, `poseFor(actor, now, frame)`; `STATE_COLOURS`, `mmss(ms)`, `Nameplate`, `nameplate(actor, now)`, `paneTitle(label)`, `TextStyle`, `drawText(ctx, PX, text, gx, gy, col, style)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/scene/src/poses.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TIMING, type Actor } from "./actors";
import { PALETTE } from "./engine";
import { seatOrigin } from "./layout";
import { ACTIVITY_COLOURS, poseFor } from "./poses";

const T0 = 1_700_000_000_000;

function actor(over: Partial<Actor> = {}): Actor {
  return {
    alias: "agent-1", label: "Otter", pane: "pane-1", seat: 0, state: "working", activity: "edit", subagents: 0, contextPct: null,
    since: T0, phase: "seated", phaseAt: T0, pos: seatOrigin(0), move: null, blinkAt: T0 + 5000, sparkleUntil: 0, glanceUntil: 0, subs: [],
    ...over,
  };
}

describe("poseFor", () => {
  it("looks down and emits activity-coloured keystrokes while working", () => {
    const p = poseFor(actor(), T0, 9);
    expect(p.eyes).toBe("look_down");
    expect(p.particle).toMatchObject({ col: ACTIVITY_COLOURS.edit });
    expect(poseFor(actor(), T0, 10).particle).toBeNull();
    expect(ACTIVITY_COLOURS.read).toBe(PALETTE.state.blue);
    expect(ACTIVITY_COLOURS.run).toBe(PALETTE.state.amber);
  });

  it("hops, shows the exclamation mark and sweats after ten seconds while waiting", () => {
    const a = actor({ state: "waiting", activity: null });
    const early = poseFor(a, T0 + 200, 0);
    expect(early.eyes).toBe("forward");
    expect(early.bounce).toBeLessThan(0);
    expect(early.exclaim).toBe(true);
    expect(early.sweat).toBe(false);
    const rest = poseFor(a, T0 + 1000, 0);
    expect(rest.bounce).toBe(0);
    expect(poseFor(a, T0 + 1000, 24).exclaim).toBe(false);
    expect(poseFor(a, T0 + 10_001, 0).sweat).toBe(true);
  });

  it("blinks inside the blink window when idle or working, and not outside it", () => {
    const a = actor({ state: "idle", activity: null, blinkAt: T0 + 100 });
    expect(poseFor(a, T0 + 150, 0).eyes).toBe("blink");
    expect(poseFor(a, T0 + 100 + TIMING.blink, 0).eyes).toBe("forward");
    expect(poseFor(actor({ blinkAt: T0 + 100 }), T0 + 150, 1).eyes).toBe("blink");
  });

  it("closes its eyes, dims and shows zZ while asleep", () => {
    const p = poseFor(actor({ state: "asleep", activity: null }), T0, 0);
    expect(p.eyes).toBe("blink");
    expect(p.alpha).toBeCloseTo(0.82);
    expect(p.zzz).toBe(true);
  });

  it("waves alternate claws with hearts while waving", () => {
    const a = actor({ state: "done", activity: null, phase: "waving" });
    expect(poseFor(a, T0, 0).wave).toBe("right");
    expect(poseFor(a, T0, 8).wave).toBe("left");
    expect(poseFor(a, T0, 20).heart).toBe(true);
    expect(poseFor(a, T0, 5).particle).toMatchObject({ col: PALETTE.state.pink });
  });

  it("walks with alternating legs, eyes toward the destination, fading when leaving", () => {
    const from = { x: 2, y: 30 };
    const entering = actor({ phase: "entering", move: { from, to: seatOrigin(0), t0: T0, dur: 2000, ease: "out" } });
    const p = poseFor(entering, T0 + 500, 0);
    expect(p.moving).toBe(true);
    expect(p.step).toBe(true);
    expect(poseFor(entering, T0 + 500, 4).step).toBe(false);
    expect(p.eyes).toBe("forward");
    expect(p.alpha).toBe(1);
    const leaving = actor({ phase: "leaving", move: { from: seatOrigin(0), to: from, t0: T0, dur: 2000, ease: "inout" } });
    const q = poseFor(leaving, T0 + 1000, 0);
    expect(q.eyes).toBe("look_down");
    expect(q.alpha).toBeCloseTo(0.55);
    const sideways = actor({ phase: "entering", move: { from: { x: 0, y: 3 }, to: { x: 26, y: 3 }, t0: T0, dur: 2000, ease: "out" } });
    expect(poseFor(sideways, T0, 0).eyes).toBe("look_right");
  });

  it("sparkles, then glances right, after a subagent spawns", () => {
    const a = actor({ sparkleUntil: T0 + 600, glanceUntil: T0 + 1600 });
    expect(poseFor(a, T0 + 100, 1).sparkle).toBe(true);
    const later = poseFor(a, T0 + 1000, 1);
    expect(later.sparkle).toBe(false);
    expect(later.eyes).toBe("look_right");
    expect(poseFor(a, T0 + 2000, 1).eyes).toBe("look_down");
  });
});
```

Create `packages/scene/src/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PALETTE } from "./engine";
import { fakeContext } from "./testing/fake-context";
import { STATE_COLOURS, drawText, mmss, nameplate, paneTitle } from "./text";

const T0 = 1_700_000_000_000;

describe("text", () => {
  it("formats minutes and seconds, clamping negatives to zero", () => {
    expect(mmss(0)).toBe("00:00");
    expect(mmss(61_000)).toBe("01:01");
    expect(mmss(3_599_999)).toBe("59:59");
    expect(mmss(-5)).toBe("00:00");
  });

  it("builds a nameplate: lower-case name, subagent count, state with activity and time, state colour", () => {
    const np = nameplate({ label: "Otter", state: "working", activity: "edit", subagents: 2, since: T0 }, T0 + 12_000);
    expect(np).toEqual({ name: "otter", subs: " ×2", status: "working·edit 00:12", colour: PALETTE.state.green });
    const idle = nameplate({ label: "Heron", state: "idle", activity: null, subagents: 0, since: T0 }, T0);
    expect(idle).toEqual({ name: "heron", subs: "", status: "idle 00:00", colour: STATE_COLOURS.idle });
    expect(nameplate({ label: "Lynx", state: "waiting", activity: "edit", subagents: 0, since: T0 }, T0).status).toBe("waiting 00:00");
  });

  it("titles a pane with a dash and the lower-case label", () => {
    expect(paneTitle("Oak")).toBe("─ oak");
  });

  it("draws text at a cell boundary with the requested style", () => {
    const { ctx, texts } = fakeContext();
    drawText(ctx, 6, "hi", 3, 4, "#abc", { size: 11, font: "Mono", bold: true, align: "center" });
    expect(texts[0]).toMatchObject({ text: "hi", x: 18, y: 24, col: "#abc", font: "bold 11px Mono", align: "center" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/scene test -- poses text`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write poses.ts**

Create `packages/scene/src/poses.ts`:

```ts
// What a Clawd looks like this frame, from its actor and the clock. Pure; the renderer only draws
// what a Pose says. Follows the PRD's state table: mood is eyes, accessories and particles.
import type { Activity } from "@clawd/core";
import { TIMING, moveProgress, type Actor } from "./actors";
import { PALETTE, type EyeVariant } from "./engine";
import { SCENE_COLOURS } from "./sprites";

export type Pose = {
  eyes: EyeVariant;
  /** Vertical offset in cells; negative is up. */
  bounce: number;
  /** The walking step frame. */
  step: boolean;
  alpha: number;
  moving: boolean;
  exclaim: boolean;
  sweat: boolean;
  zzz: boolean;
  sparkle: boolean;
  wave: "left" | "right" | null;
  /** A particle to emit this frame: offset from the sprite origin and colour. */
  particle: { dx: number; dy: number; col: string } | null;
  heart: boolean;
};

/** Keystroke colours by activity. */
export const ACTIVITY_COLOURS: Record<Activity, string> = {
  read: PALETTE.state.blue,
  edit: PALETTE.state.green,
  run: PALETTE.state.amber,
  web: SCENE_COLOURS.web,
  spawn: PALETTE.clawd.body,
  think: PALETTE.night.starMid,
  other: PALETTE.night.starMid,
};

const HOP_PERIOD_MS = 1500;
const HOP_PART = 0.35;
const SWEAT_AFTER_MS = 10_000;

function restingPose(): Pose {
  return { eyes: "forward", bounce: 0, step: false, alpha: 1, moving: false, exclaim: false, sweat: false, zzz: false, sparkle: false, wave: null, particle: null, heart: false };
}

export function poseFor(a: Actor, now: number, frame: number): Pose {
  const pose = restingPose();
  const m = a.move;
  if (m && (a.phase === "entering" || a.phase === "leaving")) {
    pose.moving = true;
    pose.eyes = m.to.x > m.from.x ? "look_right" : m.to.x < m.from.x ? "look_left" : m.to.y > m.from.y ? "look_down" : "forward";
    pose.step = Math.floor(frame / 4) % 2 === 0;
    pose.bounce = Math.round(Math.sin(frame * 0.8)) === 1 ? -1 : 0;
    if (a.phase === "leaving") pose.alpha = Math.max(0.1, 1 - moveProgress(m, now) * 0.9);
    return pose;
  }
  if (a.phase === "waving") {
    pose.wave = Math.floor(frame / 8) % 2 === 0 ? "right" : "left";
    if (frame % 5 === 0) pose.particle = { dx: 4 + (frame % 7), dy: -1, col: PALETTE.state.pink };
    pose.heart = frame % 20 === 0;
    return pose;
  }
  const blinking = now >= a.blinkAt && now < a.blinkAt + TIMING.blink;
  switch (a.state) {
    case "working":
      pose.eyes = blinking ? "blink" : "look_down";
      pose.bounce = Math.round(Math.sin(frame * 0.12) * 0.5);
      if (frame % 9 === 0) pose.particle = { dx: frame % 18 === 0 ? 1 : 12, dy: 2, col: a.activity ? ACTIVITY_COLOURS[a.activity] : PALETTE.night.starMid };
      break;
    case "waiting": {
      const elapsed = Math.max(0, now - a.since);
      const hp = (elapsed % HOP_PERIOD_MS) / HOP_PERIOD_MS;
      if (hp < HOP_PART) pose.bounce = -Math.round(Math.sin((hp / HOP_PART) * Math.PI) * 2);
      pose.exclaim = Math.floor(frame / 12) % 3 !== 2;
      pose.sweat = elapsed > SWEAT_AFTER_MS;
      break;
    }
    case "idle":
      pose.eyes = blinking ? "blink" : "forward";
      pose.bounce = Math.round(Math.sin(frame * 0.09) * 0.5);
      break;
    case "asleep":
      pose.eyes = "blink";
      pose.alpha = 0.82;
      pose.bounce = Math.round(Math.sin(frame * 0.05) * 0.5);
      pose.zzz = true;
      break;
    case "done":
      break;
    default:
      a.state satisfies never;
  }
  if (now < a.sparkleUntil) pose.sparkle = true;
  else if (now < a.glanceUntil && a.state !== "asleep") pose.eyes = "look_right";
  return pose;
}
```

- [ ] **Step 4: Write text.ts**

Create `packages/scene/src/text.ts`:

```ts
// Strings for nameplates and titles, and the one place text is put on the canvas.
import type { Activity, SessionPhase } from "@clawd/core";
import { PALETTE, type PixelContext } from "./engine";

export const STATE_COLOURS: Record<SessionPhase, string> = {
  working: PALETTE.state.green,
  waiting: PALETTE.state.amber,
  idle: PALETTE.night.text,
  asleep: PALETTE.state.blue,
  done: PALETTE.state.pink,
};

/** `mm:ss` for a duration; negatives read as zero. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export type Nameplate = { name: string; subs: string; status: string; colour: string };

/** Two lines under a Clawd: the name with its subagent count, then state, activity and time in state. */
export function nameplate(a: { label: string; state: SessionPhase; activity: Activity | null; subagents: number; since: number }, now: number): Nameplate {
  const activity = a.state === "working" && a.activity ? `·${a.activity}` : "";
  return {
    name: a.label.toLowerCase(),
    subs: a.subagents > 0 ? ` ×${a.subagents}` : "",
    status: `${a.state}${activity} ${mmss(now - a.since)}`,
    colour: STATE_COLOURS[a.state],
  };
}

export function paneTitle(label: string): string {
  return `─ ${label.toLowerCase()}`;
}

export type TextStyle = { size: number; font: string; bold?: boolean; align?: CanvasTextAlign; baseline?: CanvasTextBaseline };

/** Draws text anchored on a cell boundary. `size` is in canvas pixels, already scaled for the pixel ratio. */
export function drawText(ctx: PixelContext, PX: number, text: string, gx: number, gy: number, col: string, style: TextStyle): void {
  ctx.fillStyle = col;
  ctx.font = `${style.bold ? "bold " : ""}${style.size}px ${style.font}`;
  ctx.textAlign = style.align ?? "left";
  ctx.textBaseline = style.baseline ?? "top";
  ctx.fillText(text, gx * PX, gy * PX);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @clawd/scene test -- poses text`
Expected: 7 + 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/scene/src/poses.ts packages/scene/src/poses.test.ts packages/scene/src/text.ts packages/scene/src/text.test.ts
git commit -m "feat(scene): poses per state and nameplate text"
```

---

### Task 7: The panes scene mount, exports and README

**Files:**
- Create: `packages/scene/src/panes.ts`
- Modify: `packages/scene/src/index.ts`
- Create: `packages/scene/README.md`
- Test: `packages/scene/src/panes.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `PanesSceneOptions`, `PanesScene`, `mountPanesScene(canvas, opts?)`; the package barrel additionally exports `CELL` and `mmss`.

- [ ] **Step 1: Write the failing smoke test**

Create `packages/scene/src/panes.test.ts`:

```ts
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

function harness() {
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
    devicePixelRatio: 1,
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @clawd/scene test -- panes`
Expected: FAIL, module not found.

- [ ] **Step 3: Write panes.ts**

Create `packages/scene/src/panes.ts`:

```ts
// The panes scene: one canvas, one loop. Takes snapshots, draws frames. Everything with a side
// effect lives here; the thinking is in layout.ts, actors.ts, poses.ts and text.ts.
import type { Snapshot } from "@clawd/core";
import { emptyWorld, reconcile, seatsUsed, tick, type Actor, type ScenePane, type World } from "./actors";
import { createAtmosphere, drawNight, type Atmosphere } from "./atmosphere";
import { CLAWD_BODY, PALETTE, createEngine, type EyeVariant, type PixelContext } from "./engine";
import { CELL, CONTEXT_ROW, CONTEXT_W, NAME_ROW, SEAT_H, SEAT_W, SPRITE_DX, SPRITE_DY, STATUS_ROW, layoutPanes, type PaneRect } from "./layout";
import { poseFor } from "./poses";
import { drawBox, drawClawdWalking, drawClawdWave, drawExclaim, drawMini, drawSparkle, drawSweat, drawZzz } from "./sprites";
import { drawText, nameplate, paneTitle } from "./text";

export type PanesSceneOptions = {
  /** CSS pixels per cell. Default 6. */
  cellSize?: number;
  /** Frames per second. Default 30. */
  fps?: number;
  /** Canvas font family for text. Default the system monospace stack. */
  font?: string;
  /** Wall clock, for time-in-state and tweens. Default Date.now. */
  now?: () => number;
  /** A Clawd or its nameplate was clicked. */
  onSelect?: (alias: string) => void;
  /** Injection points; tests use them, hosts leave them alone. */
  devicePixelRatio?: number;
  requestAnimationFrame?: (fn: (ts: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  /** Where visibilitychange is listened for; null disables the listener. Default the global document. */
  document?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> | null;
};

export type PanesScene = {
  /** Reconcile the world with a snapshot: arrivals walk in, departures walk out. */
  setSnapshot(s: Snapshot): void;
  /** Drop every pane and actor at once, for a source switch. */
  clear(): void;
  /** CSS size of the canvas; the backing store is scaled by the pixel ratio. */
  resize(cssWidth: number, cssHeight: number): void;
  setPaused(paused: boolean): void;
  /** The alias under a point in CSS pixels, or null. */
  hitTest(cssX: number, cssY: number): string | null;
  destroy(): void;
};

const DEFAULT_FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const TEXT_CSS_PX = 11;
/** Share of the remaining distance a pane's drawn origin closes each frame: about 400 ms to settle at 30 fps. */
const SLIDE = 0.25;
/** Monospace glyph width as a share of the font size, for the title's backing rectangle. */
const GLYPH_W = 0.65;

const NOOP_SCENE: PanesScene = { setSnapshot() {}, clear() {}, resize() {}, setPaused() {}, hitTest: () => null, destroy() {} };

export function mountPanesScene(canvas: HTMLCanvasElement, opts: PanesSceneOptions = {}): PanesScene {
  const ctx = canvas.getContext("2d") as PixelContext | null;
  if (!ctx) return NOOP_SCENE;
  const cell = opts.cellSize ?? CELL;
  const fps = opts.fps ?? 30;
  const now = opts.now ?? (() => Date.now());
  const font = opts.font ?? DEFAULT_FONT;
  const dpr = opts.devicePixelRatio ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const raf = opts.requestAnimationFrame ?? ((fn) => requestAnimationFrame(fn));
  const caf = opts.cancelAnimationFrame ?? ((h) => cancelAnimationFrame(h));
  const doc = opts.document === undefined ? (typeof document === "undefined" ? null : document) : opts.document;

  const PX = Math.max(1, Math.round(cell * dpr));
  const textPx = Math.max(6, Math.round(TEXT_CSS_PX * (PX / cell)));
  const engine = createEngine(ctx, PX);
  const world: World = emptyWorld();
  /** Drawn pane origins, easing toward the layout's targets. */
  const origins = new Map<string, { x: number; y: number }>();
  let rects = new Map<string, PaneRect>();
  let atmo: Atmosphere = createAtmosphere(1, 1);
  let gridW = 1;
  let gridH = 1;
  let frame = 0;
  let acc = 0;
  let last: number | null = null;
  let handle: number | null = null;
  let stopped = false;
  let paused = false;
  let hidden = doc?.hidden ?? false;
  let hover: string | null = null;

  function paneRects(): Map<string, PaneRect> {
    const laid = layoutPanes(world.panes.map((p) => ({ alias: p.alias, seatsUsed: seatsUsed(p) })), gridW);
    const out = new Map<string, PaneRect>();
    for (const r of laid) {
      const cur = origins.get(r.alias) ?? { x: r.x, y: r.y };
      const next = { x: cur.x + (r.x - cur.x) * SLIDE, y: cur.y + (r.y - cur.y) * SLIDE };
      if (Math.abs(next.x - r.x) < 0.05) next.x = r.x;
      if (Math.abs(next.y - r.y) < 0.05) next.y = r.y;
      origins.set(r.alias, next);
      out.set(r.alias, { ...r, x: next.x, y: next.y });
    }
    for (const alias of [...origins.keys()]) if (!out.has(alias)) origins.delete(alias);
    return out;
  }

  function drawPane(p: ScenePane, r: PaneRect): void {
    const waiting = world.actors.some((a) => a.pane === p.alias && a.state === "waiting" && (a.phase === "entering" || a.phase === "seated"));
    const line = waiting ? PALETTE.state.amber : PALETTE.night.line;
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    drawBox(engine, x, y, r.w, r.h, line);
    const title = paneTitle(p.label);
    ctx.fillStyle = PALETTE.night.bg;
    ctx.fillRect((x + 2) * PX, (y - 1) * PX, Math.ceil((title.length + 1) * textPx * GLYPH_W), 3 * PX);
    drawText(ctx, PX, title, x + 3, y + 0.5, waiting ? PALETTE.state.amber : PALETTE.night.text, { size: textPx, font, baseline: "middle" });
    if (p.collision) {
      ctx.fillStyle = PALETTE.night.bg;
      ctx.fillRect((x + r.w - 5) * PX, (y - 1) * PX, 3 * PX, 3 * PX);
      drawText(ctx, PX, "!", x + r.w - 3, y + 0.5, PALETTE.state.amber, { size: textPx, font, bold: true, align: "right", baseline: "middle" });
    }
  }

  function drawActor(a: Actor, r: PaneRect, t: number): void {
    const pose = poseFor(a, t, frame);
    const sx = Math.round(r.x + a.pos.x);
    const sy = Math.round(r.y + a.pos.y);
    const ox = sx + SPRITE_DX;
    const oy = sy + SPRITE_DY + pose.bounce;
    ctx.globalAlpha = pose.alpha;
    if (pose.moving) drawClawdWalking(engine, ox, oy, pose.eyes, pose.step, PALETTE.night.bg);
    else if (pose.wave) drawClawdWave(engine, ox, oy, pose.eyes, pose.wave);
    else engine.drawClawd(ox, oy, { eyes: pose.eyes });
    if (pose.exclaim) drawExclaim(engine, ox, oy, PALETTE.state.amber);
    if (pose.sweat) drawSweat(engine, ox, oy);
    if (pose.zzz) drawZzz(engine, ox, oy, frame);
    if (pose.sparkle) drawSparkle(engine, ox, oy);
    if (pose.particle) engine.addParticle(ox + pose.particle.dx, oy + pose.particle.dy, pose.particle.col);
    if (pose.heart) engine.drawHeart(ox + 16, oy - 3, PALETTE.state.pink);
    const stepping = Math.floor(frame / 4) % 2 === 0;
    for (const m of a.subs) drawMini(engine, Math.round(r.x + a.pos.x + m.pos.x), Math.round(r.y + a.pos.y + m.pos.y), m.move !== null && stepping);

    const np = nameplate(a, t);
    const cx = sx + SPRITE_DX + CLAWD_BODY.width / 2;
    if (np.subs) {
      drawText(ctx, PX, np.name, cx, sy + NAME_ROW, PALETTE.night.textBright, { size: textPx, font, bold: true, align: "right" });
      drawText(ctx, PX, np.subs, cx, sy + NAME_ROW, PALETTE.clawd.body, { size: textPx, font, bold: true, align: "left" });
    } else {
      drawText(ctx, PX, np.name, cx, sy + NAME_ROW, PALETTE.night.textBright, { size: textPx, font, bold: true, align: "center" });
    }
    drawText(ctx, PX, np.status, cx, sy + STATUS_ROW, np.colour, { size: textPx, font, align: "center" });
    if (a.contextPct !== null) {
      const filled = Math.round((CONTEXT_W * a.contextPct) / 100);
      const bx = sx + SPRITE_DX + Math.floor((CLAWD_BODY.width - CONTEXT_W) / 2);
      const col = a.contextPct >= 80 ? PALETTE.state.amber : PALETTE.night.starMid;
      for (let i = 0; i < CONTEXT_W; i++) engine.px(bx + i, sy + CONTEXT_ROW, i < filled ? col : PALETTE.night.path);
    }
    ctx.globalAlpha = 1;
  }

  function drawEmpty(): void {
    const ox = Math.floor((gridW - CLAWD_BODY.width) / 2);
    const oy = Math.floor((gridH - CLAWD_BODY.height) / 2) - 2;
    const eyes: EyeVariant = frame % 80 >= 75 ? "blink" : "forward";
    engine.drawClawd(ox, oy + Math.round(Math.sin(frame * 0.12) * 0.5), { eyes });
    drawText(ctx, PX, "no sessions", ox + CLAWD_BODY.width / 2, oy + CLAWD_BODY.height + 3, PALETTE.night.text, { size: textPx, font, align: "center" });
  }

  function render(): void {
    const t = now();
    tick(world, t);
    drawNight(ctx, engine, atmo, frame);
    if (world.panes.length === 0) drawEmpty();
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
      for (const a of actors) drawActor(a, r, t);
    }
    engine.tickParticles();
  }

  function schedule(): void {
    if (!stopped && !paused && !hidden && handle === null) handle = raf(loop);
  }

  function halt(): void {
    if (handle !== null) {
      caf(handle);
      handle = null;
    }
    last = null;
  }

  function loop(ts: number): void {
    handle = null;
    if (stopped) return;
    if (last === null) last = ts;
    acc += Math.min(0.1, (ts - last) / 1000);
    last = ts;
    if (acc >= 1 / fps) {
      acc = 0;
      frame++;
      render();
    }
    schedule();
  }

  function resize(cssW: number, cssH: number): void {
    canvas.width = Math.max(PX, Math.round(cssW * dpr));
    canvas.height = Math.max(PX, Math.round(cssH * dpr));
    gridW = Math.floor(canvas.width / PX);
    gridH = Math.floor(canvas.height / PX);
    atmo = createAtmosphere(gridW, gridH);
    render();
  }

  function hitTest(cssX: number, cssY: number): string | null {
    const gx = cssX / cell;
    const gy = cssY / cell;
    for (const a of world.actors) {
      if (a.phase !== "entering" && a.phase !== "seated" && a.phase !== "waving") continue;
      const r = rects.get(a.pane);
      if (!r) continue;
      const x = r.x + a.pos.x;
      const y = r.y + a.pos.y;
      if (gx >= x && gx < x + SEAT_W && gy >= y && gy < y + SEAT_H) return a.alias;
    }
    return null;
  }

  const localPoint = (e: MouseEvent): { x: number; y: number } => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const onClick = (e: MouseEvent): void => {
    const p = localPoint(e);
    const alias = hitTest(p.x, p.y);
    if (alias) opts.onSelect?.(alias);
  };
  const onMove = (e: MouseEvent): void => {
    const p = localPoint(e);
    const alias = hitTest(p.x, p.y);
    if (alias !== hover) {
      hover = alias;
      canvas.style.cursor = alias ? "pointer" : "";
    }
  };
  const onVisibility = (): void => {
    hidden = doc?.hidden ?? false;
    if (hidden) halt();
    else schedule();
  };
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("pointermove", onMove);
  doc?.addEventListener("visibilitychange", onVisibility);

  resize(canvas.width / dpr, canvas.height / dpr);
  schedule();

  return {
    setSnapshot(s) {
      reconcile(world, s, now());
    },
    clear() {
      world.panes.length = 0;
      world.actors.length = 0;
      origins.clear();
      engine.clearParticles();
      render();
    },
    resize,
    setPaused(p) {
      paused = p;
      if (paused) halt();
      else schedule();
    },
    hitTest,
    destroy() {
      stopped = true;
      halt();
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("pointermove", onMove);
      doc?.removeEventListener("visibilitychange", onVisibility);
      engine.clearParticles();
    },
  };
}
```

- [ ] **Step 4: Export from the barrel**

Replace `packages/scene/src/index.ts` with:

```ts
// @clawd/scene
// The canvas renderer. The engine (engine.ts) is the clawd-animation skill's pixel engine as a
// module; scenes are written around it. Framework-free: given a canvas, a scene draws frames.

export * from "./engine";
export { mountIdleClawd, type IdleClawdOptions } from "./idle";
export { mountPanesScene, type PanesScene, type PanesSceneOptions } from "./panes";
export { CELL } from "./layout";
export { mmss } from "./text";

export const SCENE_VERSION = "0.1.0";
```

- [ ] **Step 5: Run the test to verify it passes, then the whole package**

Run: `pnpm --filter @clawd/scene test -- panes`
Expected: 4 passed.

Run: `pnpm --filter @clawd/scene test && pnpm --filter @clawd/scene typecheck`
Expected: every scene test file passes; `tsc --noEmit` is clean.

If the hit-test assertion fails because the actor is still walking in at `T0 + 5000` is not the case (the walk lasts 2 s, so it is seated), check that `rects` was populated by the render the two `frame()` calls triggered: the first call sets `last`, the second accumulates 0.1 s and renders.

- [ ] **Step 6: Write the README**

Create `packages/scene/README.md`:

```markdown
# @clawd/scene

The canvas renderer. Framework-free: give it a canvas and snapshots, it draws frames.

| Module | What it holds |
| --- | --- |
| `engine.ts` | The clawd-animation skill's pixel engine, unchanged: palette, the 14 by 8 Clawd, eyes, particles, easing. |
| `idle.ts` | One idle Clawd, breathing and blinking; the app's avatar. |
| `sprites.ts` | Accessories drawn over a Clawd: walking legs, a waving claw, the exclamation mark, sweat, zZ, sparkles, the 7 by 4 mini Clawd, box outlines. |
| `atmosphere.ts` | Seeded stars and drifting clouds. |
| `layout.ts` | Cell geometry: seats, panes, doors, mini slots, the pane flow. Pure. |
| `actors.ts` | The world: panes with seats and actors that walk in, sit, wave and leave. `reconcile()` with a snapshot, `tick()` with the clock. Pure. |
| `poses.ts` | What a Clawd looks like this frame from its state. Pure. |
| `text.ts` | Nameplates, titles, `mmss`, and the one text-drawing function. |
| `panes.ts` | `mountPanesScene(canvas, options)`: the loop, drawing, pointer events, visibility pause. |

```ts
const scene = mountPanesScene(canvas, { font: "JetBrains Mono", onSelect: (alias) => open(alias) });
scene.resize(width, height);   // CSS pixels; call again from a ResizeObserver
scene.setSnapshot(snapshot);   // as often as snapshots arrive
scene.destroy();
```

Design: `docs/superpowers/specs/2026-09-12-web-app-design.md`, section 4.

```
pnpm --filter @clawd/scene test
pnpm --filter @clawd/scene typecheck
```
```

- [ ] **Step 7: Commit**

```bash
git add packages/scene/src/panes.ts packages/scene/src/panes.test.ts packages/scene/src/index.ts packages/scene/README.md
git commit -m "feat(scene): the panes scene: layout, actors, poses and pointer events on one canvas"
```

---

## Plan self-review

- **Spec coverage, section 4:** 4.1 layout (Tasks 1 to 7 map one file each; `testing/fake-context.ts` in Task 1); 4.2 API (Task 7, plus injection options for tests); 4.3 geometry (Task 4: constants match the table; door under the seat; mini slots at the right side; flow and bands; empty state in Task 7); 4.4 actors (Task 5: seats, entering, waving then leaving, vanish without wave, closing panes, minis capped at three, seats freed only when gone); 4.5 poses (Task 6, every row of the table); 4.6 nameplates, context bar, titles, amber border, collision mark (Tasks 6 and 7); 4.7 loop with accumulator, visibility pause, wall-clock tweens (Task 7); 4.8 tests (each task).
- **Deviation from the spec, recorded here:** `reconcile` and `tick` mutate the world in place rather than returning new lists; the spec's "pure" is kept in the sense that matters, determinism for a given clock. The spec is updated to say so when this plan lands.
- **Type consistency:** `seatsUsed`, `doorOrigin(k, seatsUsed)`, `miniSlot(k)`, `MINI_HOME`, `moveProgress`, `TIMING`, `Pose` fields and `PaneRect` are used with the same names and shapes in Tasks 4 to 7.
