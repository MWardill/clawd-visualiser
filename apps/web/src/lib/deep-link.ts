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
 * A followed `#session=<alias>` link. It belongs to one LIVE feed: `generation` names that feed
 * once it is known, and is null while the link still waits for it.
 *
 * A link belongs to the live feed running when it was read. When none was running -- at page
 * load, during the initial probe, or under the simulated feed -- it cannot belong to a feed yet,
 * because the first feed to start need not be a live one: the default mode probes the agent
 * first, and while that probe is outstanding (or fails) the simulated feed runs and takes a
 * generation of its own. Such a link waits (`generation: null`) until the first live feed
 * starts, whichever generation number that turns out to be, and is pinned to it then. Once a
 * link belongs to a generation it never moves to another, so a later feed switch still closes
 * any sheet it opened rather than reopening it, or naming a different session that now answers
 * to the same alias.
 */
export type SessionLink = { alias: string; generation: number | null };

/** Reads a link under the feed running now: it belongs to that feed if it is live, else it waits. */
export function readLink(alias: string, mode: FeedStatus["mode"], generation: number): SessionLink {
  return { alias, generation: mode === "live" ? generation : null };
}

/**
 * Pins a waiting link to a live feed the moment one is running, so it stops waiting for the first
 * live feed once that feed exists. A link that already belongs to a generation, or that isn't
 * there, comes back unchanged -- by the same reference, so a caller can tell nothing happened.
 */
export function pinLink(link: SessionLink | null, mode: FeedStatus["mode"], generation: number): SessionLink | null {
  if (link !== null && link.generation === null && mode === "live") return { ...link, generation };
  return link;
}

/**
 * The linked session to show: the link's alias, once a snapshot from the live agent holds it. Never
 * from the simulated feed, whose `agent-3` is somebody else, and never a link still waiting for its
 * first live feed -- pin it first. A pinned link is honoured only while `generation` still matches
 * the generation it belongs to, so a feed switch (a new live agent, or a fallback to the simulated
 * feed and back) closes any sheet the link opened rather than reopening one, or naming a different
 * session that now answers to the same alias.
 */
export function linkedSelection(link: SessionLink | null, generation: number, mode: FeedStatus["mode"], snapshot: Snapshot | null): string | null {
  if (link === null || link.generation !== generation || mode !== "live" || snapshot === null) return null;
  return snapshot.sessions.some((session) => session.alias === link.alias) ? link.alias : null;
}
