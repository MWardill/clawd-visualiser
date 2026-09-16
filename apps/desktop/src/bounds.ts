// Whether remembered window bounds can still be used. Displays change between runs (a laptop
// undocked, a monitor unplugged), and a window restored where no display is cannot be reached.
import type { Bounds } from "./desktop-state";

/** How much of the window's top strip, where the title bar is, must lie on one display to grab it. */
export const GRAB_STRIP = { width: 100, height: 32 } as const;

/** The saved bounds when their title strip is on one of the work areas; null to open at the default size. */
export function restoredBounds(saved: Bounds | undefined, workAreas: readonly Bounds[]): Bounds | null {
  if (saved === undefined) return null;
  const reachable = workAreas.some((area) => {
    const wide = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
    const tall = Math.min(saved.y + GRAB_STRIP.height, area.y + area.height) - Math.max(saved.y, area.y);
    return wide >= GRAB_STRIP.width && tall >= GRAB_STRIP.height;
  });
  return reachable ? saved : null;
}
