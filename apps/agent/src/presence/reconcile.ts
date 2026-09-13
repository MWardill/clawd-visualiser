import { RedactedEventSchema, redactPresence, type RedactedEvent } from "@clawd/core";
import type { SessionView } from "../host/host";

export type ReconcileInput = {
  /** The parsed agents-list array; entries are unvalidated. */
  entries: readonly unknown[];
  sessions: ReadonlyMap<string, SessionView>;
  /** When each id was last in a successful poll. */
  lastListedAt: ReadonlyMap<string, number>;
  ended: ReadonlySet<string>;
  now: number;
  allowlist: readonly string[];
  graceMs: number;
  /** When a first-sight session's transcript was last written, where the poller found one. */
  lastWriteAt?: ReadonlyMap<string, number>;
  /** Keep each first-sight session's directory name on its presence, for the pane label. */
  paneNames?: boolean;
};

export function sessionIdOf(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const id = (entry as { sessionId?: unknown }).sessionId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function listedIds(entries: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = sessionIdOf(entry);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** Pure: one poll against the fleet, as presence events (spec §6.2). */
export function reconcile(input: ReconcileInput): RedactedEvent[] {
  const events: RedactedEvent[] = [];
  const ctx = { now: input.now, allowlist: input.allowlist, paneNames: input.paneNames === true };
  const listed = new Set<string>();
  for (const entry of input.entries) {
    const id = sessionIdOf(entry);
    if (id === null || listed.has(id)) continue;
    listed.add(id);
    if (input.sessions.has(id) || input.ended.has(id)) continue;
    // A raw agents-list entry: redactPresence applies the allowlist and keeps only id, pane key and
    // when the session was last active.
    const alive = redactPresence(entry, true, ctx, input.lastWriteAt?.get(id));
    if (alive) events.push(alive);
  }
  for (const [id, s] of input.sessions) {
    if (s.state === "done" || listed.has(id)) continue;
    const lastSign = Math.max(s.firstSeenAt, s.lastEventAt, input.lastListedAt.get(id) ?? 0);
    if (input.now - lastSign <= input.graceMs) continue;
    // No raw payload exists for a session that left the list; the event is built from fleet state.
    const gone = RedactedEventSchema.safeParse({ v: 1, t: input.now, sessionId: id, paneKey: s.paneKey, kind: "presence", alive: false });
    if (gone.success) events.push(gone.data);
  }
  return events;
}
