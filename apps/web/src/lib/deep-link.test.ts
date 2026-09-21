import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { linkedSelection, sessionFromHash } from "./deep-link";

const t = new Date(0).toISOString();
const SNAPSHOT: Snapshot = {
  version: 1,
  generatedAt: t,
  panes: [{ pane: "pane-1", label: "repo" }],
  sessions: [{ alias: "agent-3", label: "Otter", pane: "pane-1", state: "idle", activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t }],
};

describe("sessionFromHash", () => {
  it("reads the alias a #session= hash names", () => {
    expect(sessionFromHash("#session=agent-3")).toBe("agent-3");
    expect(sessionFromHash("#session=agent%2D3")).toBe("agent-3");
  });

  it("is null for any other hash, an empty or over-long alias, a bad escape, or characters no alias has", () => {
    for (const hash of ["", "#", "#session=", "#other=agent-3", "session=agent-3", "#session=%E0%A4%A", "#session=agent 3", "#session=<b>", `#session=${"a".repeat(65)}`]) {
      expect(sessionFromHash(hash), hash).toBeNull();
    }
  });
});

describe("linkedSelection", () => {
  it("is the linked alias once a live snapshot holds it", () => {
    expect(linkedSelection("agent-3", "live", SNAPSHOT)).toBe("agent-3");
  });

  it("is nothing with no link, before the first snapshot, or for an alias the snapshot does not hold", () => {
    expect(linkedSelection(null, "live", SNAPSHOT)).toBeNull();
    expect(linkedSelection("agent-3", "live", null)).toBeNull();
    expect(linkedSelection("agent-9", "live", SNAPSHOT)).toBeNull();
  });

  it("is never honoured from the simulated feed, whose aliases are its own", () => {
    expect(linkedSelection("agent-3", "simulated", SNAPSHOT)).toBeNull();
    expect(linkedSelection("agent-3", "probing", SNAPSHOT)).toBeNull();
  });
});
