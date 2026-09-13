import { describe, expect, it } from "vitest";
import { emptyAliasMap, ensureSessionAlias } from "../alias/names";
import { SnapshotSchema } from "../schema/snapshot";
import { T0, event } from "../testing/events";
import { DEFAULT_CONFIG } from "./config";
import { emptyFleet, reduceFleet } from "./fleet";
import { deriveSnapshot } from "./snapshot";


describe("deriveSnapshot", () => {
  it("labels a pane with its directory name, numbering a later pane of the same name, and falls back to trees", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1", paneName: "visualiser" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 1, {}, { sessionId: "s2", paneKey: "k2", paneName: "Visualiser" }), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 2, {}, { sessionId: "s3", paneKey: "k3" }), T0 + 2, DEFAULT_CONFIG);
    expect(deriveSnapshot(f, emptyAliasMap(), T0 + 10).snapshot.panes.map((p) => p.label)).toEqual(["visualiser", "Visualiser 2", "Ash"]);
  });

  it("shows only generated pane labels when the config turns directory names off", () => {
    const f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1", paneName: "visualiser" }), T0, DEFAULT_CONFIG);
    const { snapshot } = deriveSnapshot(f, emptyAliasMap(), T0 + 10, { ...DEFAULT_CONFIG, folderPaneLabels: false });
    expect(snapshot.panes.map((p) => p.label)).toEqual(["Oak"]);
    expect(JSON.stringify(snapshot)).not.toContain("visualiser");
  });

  it("produces a valid snapshot with aliases and no local identifiers", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "session-uuid", paneKey: "deadbeefdeadbeef" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("tool.start", T0 + 1, { tool: "Read", category: "read", toolUseId: "u1" }, { sessionId: "session-uuid", paneKey: "deadbeefdeadbeef" }), T0 + 1, DEFAULT_CONFIG);
    const { snapshot } = deriveSnapshot(f, emptyAliasMap(), T0 + 5000);
    expect(() => SnapshotSchema.parse(snapshot)).not.toThrow();
    expect(JSON.stringify(snapshot)).not.toContain("session-uuid");
    expect(JSON.stringify(snapshot)).not.toContain("deadbeef");
    expect(snapshot.sessions[0]).toMatchObject({ alias: "agent-1", pane: "pane-1", state: "working", activity: "read", subagents: 0, contextPct: null });
    expect(snapshot.sessions[0]?.since).toBe(new Date(T0).toISOString());
    expect(snapshot.panes[0]).toEqual({ pane: "pane-1", label: "Oak" });
  });

  it("shows the held previous state until the hold expires, with the real since", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 5000, { backgroundTasks: 0 }, { sessionId: "s1", paneKey: "k1" }), T0 + 5000, DEFAULT_CONFIG);
    const held = deriveSnapshot(f, emptyAliasMap(), T0 + 5000 + 100).snapshot.sessions[0]!;
    expect(held.state).toBe("working");
    expect(held.since).toBe(new Date(T0 + 5000).toISOString());
    const real = deriveSnapshot(f, emptyAliasMap(), T0 + 5000 + DEFAULT_CONFIG.minDisplayMs).snapshot.sessions[0]!;
    expect(real.state).toBe("idle");
    expect(real.activity).toBeNull();
  });

  it("keeps aliases stable across calls and orders panes and sessions by first sight", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0 + 50, {}, { sessionId: "late", paneKey: "k2" }), T0 + 50, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0, {}, { sessionId: "early", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    const first = deriveSnapshot(f, emptyAliasMap(), T0 + 100);
    const second = deriveSnapshot(f, first.aliases, T0 + 200);
    expect(second.snapshot.sessions.map((s) => s.alias)).toEqual(first.snapshot.sessions.map((s) => s.alias));
    expect(first.snapshot.panes.map((p) => p.pane)).toEqual(["pane-1", "pane-2"]);
    expect(first.snapshot.sessions.map((s) => s.since)).toEqual([new Date(T0).toISOString(), new Date(T0 + 50).toISOString()]);
  });
  it("keeps session order stable when an earlier session changes state later", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "a", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 50, {}, { sessionId: "b", paneKey: "k1" }), T0 + 50, DEFAULT_CONFIG);
    const first = deriveSnapshot(f, emptyAliasMap(), T0 + 60);
    f = reduceFleet(f, event("stop", T0 + 100, { backgroundTasks: 0 }, { sessionId: "a", paneKey: "k1" }), T0 + 100, DEFAULT_CONFIG);
    const second = deriveSnapshot(f, first.aliases, T0 + 100 + DEFAULT_CONFIG.minDisplayMs);
    expect(first.snapshot.sessions.map((x) => x.alias)).toEqual(["agent-1", "agent-2"]);
    expect(second.snapshot.sessions.map((x) => x.alias)).toEqual(["agent-1", "agent-2"]);
    expect(second.snapshot.sessions[0]?.state).toBe("idle");
  });

  it("breaks a tie on first sight with the session id, whatever order the events arrived in", () => {
    const seeded = ensureSessionAlias(ensureSessionAlias(emptyAliasMap(), "alpha").map, "zeta").map;
    const build = (ids: string[]) => ids.reduce((f, id) => reduceFleet(f, event("prompt", T0, {}, { sessionId: id, paneKey: "k1" }), T0, DEFAULT_CONFIG), emptyFleet());
    for (const order of [["zeta", "alpha"], ["alpha", "zeta"]]) {
      expect(deriveSnapshot(build(order), seeded, T0 + 10).snapshot.sessions.map((x) => x.alias)).toEqual(["agent-1", "agent-2"]);
    }
  });

  it("reports updatedAt from the last event and counts live subagents", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("subagent.start", T0 + 10, { agentId: "a1", agentType: "x" }, { sessionId: "s1", paneKey: "k1" }), T0 + 10, DEFAULT_CONFIG);
    f = reduceFleet(f, event("subagent.start", T0 + 20, { agentId: "a2", agentType: "x" }, { sessionId: "s1", paneKey: "k1" }), T0 + 20, DEFAULT_CONFIG);
    const only = deriveSnapshot(f, emptyAliasMap(), T0 + 5000).snapshot.sessions[0]!;
    expect(only.subagents).toBe(2);
    expect(only.updatedAt).toBe(new Date(T0 + 20).toISOString());
  });

  it("leaves out hidden sessions and the panes left with none, and brings a session back on its next prompt", () => {
    let f = reduceFleet(emptyFleet(), event("presence", T0, { alive: true }, { sessionId: "unprompted", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0, {}, { sessionId: "used", paneKey: "k2" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 1, { backgroundTasks: 0 }, { sessionId: "used", paneKey: "k2" }), T0 + 1, DEFAULT_CONFIG);
    const soon = deriveSnapshot(f, emptyAliasMap(), T0 + DEFAULT_CONFIG.minDisplayMs);
    expect(soon.snapshot.sessions.map((s) => s.alias)).toEqual(["agent-1"]);
    expect(soon.snapshot.panes).toHaveLength(1);
    const later = deriveSnapshot(f, soon.aliases, T0 + 1 + DEFAULT_CONFIG.oneShotHideMs);
    expect(later.snapshot.sessions).toEqual([]);
    expect(later.snapshot.panes).toEqual([]);
    const promptAt = T0 + 2 + DEFAULT_CONFIG.oneShotHideMs;
    f = reduceFleet(f, event("prompt", promptAt, {}, { sessionId: "unprompted", paneKey: "k1" }), promptAt, DEFAULT_CONFIG);
    expect(deriveSnapshot(f, later.aliases, promptAt + DEFAULT_CONFIG.minDisplayMs).snapshot.sessions.map((s) => s.state)).toEqual(["working"]);
  });

  it("takes the hiding limits from the config it is given", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 1, { backgroundTasks: 0 }, { sessionId: "s1", paneKey: "k1" }), T0 + 1, DEFAULT_CONFIG);
    expect(deriveSnapshot(f, emptyAliasMap(), T0 + 10_000, { ...DEFAULT_CONFIG, oneShotHideMs: 5_000 }).snapshot.sessions).toEqual([]);
  });

  it("shows the held activity with the held state", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("tool.start", T0 + 1, { tool: "Edit", category: "edit", toolUseId: "u1" }, { sessionId: "s1", paneKey: "k1" }), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 5000, { backgroundTasks: 0 }, { sessionId: "s1", paneKey: "k1" }), T0 + 5000, DEFAULT_CONFIG);
    const held = deriveSnapshot(f, emptyAliasMap(), T0 + 5100).snapshot.sessions[0]!;
    expect(held).toMatchObject({ state: "working", activity: "edit" });
  });
});
