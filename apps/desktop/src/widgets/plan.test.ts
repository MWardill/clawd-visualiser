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

const NONE: ReadonlySet<string> = new Set();

describe("planWidgets", () => {
  it("wants one widget per pane in widget view, by label, in the snapshot's order, none of them temporary", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "widgets", raised: NONE })).toEqual([
      { label: "repo", pane: "pane-1", temporary: false },
      { label: "docs", pane: "pane-2", temporary: false },
    ]);
  });

  it("wants none in window view unless a pane is raised, and then a temporary one for it", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "window", raised: NONE })).toEqual([]);
    expect(planWidgets({ snapshot: SNAPSHOT, view: "window", raised: new Set(["docs", "gone"]) })).toEqual([{ label: "docs", pane: "pane-2", temporary: true }]);
  });

  it("wants a raised pane's widget in widget view as the ordinary one, not a second temporary one", () => {
    expect(planWidgets({ snapshot: SNAPSHOT, view: "widgets", raised: new Set(["docs"]) }).map((w) => [w.label, w.temporary])).toEqual([
      ["repo", false],
      ["docs", false],
    ]);
  });

  it("keeps the first of two panes that share a label, which core does not send", () => {
    const doubled = { ...SNAPSHOT, panes: [...SNAPSHOT.panes, { pane: "pane-3", label: "repo" }] };
    expect(planWidgets({ snapshot: doubled, view: "widgets", raised: NONE }).map((w) => w.pane)).toEqual(["pane-1", "pane-2"]);
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
