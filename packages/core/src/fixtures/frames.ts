import { emptyAliasMap } from "../alias/names";
import type { Snapshot } from "../schema/snapshot";
import { DEFAULT_CONFIG } from "../state/config";
import { emptyFleet, reduceFleet, tickFleet } from "../state/fleet";
import { deriveSnapshot } from "../state/snapshot";
import type { Fixture } from "./load";

export type SnapshotFrame = Omit<Snapshot, "generatedAt">;

/**
 * Reduce a fixture and record the snapshot after every event that changes something visible.
 * Each snapshot is taken after the display hold has expired so frames show real states, and
 * `updatedAt` changes on every event, so a frame is kept only when something else changed too.
 */
export function snapshotFrames(fixture: Fixture): SnapshotFrame[] {
  let fleet = emptyFleet();
  let aliases = emptyAliasMap();
  const frames: SnapshotFrame[] = [];
  let last = "";
  for (const e of fixture.events) {
    fleet = tickFleet(reduceFleet(fleet, e, e.t, DEFAULT_CONFIG), e.t, DEFAULT_CONFIG);
    const r = deriveSnapshot(fleet, aliases, e.t + DEFAULT_CONFIG.minDisplayMs);
    aliases = r.aliases;
    const { generatedAt: _generatedAt, ...frame } = r.snapshot;
    const key = JSON.stringify({ ...frame, sessions: frame.sessions.map(({ updatedAt: _u, ...s }) => s) });
    if (key !== last) {
      frames.push(frame);
      last = key;
    }
  }
  return frames;
}
