import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { emptied, paneSnapshot, planWidgets } from "./plan";

const t = new Date(0).toISOString();
const session = (alias: string, pane: string) => ({ alias, label: alias, pane, state: "working" as const, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t });
const SNAPSHOT: Snapshot = {
  version: 1,
  generatedAt: t,
  panes: [
    { pane: "pane-1", label: "repo" },
    { pane: "pane-2", label: "docs" },
  ],
  sessions: [session("agent-1", "pane-1"), session("agent-2", "pane-2"), session("agent-3", "pane-1")],
};

describe("planWidgets", () => {
  it("wants one widget per pane in widget view, by label, in the snapshot's order", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "widgets" })).toEqual([
      { label: "repo", pane: "pane-1" },
      { label: "docs", pane: "pane-2" },
    ]);
  });

  it("wants none in window view", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "window" })).toEqual([]);
  });

  it("keeps the first of two panes that share a label, which core does not send", () => {
    const doubled = { ...SNAPSHOT, panes: [...SNAPSHOT.panes, { pane: "pane-3", label: "repo" }] };
    expect(planWidgets({ snapshot: doubled, view: "widgets" }).map((w) => w.pane)).toEqual(["pane-1", "pane-2"]);
  });
});

describe("paneSnapshot", () => {
  it("is the snapshot cut down to one pane and the sessions in it", () => {
    const one = paneSnapshot(SNAPSHOT, "pane-1");
    expect(one.panes).toEqual([{ pane: "pane-1", label: "repo" }]);
    expect(one.sessions.map((s) => s.alias)).toEqual(["agent-1", "agent-3"]);
    expect(one.generatedAt).toBe(SNAPSHOT.generatedAt);
  });
});

describe("emptied", () => {
  it("is the snapshot with nobody in it, which a page draws as everyone walking out", () => {
    expect(emptied(SNAPSHOT)).toEqual({ ...SNAPSHOT, panes: [], sessions: [] });
  });
});
