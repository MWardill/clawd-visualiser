import { own } from "../own";
import type { RedactedEvent } from "../schema/events";
import type { StateConfig } from "./config";
import { newSession, reduceSession, tickSession, type SessionState } from "./session";

/** `name` is the working directory's last segment from the latest event that carried one, or null. */
export type PaneState = { paneKey: string; firstSeenAt: number; sessionIds: string[]; name: string | null };

/** Plain records rather than Maps so a fleet is JSON-serialisable and trivially comparable in tests. */
export type Fleet = { sessions: Record<string, SessionState>; panes: Record<string, PaneState> };

export function emptyFleet(): Fleet {
  return { sessions: {}, panes: {} };
}

function withSession(f: Fleet, s: SessionState, name: string | undefined): Fleet {
  const pane = own(f.panes, s.paneKey) ?? { paneKey: s.paneKey, firstSeenAt: s.firstSeenAt, sessionIds: [], name: null };
  const joined = pane.sessionIds.includes(s.sessionId);
  const renamed = name !== undefined && name !== pane.name;
  const panes =
    joined && !renamed
      ? f.panes
      : { ...f.panes, [s.paneKey]: { ...pane, sessionIds: joined ? pane.sessionIds : [...pane.sessionIds, s.sessionId], ...(renamed ? { name } : {}) } };
  return { sessions: { ...f.sessions, [s.sessionId]: s }, panes };
}

/** An event that only ends or describes a session says nothing about one we have never seen. */
const createsNothing = (e: RedactedEvent): boolean => e.kind === "session.end" || e.kind === "history" || (e.kind === "presence" && !e.alive);

/** A session first seen through presence has been idle since it was last active, not since now. */
const idleSince = (e: RedactedEvent, now: number): number => (e.kind === "presence" && e.lastActiveAt !== undefined ? e.lastActiveAt : now);

/** Pure: routes an event to its session, creating the session and pane on first sight. */
export function reduceFleet(f: Fleet, e: RedactedEvent, now: number, cfg: StateConfig): Fleet {
  const existing = own(f.sessions, e.sessionId);
  if (!existing && createsNothing(e)) return f;
  const s = existing ?? newSession(e.sessionId, e.paneKey, now, idleSince(e, now));
  return withSession(f, reduceSession(s, e, now, cfg), e.paneName);
}

/** Pure: applies timers to every session and drops what has lingered long enough. */
export function tickFleet(f: Fleet, now: number, cfg: StateConfig): Fleet {
  const sessions: Record<string, SessionState> = {};
  for (const s of Object.values(f.sessions)) {
    const ticked = tickSession(s, now, cfg);
    if (ticked.state === "done" && now - ticked.since >= cfg.doneLingerMs) continue;
    sessions[ticked.sessionId] = ticked;
  }
  const panes: Record<string, PaneState> = {};
  for (const p of Object.values(f.panes)) {
    const sessionIds = p.sessionIds.filter((id) => Object.hasOwn(sessions, id));
    if (sessionIds.length > 0) panes[p.paneKey] = { ...p, sessionIds };
  }
  return { sessions, panes };
}
