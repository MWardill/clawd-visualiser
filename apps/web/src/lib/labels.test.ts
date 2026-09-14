import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { APP_TITLE, countSnapshot, sceneLabel, sourceBadge, tabTitle } from "./labels";

const T = "2026-09-12T10:00:00.000Z";
const snapshot: Snapshot = {
  version: 1,
  generatedAt: T,
  panes: [{ pane: "pane-1", label: "Oak" }, { pane: "pane-2", label: "Elm" }],
  sessions: [
    { alias: "agent-1", label: "Otter", pane: "pane-1", state: "working", activity: "edit", subagents: 2, contextPct: null, since: T, updatedAt: T },
    { alias: "agent-2", label: "Heron", pane: "pane-1", state: "waiting", activity: null, subagents: 0, contextPct: 10, since: T, updatedAt: T },
    { alias: "agent-3", label: "Lynx", pane: "pane-2", state: "done", activity: null, subagents: 1, contextPct: null, since: T, updatedAt: T },
  ],
};

describe("labels", () => {
  it("counts live sessions, waiting sessions, subagents and panes, ignoring done sessions", () => {
    expect(countSnapshot(snapshot)).toEqual({ sessions: 2, waiting: 1, subagents: 2, panes: 2 });
    expect(countSnapshot(null)).toEqual({ sessions: 0, waiting: 0, subagents: 0, panes: 0 });
  });

  it("puts the waiting count in the tab title only when there is one", () => {
    expect(tabTitle(0)).toBe(APP_TITLE);
    expect(tabTitle(2)).toBe(`(2) ${APP_TITLE}`);
  });

  it("describes the scene for assistive technology", () => {
    expect(sceneLabel({ sessions: 2, waiting: 1, subagents: 2, panes: 2 })).toBe("2 sessions in 2 panes, 1 waiting");
  });

  it("names the source in the status bar, with the detail level when above none", () => {
    const live = { mode: "live" as const, agentUrl: "http://127.0.0.1:4750", connected: true, rejected: 0, detail: "none" as const };
    expect(sourceBadge({ mode: "probing" })).toBe("probing for agent");
    expect(sourceBadge(live)).toBe("live · 127.0.0.1:4750");
    expect(sourceBadge({ ...live, rejected: 3 })).toBe("live · 127.0.0.1:4750 · 3 rejected");
    expect(sourceBadge({ ...live, detail: "paths" })).toBe("live · 127.0.0.1:4750 · paths");
    expect(sourceBadge({ ...live, detail: "hints", rejected: 1 })).toBe("live · 127.0.0.1:4750 · hints · 1 rejected");
    expect(sourceBadge({ ...live, connected: false })).toBe("live · reconnecting");
    expect(sourceBadge({ mode: "simulated", reason: "no-agent" })).toBe("simulated · no agent");
    expect(sourceBadge({ mode: "simulated", reason: "lost-agent" })).toBe("simulated · agent lost");
    expect(sourceBadge({ mode: "simulated", reason: "forced" })).toBe("simulated · forced");
  });
});
