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
