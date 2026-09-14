import { describe, expect, it } from "vitest";
import { containsDetail } from "../schema/detail";
import type { Snapshot } from "../schema/snapshot";
import { toCloudSnapshot } from "./cloud";

const T = "2026-09-12T10:00:00.000Z";
const local: Snapshot = {
  version: 1,
  generatedAt: T,
  panes: [{ pane: "pane-1", label: "Oak", detail: { dir: "C:/mw/visualiser" } }],
  sessions: [{ alias: "agent-1", label: "Otter", pane: "pane-1", state: "working", activity: "edit", subagents: 0, contextPct: null, since: T, updatedAt: T, detail: { name: "Fix login", subject: { kind: "file", text: "src/app.ts" } } }],
};

describe("toCloudSnapshot", () => {
  it("returns a valid snapshot with every detail key removed and the input untouched", () => {
    const cloud = toCloudSnapshot(local);
    expect(containsDetail(cloud)).toBe(false);
    expect(cloud.sessions[0]).toEqual({ alias: "agent-1", label: "Otter", pane: "pane-1", state: "working", activity: "edit", subagents: 0, contextPct: null, since: T, updatedAt: T });
    expect(cloud.panes[0]).toEqual({ pane: "pane-1", label: "Oak" });
    expect(JSON.stringify(cloud)).not.toContain("visualiser");
    expect(containsDetail(local)).toBe(true);
  });

  it("refuses something that is not a snapshot even after stripping", () => {
    expect(() => toCloudSnapshot({ ...local, version: 2 } as unknown as Snapshot)).toThrow();
  });
});
