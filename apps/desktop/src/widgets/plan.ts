// Which widget windows should exist for a snapshot, and what each is sent. Pure.
import type { Snapshot } from "@clawd/core";
import type { View } from "../desktop-state";

/** A window that should exist: keyed by the pane's label, which outlives an agent restart; its alias does not. */
export type WantedWidget = { label: string; pane: string };

/** One widget per pane in widget view. Core makes labels unique within a snapshot; were two ever alike, the first is kept. */
export function planWidgets(input: { snapshot: Snapshot; view: View }): WantedWidget[] {
  if (input.view !== "widgets") return [];
  const seen = new Set<string>();
  const wanted: WantedWidget[] = [];
  for (const p of input.snapshot.panes) {
    if (seen.has(p.label)) continue;
    seen.add(p.label);
    wanted.push({ label: p.label, pane: p.pane });
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
