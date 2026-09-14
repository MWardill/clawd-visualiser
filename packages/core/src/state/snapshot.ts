import { ensurePaneAlias, ensureSessionAlias, type AliasMap } from "../alias/names";
import { SnapshotSchema, type Activity, type SessionPhase, type SessionSnapshot, type Snapshot } from "../schema/snapshot";
import { DEFAULT_CONFIG, type StateConfig } from "./config";
import type { Fleet, PaneState } from "./fleet";
import type { SessionState } from "./session";
import { isShown } from "./visibility";

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
 * Labels for the panes that have a directory name: the name, numbered in order of first sight when
 * panes share it, compared without case (`visualiser`, `visualiser 2`). Every named pane in the fleet
 * takes its number, shown or not, so a label does not change when another pane is hidden.
 */
function folderLabels(f: Fleet): Map<string, string> {
  const labels = new Map<string, string>();
  const taken = new Map<string, number>();
  const named = Object.values(f.panes)
    .filter((p): p is PaneState & { name: string } => p.name !== null)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt || (a.paneKey < b.paneKey ? -1 : a.paneKey > b.paneKey ? 1 : 0));
  for (const p of named) {
    const key = p.name.toLowerCase();
    const n = (taken.get(key) ?? 0) + 1;
    taken.set(key, n);
    labels.set(p.paneKey, n === 1 ? p.name : `${p.name} ${n}`);
  }
  return labels;
}

/**
 * The only place a wire Snapshot is made, and the only place local identifiers are left behind.
 * Sessions `isShown` rejects are left out, and so are panes with nothing shown; both stay in the
 * fleet. Returns the alias map too, since new sessions or panes may have been given aliases.
 */
export function deriveSnapshot(f: Fleet, aliases: AliasMap, now: number, cfg: StateConfig = DEFAULT_CONFIG): { snapshot: Snapshot; aliases: AliasMap } {
  let map = aliases;
  const shown = Object.values(f.sessions).filter((s) => isShown(s, now, cfg));
  const shownPanes = new Set(shown.map((s) => s.paneKey));
  const folders = cfg.folderPaneLabels ? folderLabels(f) : new Map<string, string>();
  const panes = Object.values(f.panes)
    .filter((p) => shownPanes.has(p.paneKey))
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
    .map((p) => {
      const r = ensurePaneAlias(map, p.paneKey);
      map = r.map;
      const dir = shown.find((s) => s.paneKey === p.paneKey && s.detail.dir !== undefined)?.detail.dir;
      return { pane: r.alias, label: folders.get(p.paneKey) ?? r.label, ...(dir === undefined ? {} : { detail: { dir } }) };
    });
  // First sight, not `since`: sorting by `since` would reshuffle the fleet on every state change.
  const sessions: SessionSnapshot[] = shown
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
        // Only when there is something to say, so level none stays byte for byte what it was.
        ...(Object.keys(s.detail).length === 0 ? {} : { detail: s.detail }),
      };
    });
  const snapshot = SnapshotSchema.parse({ version: 1, generatedAt: new Date(now).toISOString(), panes, sessions });
  return { snapshot, aliases: map };
}
