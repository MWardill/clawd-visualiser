// Test-only. Not exported from the package index.
import { EVENT_SCHEMA_VERSION, type RedactedEvent, type RedactedEventKind } from "../schema/events";

/** The epoch every test builds its times from: 2025-09-12T10:00:00.000Z. */
export const T0 = 1_757_671_200_000;

/** A kind's own fields: everything but the envelope. `agentId` stays, since some kinds require it. */
type Body<K extends RedactedEventKind> = Omit<Extract<RedactedEvent, { kind: K }>, "v" | "t" | "sessionId" | "paneKey" | "kind">;

/** The body may be left out only for kinds that have nothing required beyond the envelope. */
type Args<K extends RedactedEventKind> = {} extends Body<K> ? [body?: Body<K>, ids?: EventIds] : [body: Body<K>, ids?: EventIds];

export type EventIds = { sessionId?: string; paneKey?: string; paneName?: string };

/**
 * A redacted event for tests, typed per kind so a malformed body fails to compile rather than slip
 * through a cast. Defaults to session "s1" in pane "k1".
 */
export function event<K extends RedactedEventKind>(kind: K, t: number, ...args: Args<K>): RedactedEvent {
  const [body, ids] = args as [Body<K> | undefined, EventIds | undefined];
  const named = ids?.paneName === undefined ? {} : { paneName: ids.paneName };
  return { v: EVENT_SCHEMA_VERSION, t, sessionId: ids?.sessionId ?? "s1", paneKey: ids?.paneKey ?? "k1", ...named, kind, ...body } as RedactedEvent;
}
