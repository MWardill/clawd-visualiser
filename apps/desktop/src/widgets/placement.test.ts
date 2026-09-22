import { describe, expect, it } from "vitest";
import { DEFAULT_WIDGET_SIZE, SLOT_GAP, clampDrop, placeWidget } from "./placement";

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT = { x: -1280, y: 0, width: 1280, height: 984 };
const SIZE = DEFAULT_WIDGET_SIZE;
const FIRST = { x: PRIMARY.width - SIZE.width - SLOT_GAP, y: SLOT_GAP, ...SIZE };

const place = (over: Partial<Parameters<typeof placeWidget>[0]> = {}) => placeWidget({ remembered: undefined, size: SIZE, workAreas: [PRIMARY], primary: PRIMARY, taken: [], ...over });

describe("placeWidget", () => {
  it("puts the first widget at the top right of the primary work area, and the next ones under it", () => {
    expect(place()).toEqual(FIRST);
    const second = place({ taken: [FIRST] });
    expect(second).toEqual({ ...FIRST, y: FIRST.y + SIZE.height + SLOT_GAP });
    expect(place({ taken: [FIRST, second] }).y).toBe(second.y + SIZE.height + SLOT_GAP);
  });

  it("starts a new column to the left when the next slot would leave the work area", () => {
    const column = Array.from({ length: 5 }, (_, i) => ({ ...FIRST, y: FIRST.y + i * (SIZE.height + SLOT_GAP) }));
    // five fit in 1040 px: 12 + 5 * 192 = 972; a sixth would end at 1152
    expect(place({ taken: column })).toEqual({ ...FIRST, x: FIRST.x - SIZE.width - SLOT_GAP });
  });

  it("measures the slots against the window's own size, and respects a work area that does not start at the origin", () => {
    const tall = { width: 346, height: 384 };
    const primary = { x: 100, y: 50, width: 1600, height: 900 };
    expect(place({ size: tall, primary, workAreas: [primary] })).toEqual({ x: 100 + 1600 - 346 - SLOT_GAP, y: 50 + SLOT_GAP, ...tall });
  });

  it("goes back where it was left, on any display, at the size it has now", () => {
    expect(place({ remembered: { x: 40, y: 60, pinned: true } })).toEqual({ x: 40, y: 60, ...SIZE });
    expect(place({ remembered: { x: -1000, y: 100, pinned: false }, workAreas: [PRIMARY, LEFT] })).toEqual({ x: -1000, y: 100, ...SIZE });
  });

  it("falls back to a default slot when the remembered place is on no display now", () => {
    expect(place({ remembered: { x: -1000, y: 100, pinned: false }, workAreas: [PRIMARY] })).toEqual(FIRST);
  });

  it("gives up looking for a free slot rather than loop for ever", () => {
    expect(place({ taken: [{ x: -5000, y: -5000, width: 10_000, height: 10_000 }] })).toEqual(FIRST);
  });

  it("can stack upward from the bottom right, for a popup, and starts a new column to the left there too", () => {
    const bottom = { x: FIRST.x, y: PRIMARY.height - SIZE.height - SLOT_GAP, ...SIZE };
    expect(place({ stack: "up" })).toEqual(bottom);
    const above = place({ stack: "up", taken: [bottom] });
    expect(above).toEqual({ ...bottom, y: bottom.y - SIZE.height - SLOT_GAP });
    const column = Array.from({ length: 5 }, (_, i) => ({ ...bottom, y: bottom.y - i * (SIZE.height + SLOT_GAP) }));
    expect(place({ stack: "up", taken: column })).toEqual({ ...bottom, x: bottom.x - SIZE.width - SLOT_GAP });
    // a remembered place wins whichever way the slots stack
    expect(place({ stack: "up", remembered: { x: 40, y: 60, pinned: false } })).toEqual({ x: 40, y: 60, ...SIZE });
  });
});

describe("clampDrop", () => {
  it("leaves a widget where it was dropped while its top strip can still be grabbed", () => {
    const hanging = { x: 1700, y: 900, ...SIZE };
    expect(clampDrop(hanging, [PRIMARY])).toEqual(hanging);
  });

  it("pulls a widget dropped off every display wholly inside the nearest one", () => {
    expect(clampDrop({ x: 2500, y: 300, ...SIZE }, [PRIMARY])).toEqual({ x: PRIMARY.width - SIZE.width, y: 300, ...SIZE });
    expect(clampDrop({ x: 300, y: -400, ...SIZE }, [PRIMARY])).toEqual({ x: 300, y: 0, ...SIZE });
    expect(clampDrop({ x: -3000, y: 2000, ...SIZE }, [PRIMARY, LEFT])).toEqual({ x: LEFT.x, y: LEFT.height - SIZE.height, ...SIZE });
  });

  it("has nowhere to pull to with no display reported", () => {
    const lost = { x: 9000, y: 9000, ...SIZE };
    expect(clampDrop(lost, [])).toEqual(lost);
  });
});
