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
/** The caption row inside the seat: what the session is working on, when the detail level says. */
export const CAPTION_ROW = 21;

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
