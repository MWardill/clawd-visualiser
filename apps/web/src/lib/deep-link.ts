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
 * A followed `#session=<alias>` link: the alias it named, and the feed generation it was read
 * under (0 when it was read before any feed had started, such as at page load).
 */
export type SessionLink = { alias: string; generation: number };

/**
 * The linked session to show: the link's alias, once a snapshot from the live agent holds it. Never
 * from the simulated feed, whose `agent-3` is somebody else.
 *
 * A link belongs to the feed it was made under, the same as a Clawd chosen by hand: it is honoured
 * only while `generation` still matches `link.generation`, so a feed switch (a new live agent, or a
 * fallback to the simulated feed and back) closes any sheet the link opened rather than reopening
 * one, or naming a different session that now answers to the same alias. The one exception is a
 * link read before any feed had started, when `feed.generation` is still 0: that link has no feed
 * of its own yet, so it is honoured by the first feed to start (`generation === 1`) -- otherwise a
 * link in a freshly opened window, read before the feed exists, could never be honoured at all.
 */
export function linkedSelection(link: SessionLink | null, generation: number, mode: FeedStatus["mode"], snapshot: Snapshot | null): string | null {
  if (link === null || mode !== "live" || snapshot === null) return null;
  const belongsToThisFeed = link.generation === generation || (link.generation === 0 && generation === 1);
  if (!belongsToThisFeed) return null;
  return snapshot.sessions.some((session) => session.alias === link.alias) ? link.alias : null;
}
