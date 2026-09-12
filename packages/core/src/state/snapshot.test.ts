import { describe, expect, it } from "vitest";
import { emptyAliasMap, ensureSessionAlias } from "../alias/names";
import type { RedactedEvent } from "../schema/events";
import { SnapshotSchema } from "../schema/snapshot";
import { DEFAULT_CONFIG } from "./config";
import { emptyFleet, reduceFleet } from "./fleet";
import { deriveSnapshot } from "./snapshot";

const T0 = 1_757_671_200_000;
const ev = (sessionId: string, paneKey: string, kind: string, t: number, extra: Record<string, unknown> = {}) =>
  ({ v: 1, sessionId, paneKey, t, kind, ...extra }) as RedactedEvent;

describe("deriveSnapshot", () => {
  it("produces a valid snapshot with aliases and no local identifiers", () => {
    let f = reduceFleet(emptyFleet(), ev("session-uuid", "deadbeefdeadbeef", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("session-uuid", "deadbeefdeadbeef", "tool.start", T0 + 1, { tool: "Read", category: "read", toolUseId: "u1" }), T0 + 1, DEFAULT_CONFIG);
    const { snapshot } = deriveSnapshot(f, emptyAliasMap(), T0 + 5000);
    expect(() => SnapshotSchema.parse(snapshot)).not.toThrow();
    expect(JSON.stringify(snapshot)).not.toContain("session-uuid");
    expect(JSON.stringify(snapshot)).not.toContain("deadbeef");
    expect(snapshot.sessions[0]).toMatchObject({ alias: "agent-1", pane: "pane-1", state: "working", activity: "read", subagents: 0, contextPct: null });
    expect(snapshot.sessions[0]?.since).toBe(new Date(T0).toISOString());
    expect(snapshot.panes[0]).toEqual({ pane: "pane-1", label: "Oak" });
  });

  it("shows the held previous state until the hold expires, with the real since", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "stop", T0 + 5000, { backgroundTasks: 0 }), T0 + 5000, DEFAULT_CONFIG);
    const held = deriveSnapshot(f, emptyAliasMap(), T0 + 5000 + 100).snapshot.sessions[0]!;
    expect(held.state).toBe("working");
    expect(held.since).toBe(new Date(T0 + 5000).toISOString());
    const real = deriveSnapshot(f, emptyAliasMap(), T0 + 5000 + DEFAULT_CONFIG.minDisplayMs).snapshot.sessions[0]!;
    expect(real.state).toBe("idle");
    expect(real.activity).toBeNull();
  });

  it("keeps aliases stable across calls and orders panes and sessions by first sight", () => {
    let f = reduceFleet(emptyFleet(), ev("late", "k2", "prompt", T0 + 50), T0 + 50, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("early", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    const first = deriveSnapshot(f, emptyAliasMap(), T0 + 100);
    const second = deriveSnapshot(f, first.aliases, T0 + 200);
    expect(second.snapshot.sessions.map((s) => s.alias)).toEqual(first.snapshot.sessions.map((s) => s.alias));
    expect(first.snapshot.panes.map((p) => p.pane)).toEqual(["pane-1", "pane-2"]);
    expect(first.snapshot.sessions.map((s) => s.since)).toEqual([new Date(T0).toISOString(), new Date(T0 + 50).toISOString()]);
  });
  it("keeps session order stable when an earlier session changes state later", () => {
    let f = reduceFleet(emptyFleet(), ev("a", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("b", "k1", "prompt", T0 + 50), T0 + 50, DEFAULT_CONFIG);
    const first = deriveSnapshot(f, emptyAliasMap(), T0 + 60);
    f = reduceFleet(f, ev("a", "k1", "stop", T0 + 100, { backgroundTasks: 0 }), T0 + 100, DEFAULT_CONFIG);
    const second = deriveSnapshot(f, first.aliases, T0 + 100 + DEFAULT_CONFIG.minDisplayMs);
    expect(first.snapshot.sessions.map((x) => x.alias)).toEqual(["agent-1", "agent-2"]);
    expect(second.snapshot.sessions.map((x) => x.alias)).toEqual(["agent-1", "agent-2"]);
    expect(second.snapshot.sessions[0]?.state).toBe("idle");
  });

  it("breaks a tie on first sight with the session id, whatever order the events arrived in", () => {
    const seeded = ensureSessionAlias(ensureSessionAlias(emptyAliasMap(), "alpha").map, "zeta").map;
    const build = (ids: string[]) => ids.reduce((f, id) => reduceFleet(f, ev(id, "k1", "prompt", T0), T0, DEFAULT_CONFIG), emptyFleet());
    for (const order of [["zeta", "alpha"], ["alpha", "zeta"]]) {
      expect(deriveSnapshot(build(order), seeded, T0 + 10).snapshot.sessions.map((x) => x.alias)).toEqual(["agent-1", "agent-2"]);
    }
  });

  it("reports updatedAt from the last event and counts live subagents", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "subagent.start", T0 + 10, { agentId: "a1", agentType: "x" }), T0 + 10, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "subagent.start", T0 + 20, { agentId: "a2", agentType: "x" }), T0 + 20, DEFAULT_CONFIG);
    const only = deriveSnapshot(f, emptyAliasMap(), T0 + 5000).snapshot.sessions[0]!;
    expect(only.subagents).toBe(2);
    expect(only.updatedAt).toBe(new Date(T0 + 20).toISOString());
  });

  it("shows the held activity with the held state", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "tool.start", T0 + 1, { tool: "Edit", category: "edit", toolUseId: "u1" }), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "stop", T0 + 5000, { backgroundTasks: 0 }), T0 + 5000, DEFAULT_CONFIG);
    const held = deriveSnapshot(f, emptyAliasMap(), T0 + 5100).snapshot.sessions[0]!;
    expect(held).toMatchObject({ state: "working", activity: "edit" });
  });
});
