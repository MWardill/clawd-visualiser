import { describe, expect, it } from "vitest";
import { emptyAliasMap } from "../alias/names";
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
    expect(snapshot.panes[0]).toMatchObject({ pane: "pane-1", collision: false });
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

  it("keeps aliases stable across calls and orders panes by first sight, sessions by since", () => {
    let f = reduceFleet(emptyFleet(), ev("late", "k2", "prompt", T0 + 50), T0 + 50, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("early", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    const first = deriveSnapshot(f, emptyAliasMap(), T0 + 100);
    const second = deriveSnapshot(f, first.aliases, T0 + 200);
    expect(second.snapshot.sessions.map((s) => s.alias)).toEqual(first.snapshot.sessions.map((s) => s.alias));
    expect(first.snapshot.panes.map((p) => p.pane)).toEqual(["pane-1", "pane-2"]);
    expect(first.snapshot.sessions.map((s) => s.since)).toEqual([new Date(T0).toISOString(), new Date(T0 + 50).toISOString()]);
  });
});
