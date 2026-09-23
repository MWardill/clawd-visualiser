// Which turns just finished, and which sessions still hold a box up. Pure: two snapshots in, names out.
import type { Snapshot } from "@clawd/core";

/** A session that was working in the previous snapshot and is idle or waiting in this one, with its pane's label. */
export type FinishedTurn = { label: string; alias: string };

/**
 * The turns that finished between two snapshots: a session shown `working` in the previous one and
 * `idle` or `waiting` in this one, by alias: stopping to wait on the maintainer needs them too. The
 * snapshot carries the displayed state, which core holds for a moment, so a short turn still shows
 * as working first. With no previous snapshot (the first from a
 * source) nothing has finished: that is the baseline, so nothing fires at launch or at a restart.
 * A session that vanished, or went to asleep or done, did not finish a turn.
 */
export function finishedTurns(previous: Snapshot | null, next: Snapshot): FinishedTurn[] {
  if (previous === null) return [];
  const wasWorking = new Set(previous.sessions.filter((s) => s.state === "working").map((s) => s.alias));
  const labels = new Map(next.panes.map((p) => [p.pane, p.label]));
  const out: FinishedTurn[] = [];
  for (const s of next.sessions) {
    if ((s.state !== "idle" && s.state !== "waiting") || !wasWorking.has(s.alias)) continue;
    const label = labels.get(s.pane);
    if (label !== undefined) out.push({ label, alias: s.alias });
  }
  return out;
}

/**
 * Of the sessions that raised a box, those still holding it up: present in the snapshot and not
 * working. One working again was answered in its terminal, so it was seen; one that has left the
 * snapshot is gone. `asleep` holds the raise: a popup that fired while nobody was there should
 * still be there on return. So does `waiting`, which may be what raised it.
 */
export function stillRaising(aliases: ReadonlySet<string>, next: Snapshot): Set<string> {
  const kept = new Set<string>();
  for (const s of next.sessions) {
    if (aliases.has(s.alias) && s.state !== "working") kept.add(s.alias);
  }
  return kept;
}
