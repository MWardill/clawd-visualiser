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
  const right = CLAWD_BODY.anchors.handRight.x;
  const left = CLAWD_BODY.anchors.handLeft.x;
  if (side === "right") {
    engine.px(ox + right, oy + 1, col);
    engine.px(ox + right + 1, oy, col);
  } else {
    engine.px(ox + left, oy + 1, col);
    engine.px(ox + left - 1, oy, col);
  }
}

/** An exclamation mark centred above the head: three cells in a column with a gap before the dot. */
export function drawExclaim(engine: Engine, ox: number, oy: number, col: string): void {
  const cx = ox + CLAWD_BODY.anchors.hatTop.x;
  engine.px(cx, oy - 4, col);
  engine.px(cx, oy - 3, col);
  engine.px(cx, oy - 1, col);
}

/** A sweat drop at the right edge of the head. */
export function drawSweat(engine: Engine, ox: number, oy: number): void {
  const col = ox + CLAWD_BODY.anchors.handRight.x;
  engine.px(col, oy - 1, PALETTE.state.blue);
  engine.px(col, oy, PALETTE.state.blue);
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
