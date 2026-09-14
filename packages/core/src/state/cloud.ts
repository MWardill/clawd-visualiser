import { stripDetail } from "../schema/detail";
import { SnapshotSchema, type Snapshot } from "../schema/snapshot";

/**
 * The only snapshot a cloud publisher may send (detail levels design §4): level none, whatever
 * the agent's setting. Validated after the strip, so a publisher cannot pass anything else off as one.
 */
export function toCloudSnapshot(s: Snapshot): Snapshot {
  return SnapshotSchema.parse(stripDetail(s));
}
