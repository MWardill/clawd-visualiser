import type { SessionPhase, Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { finishedTurns, stillRaising } from "./finished";

const t = new Date(0).toISOString();
const session = (alias: string, pane: string, state: SessionPhase) => ({ alias, label: alias, pane, state, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t });
const snap = (...sessions: ReturnType<typeof session>[]): Snapshot => ({
  version: 1,
  generatedAt: t,
  panes: [
    { pane: "pane-1", label: "repo" },
    { pane: "pane-2", label: "docs" },
  ],
  sessions,
});

describe("finishedTurns", () => {
  it("names the pane and the session where working became idle or waiting, and nothing else", () => {
    const before = snap(session("agent-1", "pane-1", "working"), session("agent-2", "pane-2", "working"), session("agent-3", "pane-1", "idle"));
    const after = snap(session("agent-1", "pane-1", "idle"), session("agent-2", "pane-2", "waiting"), session("agent-3", "pane-1", "idle"));
    expect(finishedTurns(before, after)).toEqual([
      { label: "repo", alias: "agent-1" },
      { label: "docs", alias: "agent-2" },
    ]);
  });

  it("does not count a session still waiting, nor one first seen waiting", () => {
    const before = snap(session("agent-1", "pane-1", "waiting"));
    const after = snap(session("agent-1", "pane-1", "waiting"), session("agent-2", "pane-2", "waiting"));
    expect(finishedTurns(before, after)).toEqual([]);
  });

  it("is the baseline with no previous snapshot: nothing has finished", () => {
    expect(finishedTurns(null, snap(session("agent-1", "pane-1", "idle")))).toEqual([]);
  });

  it("does not count a session that went from working to asleep, done or gone, nor one first seen idle", () => {
    const before = snap(session("agent-1", "pane-1", "working"), session("agent-2", "pane-2", "working"), session("agent-3", "pane-1", "working"));
    const after = snap(session("agent-1", "pane-1", "asleep"), session("agent-2", "pane-2", "done"), session("agent-4", "pane-1", "idle"));
    expect(finishedTurns(before, after)).toEqual([]);
  });

  it("does not count a session that went from waiting to idle, only one that was working", () => {
    const before = snap(session("agent-1", "pane-1", "waiting"), session("agent-2", "pane-2", "working"));
    const after = snap(session("agent-1", "pane-1", "idle"), session("agent-2", "pane-2", "idle"));
    expect(finishedTurns(before, after)).toEqual([{ label: "docs", alias: "agent-2" }]);
  });

  it("names every pane whose session finished, two in one snapshot too", () => {
    const before = snap(session("agent-1", "pane-1", "working"), session("agent-2", "pane-2", "working"));
    const after = snap(session("agent-1", "pane-1", "idle"), session("agent-2", "pane-2", "idle"));
    expect(finishedTurns(before, after)).toEqual([
      { label: "repo", alias: "agent-1" },
      { label: "docs", alias: "agent-2" },
    ]);
  });
});

describe("stillRaising", () => {
  const raised = new Set(["agent-1", "agent-2"]);

  it("keeps a session that is idle, waiting, asleep or done, and drops one working again, or gone", () => {
    expect(stillRaising(raised, snap(session("agent-1", "pane-1", "idle"), session("agent-2", "pane-2", "working")))).toEqual(new Set(["agent-1"]));
    expect(stillRaising(raised, snap(session("agent-1", "pane-1", "asleep"), session("agent-2", "pane-2", "waiting")))).toEqual(new Set(["agent-1", "agent-2"]));
    expect(stillRaising(raised, snap(session("agent-1", "pane-1", "done")))).toEqual(new Set(["agent-1"]));
    expect(stillRaising(raised, snap(session("agent-3", "pane-1", "idle")))).toEqual(new Set());
  });
});
