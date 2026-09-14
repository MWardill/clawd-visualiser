import { RedactedEventSchema, atLeast, redactPresence, type DetailLevel, type EventDetail, type RedactedEvent } from "@clawd/core";
import type { SessionView } from "../host/host";

/** The part of a presence's detail the agents list supplies: a session's directory and name. */
export type ListedDetail = Pick<EventDetail, "dir" | "name">;

const listedDetail = (e: RedactedEvent): ListedDetail => ({
  ...(e.detail?.dir === undefined ? {} : { dir: e.detail.dir }),
  ...(e.detail?.name === undefined ? {} : { name: e.detail.name }),
});

/** An absent field counts as a value: a name given or dropped is a change. */
const sameListedDetail = (a: ListedDetail | undefined, b: ListedDetail): boolean => a !== undefined && a.dir === b.dir && a.name === b.name;

export type ReconcileResult = {
  events: RedactedEvent[];
  /** What each listed session has been sent from the agents list, at paths; the poller passes it to the next poll. */
  sent: Map<string, ListedDetail>;
};

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
  /** The agent's detail level: at paths a first-sight presence keeps the entry's directory and name in `detail`. */
  detail?: DetailLevel;
  /** What the previous successful poll's result said each listed session had been sent. */
  sent?: ReadonlyMap<string, ListedDetail>;
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
export function reconcile(input: ReconcileInput): ReconcileResult {
  const events: RedactedEvent[] = [];
  const sent = new Map<string, ListedDetail>();
  const ctx = { now: input.now, allowlist: input.allowlist, paneNames: input.paneNames === true, ...(input.detail === undefined ? {} : { detail: input.detail }) };
  const paths = atLeast(input.detail ?? "none", "paths");
  const listed = new Set<string>();
  for (const entry of input.entries) {
    const id = sessionIdOf(entry);
    if (id === null || listed.has(id)) continue;
    listed.add(id);
    if (input.ended.has(id)) continue;
    const known = input.sessions.get(id);
    // Below paths a known session gets nothing, as the list has nothing more to tell it.
    if (known !== undefined && (!paths || known.state === "done")) continue;
    // A raw agents-list entry: redactPresence applies the allowlist and keeps only id, pane key, when
    // the session was last active and, at paths, its directory and name.
    const alive = redactPresence(entry, true, ctx, input.lastWriteAt?.get(id));
    if (!alive) continue;
    if (!paths) {
      events.push(alive);
      continue;
    }
    // A known session gets the entry only when its directory or name differs from what it was last
    // sent. Compared with that, never with the fleet's detail: a status line may name the session
    // slightly differently, and the two sources would flap, writing a presence every poll.
    const detail = listedDetail(alive);
    sent.set(id, detail);
    if (known === undefined || !sameListedDetail(input.sent?.get(id), detail)) events.push(alive);
  }
  for (const [id, s] of input.sessions) {
    if (s.state === "done" || listed.has(id)) continue;
    const lastSign = Math.max(s.firstSeenAt, s.lastEventAt, input.lastListedAt.get(id) ?? 0);
    if (input.now - lastSign <= input.graceMs) continue;
    // No raw payload exists for a session that left the list; the event is built from fleet state.
    const gone = RedactedEventSchema.safeParse({ v: 1, t: input.now, sessionId: id, paneKey: s.paneKey, kind: "presence", alive: false });
    if (gone.success) events.push(gone.data);
  }
  return { events, sent };
}
