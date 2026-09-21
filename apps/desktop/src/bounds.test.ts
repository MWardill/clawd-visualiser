import { describe, expect, it } from "vitest";
import { GRAB_STRIP, restoredBounds } from "./bounds";

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("restoredBounds", () => {
  it("has nothing to restore when nothing was saved", () => {
    expect(restoredBounds(undefined, [PRIMARY])).toBeNull();
  });

  it("restores bounds whose title strip is on a display, including a second one", () => {
    const onPrimary = { x: 100, y: 80, width: 1280, height: 800 };
    const onRight = { x: 2200, y: 100, width: 1280, height: 800 };
    expect(restoredBounds(onPrimary, [PRIMARY])).toEqual(onPrimary);
    expect(restoredBounds(onRight, [PRIMARY, RIGHT])).toEqual(onRight);
  });

  it("drops bounds left on a display that is no longer there", () => {
    expect(restoredBounds({ x: 2200, y: 100, width: 1280, height: 800 }, [PRIMARY])).toBeNull();
  });

  it("drops bounds whose title strip is above the top of every display", () => {
    expect(restoredBounds({ x: 100, y: -20, width: 1280, height: 800 }, [PRIMARY])).toBeNull();
  });

  it("needs enough of the title strip's width on a display to grab it", () => {
    const edge = PRIMARY.width;
    expect(restoredBounds({ x: edge - (GRAB_STRIP.width - 1), y: 100, width: 1280, height: 800 }, [PRIMARY])).toBeNull();
    expect(restoredBounds({ x: edge - GRAB_STRIP.width, y: 100, width: 1280, height: 800 }, [PRIMARY])).not.toBeNull();
  });

  it("counts a title strip that lies across the seam of two displays, side by side or stacked", () => {
    const narrow = { x: 1850, y: 100, width: 150, height: 120 };
    expect(restoredBounds(narrow, [PRIMARY, RIGHT])).toEqual(narrow);
    const TOP = { x: 0, y: 0, width: 1920, height: 1080 };
    const BOTTOM = { x: 0, y: 1080, width: 1920, height: 1080 };
    const across = { x: 100, y: 1064, width: 1280, height: 800 };
    expect(restoredBounds(across, [TOP, BOTTOM])).toEqual(across);
  });

  it("does not count two displays that each show only part of the strip's height", () => {
    expect(restoredBounds({ x: 1500, y: -12, width: 1280, height: 800 }, [PRIMARY, RIGHT])).toBeNull();
  });

  it("clamps bounds saved on a larger display to the work area holding most of the window, and pulls what it shrank inside", () => {
    expect(restoredBounds({ x: 100, y: 80, width: 2400, height: 1300 }, [PRIMARY])).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    expect(restoredBounds({ x: 400, y: 80, width: 1280, height: 1300 }, [PRIMARY])).toEqual({ x: 400, y: 0, width: 1280, height: 1040 });
    // A window that fits is left exactly where it was, even hanging off an edge, since that was the user's choice.
    const hanging = { x: 1000, y: 80, width: 1280, height: 800 };
    expect(restoredBounds(hanging, [PRIMARY])).toEqual(hanging);
  });
});
