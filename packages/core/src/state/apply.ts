import type { RedactedEvent } from "../schema/events";
import type { TickerEvent } from "../schema/ticker";
import type { StateConfig } from "./config";
import { reduceFleet, type Fleet } from "./fleet";
import type { SessionState } from "./session";
import { toTickerEvents } from "./ticker";

export type Applied = {
  fleet: Fleet;
  /** The session as it was, or null when this event is the first sight of it. */
  before: SessionState | null;
  /** The session after reducing, or null when the fleet ignored the event. */
  after: SessionState | null;
  ticker: TickerEvent[];
};

/** The one call a host makes per event: reduce, then derive the ticker lines from the before/after pair. */
export function applyEvent(fleet: Fleet, e: RedactedEvent, now: number, cfg: StateConfig): Applied {
  const before = fleet.sessions[e.sessionId] ?? null;
  const next = reduceFleet(fleet, e, now, cfg);
  const after = next.sessions[e.sessionId] ?? null;
  return { fleet: next, before, after, ticker: after ? toTickerEvents(e, before, after) : [] };
}
