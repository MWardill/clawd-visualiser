import { ensurePaneAlias, ensureSessionAlias, type AliasMap } from "../alias/names";
import { SnapshotSchema, type Activity, type SessionPhase, type SessionSnapshot, type Snapshot } from "../schema/snapshot";
import type { Fleet } from "./fleet";
import type { SessionState } from "./session";

/** What to show right now: the held previous state and activity until the hold expires. */
function displayed(s: SessionState, now: number): { state: SessionPhase; activity: Activity | null } {
  const shown = s.displayHold && now < s.displayHold.until ? s.displayHold : s;
  return { state: shown.state, activity: shown.state === "working" ? shown.activity : null };
}

/** The state to show right now: the held previous state until the hold expires. */
export function displayedState(s: SessionState, now: number): SessionPhase {
  return displayed(s, now).state;
}

/**
 * The only place a wire Snapshot is made, and the only place local identifiers are left behind.
 * Returns the alias map too, since new sessions or panes may have been given aliases.
 */
export function deriveSnapshot(f: Fleet, aliases: AliasMap, now: number): { snapshot: Snapshot; aliases: AliasMap } {
  let map = aliases;
  const panes = Object.values(f.panes)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
    .map((p) => {
      const r = ensurePaneAlias(map, p.paneKey);
      map = r.map;
      return { pane: r.alias, label: r.label, collision: false };
    });
  // First sight, not `since`: sorting by `since` would reshuffle the fleet on every state change.
  const sessions: SessionSnapshot[] = Object.values(f.sessions)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    .map((s) => {
      const sr = ensureSessionAlias(map, s.sessionId);
      map = sr.map;
      const pr = ensurePaneAlias(map, s.paneKey);
      map = pr.map;
      const { state, activity } = displayed(s, now);
      return {
        alias: sr.alias,
        label: sr.label,
        pane: pr.alias,
        state,
        activity,
        subagents: s.subagents.length,
        contextPct: s.contextPct,
        since: new Date(s.since).toISOString(),
        updatedAt: new Date(s.lastEventAt).toISOString(),
      };
    });
  const snapshot = SnapshotSchema.parse({ version: 1, generatedAt: new Date(now).toISOString(), panes, sessions });
  return { snapshot, aliases: map };
}
