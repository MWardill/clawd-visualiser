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
});
