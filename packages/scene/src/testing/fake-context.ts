import type { PixelContext } from "../engine";

export type FilledRect = { x: number; y: number; w: number; h: number; col: string; alpha: number };
export type DrawnText = { text: string; x: number; y: number; col: string; font: string; align: CanvasTextAlign; alpha: number };
export type Cell = { x: number; y: number; col: string };

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

/** The colour last drawn at a cell, or undefined when nothing was. */
export function lastColourAt(cells: Cell[], x: number, y: number): string | undefined {
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i]!;
    if (c.x === x && c.y === y) return c.col;
  }
  return undefined;
}
