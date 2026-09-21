// A link to one session: `#session=<alias>` opens that session's detail sheet. The desktop app's
// widgets follow one when a Clawd is clicked; typed into a browser tab it does the same.
import type { Snapshot } from "@clawd/core";
import type { FeedStatus } from "./feed/types";

/** What an alias may look like (`agent-12`). Anything else in the hash is not a link of ours. */
const ALIAS = /^[A-Za-z0-9._-]{1,64}$/;

/** The alias a `#session=<alias>` hash names, or null. */
export function sessionFromHash(hash: string): string | null {
  const match = /^#session=(.+)$/.exec(hash);
  if (match === null) return null;
  let alias: string;
  try {
    alias = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  return ALIAS.test(alias) ? alias : null;
}

/**
 * The linked session to show: the link's alias, once a snapshot from the live agent holds it. Never
 * from the simulated feed, whose `agent-3` is somebody else.
 */
export function linkedSelection(link: string | null, mode: FeedStatus["mode"], snapshot: Snapshot | null): string | null {
  if (link === null || mode !== "live" || snapshot === null) return null;
  return snapshot.sessions.some((session) => session.alias === link) ? link : null;
}
