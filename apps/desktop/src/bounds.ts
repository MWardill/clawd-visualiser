// Whether remembered window bounds can still be used. Displays change between runs (a laptop
// undocked, a monitor unplugged), and a window restored where no display is cannot be reached.
import type { Bounds } from "./desktop-state";

/** How much of the window's top strip, where the title bar is, must be showing to grab it. */
export const GRAB_STRIP = { width: 100, height: 32 } as const;

/** Whether [from, to) is covered by the union of the intervals. */
function covers(intervals: readonly (readonly [number, number])[], from: number, to: number): boolean {
  let reached = from;
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (start > reached) break;
    reached = Math.max(reached, end);
  }
  return reached >= to;
}

/**
 * The widest run of the strip's columns that the work areas show, between them, at the strip's full
 * height. Between them, so a strip lying across the seam of two displays counts, side by side or
 * stacked; at full height, so two displays that each show a sliver do not add up to a title bar.
 */
function grabbableWidth(strip: Bounds, workAreas: readonly Bounds[]): number {
  const right = strip.x + strip.width;
  const cuts = [...new Set([strip.x, right, ...workAreas.flatMap((area) => [area.x, area.x + area.width])])].filter((x) => x >= strip.x && x <= right).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i] ?? 0;
    const to = cuts[i + 1] ?? 0;
    const rows = workAreas.filter((area) => area.x <= from && area.x + area.width >= to).map((area) => [area.y, area.y + area.height] as const);
    run = covers(rows, strip.y, strip.y + strip.height) ? run + (to - from) : 0;
    best = Math.max(best, run);
  }
  return best;
}

const shared = (aStart: number, aLength: number, bStart: number, bLength: number): number => Math.max(0, Math.min(aStart + aLength, bStart + bLength) - Math.max(aStart, bStart));

/**
 * The bounds to open at, or null to open at the default size: the saved ones when enough of their
 * title strip is showing to grab, made no larger than the work area holding most of the window. A
 * window that had to shrink is also pulled inside that area, since the part that was cut off would
 * otherwise simply hang off the other edge; one that fits is left exactly where the user put it.
 */
export function restoredBounds(saved: Bounds | undefined, workAreas: readonly Bounds[]): Bounds | null {
  if (saved === undefined) return null;
  if (grabbableWidth({ x: saved.x, y: saved.y, width: saved.width, height: GRAB_STRIP.height }, workAreas) < GRAB_STRIP.width) return null;
  let home: Bounds | undefined;
  let most = -1;
  for (const area of workAreas) {
    const overlap = shared(saved.x, saved.width, area.x, area.width) * shared(saved.y, saved.height, area.y, area.height);
    if (overlap > most) {
      most = overlap;
      home = area;
    }
  }
  if (home === undefined) return null;
  const width = Math.min(saved.width, home.width);
  const height = Math.min(saved.height, home.height);
  if (width === saved.width && height === saved.height) return saved;
  return { x: Math.min(Math.max(saved.x, home.x), home.x + home.width - width), y: Math.min(Math.max(saved.y, home.y), home.y + home.height - height), width, height };
}
