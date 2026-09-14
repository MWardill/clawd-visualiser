import type { Snapshot } from "@clawd/core";
import type { FeedStatus } from "./feed/types";

export const APP_TITLE = "Clawd Visualiser";

export type Counts = { sessions: number; waiting: number; subagents: number; panes: number };

/** Live sessions only: a done session lingers a few seconds for its exit and is not counted. */
export function countSnapshot(s: Snapshot | null): Counts {
  const counts: Counts = { sessions: 0, waiting: 0, subagents: 0, panes: s?.panes.length ?? 0 };
  for (const session of s?.sessions ?? []) {
    if (session.state === "done") continue;
    counts.sessions++;
    if (session.state === "waiting") counts.waiting++;
    counts.subagents += session.subagents;
  }
  return counts;
}

/** The tab title carries the waiting count while there is one (FR-24). */
export function tabTitle(waiting: number): string {
  return waiting > 0 ? `(${waiting}) ${APP_TITLE}` : APP_TITLE;
}

/** The canvas's accessible name. */
export function sceneLabel(c: Counts): string {
  return `${c.sessions} sessions in ${c.panes} panes, ${c.waiting} waiting`;
}

const REASONS = { "no-agent": "no agent", "lost-agent": "agent lost", forced: "forced" } as const;

/** The source badge in the top bar. */
export function sourceBadge(status: FeedStatus): string {
  switch (status.mode) {
    case "probing":
      return "probing for agent";
    case "live": {
      if (!status.connected) return "live · reconnecting";
      const parts = ["live", hostOf(status.agentUrl)];
      if (status.detail !== "none") parts.push(status.detail);
      if (status.rejected > 0) parts.push(`${status.rejected} rejected`);
      return parts.join(" · ");
    }
    case "simulated":
      return `simulated · ${REASONS[status.reason]}`;
    default:
      status satisfies never;
      return "";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
