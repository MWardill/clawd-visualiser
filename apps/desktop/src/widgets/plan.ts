// Which widget windows should exist for a snapshot, and what each is sent. Pure.
import type { Snapshot } from "@clawd/core";
import type { View } from "../desktop-state";

/** A window that should exist: keyed by the pane's label, which outlives an agent restart; its alias does not. A temporary one is a popup in window view, gone once lowered. */
export type WantedWidget = { label: string; pane: string; temporary: boolean };

export type PlanInput = {
  snapshot: Snapshot;
  view: View;
  /** The labels of panes where a turn has finished and nobody has looked yet. */
  raised: ReadonlySet<string>;
};

/**
 * One widget per pane in widget view, whether raised or not: a raised pane's own widget is what is
 * raised. In window view, a temporary widget for each raised pane, and nothing else. Core makes
 * labels unique within a snapshot; were two ever alike, the first is kept.
 */
export function planWidgets(input: PlanInput): WantedWidget[] {
  const seen = new Set<string>();
  const wanted: WantedWidget[] = [];
  for (const p of input.snapshot.panes) {
    if (seen.has(p.label)) continue;
    seen.add(p.label);
    if (input.view === "widgets") wanted.push({ label: p.label, pane: p.pane, temporary: false });
    else if (input.raised.has(p.label)) wanted.push({ label: p.label, pane: p.pane, temporary: true });
  }
  return wanted;
}

/** The snapshot cut down to one pane: what that pane's window is sent, and all it ever learns. */
export function paneSnapshot(s: Snapshot, pane: string): Snapshot {
  return { ...s, panes: s.panes.filter((p) => p.pane === pane), sessions: s.sessions.filter((session) => session.pane === pane) };
}

/** What a window is sent once its pane has left the snapshot: its Clawds walk out. */
export function emptied(s: Snapshot): Snapshot {
  return { ...s, panes: [], sessions: [] };
}
