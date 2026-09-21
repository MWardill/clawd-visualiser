// Where a widget's window goes. A folder's widget goes back where it was left, if that place is
// still on a display; otherwise it takes the next free slot, down from the top right of the primary
// work area and then leftwards in columns. Pure: the displays are passed in.
import { restoredBounds } from "../bounds";
import type { Bounds, Placement } from "../desktop-state";
import type { WidgetSize } from "../widget/state";

/** One row of seats at 100% scaling: 54 by 30 cells of 6 px. Only a starting size: the page reports the real one once it has laid out. */
export const DEFAULT_WIDGET_SIZE: WidgetSize = { width: 324, height: 180 };
/** Between default slots, and between the first one and the work area's edges. */
export const SLOT_GAP = 12;
const MAX_SLOTS = 60;

const overlaps = (a: Bounds, b: Bounds): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export type PlaceInput = {
  remembered: Placement | undefined;
  size: WidgetSize;
  /** Every display's work area, for judging a remembered place. */
  workAreas: readonly Bounds[];
  /** The primary display's work area, where default slots are. */
  primary: Bounds;
  /** The widgets already open, which a default slot must not cover. */
  taken: readonly Bounds[];
};

export function placeWidget({ remembered, size, workAreas, primary, taken }: PlaceInput): Bounds {
  if (remembered !== undefined) {
    // The same rule as the full window's: enough of the top strip must show to grab it.
    const kept = restoredBounds({ x: remembered.x, y: remembered.y, ...size }, workAreas);
    if (kept !== null) return { x: kept.x, y: kept.y, ...size };
  }
  const first: Bounds = { x: primary.x + primary.width - size.width - SLOT_GAP, y: primary.y + SLOT_GAP, ...size };
  let slot = first;
  for (let i = 0; i < MAX_SLOTS; i++) {
    const candidate = slot;
    if (!taken.some((other) => overlaps(candidate, other))) return candidate;
    const below = { ...candidate, y: candidate.y + size.height + SLOT_GAP };
    slot = below.y + size.height <= primary.y + primary.height ? below : { ...candidate, x: candidate.x - size.width - SLOT_GAP, y: first.y };
  }
  return first;
}

/**
 * Where a dropped widget may stay: where it is, while its top strip can still be grabbed; else
 * pulled wholly inside the display nearest its centre, so a widget flung off the edge is not lost.
 */
export function clampDrop(dropped: Bounds, workAreas: readonly Bounds[]): Bounds {
  if (restoredBounds(dropped, workAreas) !== null) return dropped;
  const cx = dropped.x + dropped.width / 2;
  const cy = dropped.y + dropped.height / 2;
  let home: Bounds | undefined;
  let nearest = Infinity;
  for (const area of workAreas) {
    const dx = Math.max(area.x - cx, 0, cx - (area.x + area.width));
    const dy = Math.max(area.y - cy, 0, cy - (area.y + area.height));
    if (dx * dx + dy * dy < nearest) {
      nearest = dx * dx + dy * dy;
      home = area;
    }
  }
  if (home === undefined) return dropped;
  const x = Math.min(Math.max(dropped.x, home.x), Math.max(home.x, home.x + home.width - dropped.width));
  const y = Math.min(Math.max(dropped.y, home.y), Math.max(home.y, home.y + home.height - dropped.height));
  return { ...dropped, x, y };
}
