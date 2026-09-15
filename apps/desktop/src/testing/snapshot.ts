import type { SessionPhase, Snapshot } from "@clawd/core";

/** A valid snapshot with one pane and one session per state given. */
export function snapshot(states: readonly SessionPhase[]): Snapshot {
  const t = new Date(0).toISOString();
  return {
    version: 1,
    generatedAt: t,
    panes: [{ pane: "p1", label: "repo" }],
    sessions: states.map((state, i) => ({ alias: `agent-${i + 1}`, label: `Agent ${i + 1}`, pane: "p1", state, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t })),
  };
}
