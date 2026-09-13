import { describe, expect, it } from "vitest";
import { T0, event } from "../testing/events";
import { DEFAULT_CONFIG } from "./config";
import { emptyAliasMap } from "../alias/names";
import { emptyFleet, reduceFleet, tickFleet } from "./fleet";
import { deriveSnapshot } from "./snapshot";


describe("reduceFleet", () => {
  it("creates a session and its pane on the first event, and groups by pane", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 1, {}, { sessionId: "s2", paneKey: "k1" }), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 2, {}, { sessionId: "s3", paneKey: "k2" }), T0 + 2, DEFAULT_CONFIG);
    expect(Object.keys(f.sessions)).toEqual(["s1", "s2", "s3"]);
    expect(f.panes["k1"]?.sessionIds).toEqual(["s1", "s2"]);
    expect(f.panes["k2"]?.firstSeenAt).toBe(T0 + 2);
  });

  it("keeps one entry per session in its pane however many events that session sends", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("tool.start", T0 + 1, { tool: "Read", category: "read", toolUseId: "u1" }, { sessionId: "s1", paneKey: "k1" }), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 2, { backgroundTasks: 0 }, { sessionId: "s1", paneKey: "k1" }), T0 + 2, DEFAULT_CONFIG);
    expect(f.panes["k1"]?.sessionIds).toEqual(["s1"]);
  });

  it("seeds a session from a live presence but ignores presence for unknown dead sessions", () => {
    let f = reduceFleet(emptyFleet(), event("presence", T0, { alive: true }, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.state).toBe("idle");
    f = reduceFleet(f, event("presence", T0, { alive: false }, { sessionId: "ghost", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    expect(f.sessions["ghost"]).toBeUndefined();
  });

  it("seeds a session from presence as idle since it was last active, so a long-quiet one sleeps on the next tick", () => {
    const quietSince = T0 - DEFAULT_CONFIG.asleepAfterMs - 1;
    let f = reduceFleet(emptyFleet(), event("presence", T0, { alive: true, lastActiveAt: quietSince }), T0, DEFAULT_CONFIG);
    expect(f.sessions["s1"]).toMatchObject({ state: "idle", since: quietSince, firstSeenAt: T0, lastEventAt: T0 });
    f = tickFleet(f, T0, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.state).toBe("asleep");
  });

  it("never dates a seeded session in the future, and ignores last activity for a session it knows", () => {
    let f = reduceFleet(emptyFleet(), event("presence", T0, { alive: true, lastActiveAt: T0 + 60_000 }), T0, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.since).toBe(T0);
    f = reduceFleet(f, event("presence", T0 + 10, { alive: true, lastActiveAt: T0 - 3_600_000 }), T0 + 10, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.since).toBe(T0);
  });

  it("removes done sessions and empty panes after the linger period", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("session.end", T0 + 10, { reason: "other" }, { sessionId: "s1", paneKey: "k1" }), T0 + 10, DEFAULT_CONFIG);
    f = tickFleet(f, T0 + 10 + DEFAULT_CONFIG.doneLingerMs - 1, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.state).toBe("done");
    f = tickFleet(f, T0 + 10 + DEFAULT_CONFIG.doneLingerMs, DEFAULT_CONFIG);
    expect(f.sessions["s1"]).toBeUndefined();
    expect(f.panes["k1"]).toBeUndefined();
  });

  it("keeps a pane while any of its sessions remains", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0, {}, { sessionId: "s2", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("session.end", T0 + 10, { reason: "other" }, { sessionId: "s1", paneKey: "k1" }), T0 + 10, DEFAULT_CONFIG);
    f = tickFleet(f, T0 + 10 + DEFAULT_CONFIG.doneLingerMs, DEFAULT_CONFIG);
    expect(f.panes["k1"]?.sessionIds).toEqual(["s2"]);
  });

  it("ticks every session so idle ones fall asleep", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 1, { backgroundTasks: 0 }, { sessionId: "s1", paneKey: "k1" }), T0 + 1, DEFAULT_CONFIG);
    f = tickFleet(f, T0 + 1 + DEFAULT_CONFIG.asleepAfterMs, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.state).toBe("asleep");
  });

  it("does not mutate its input", () => {
    const before = emptyFleet();
    reduceFleet(before, event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    expect(before).toEqual(emptyFleet());
  });

  it("ignores a session.end for a session it has never seen", () => {
    const f = reduceFleet(emptyFleet(), event("session.end", T0, { reason: "other" }, { sessionId: "ghost", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    expect(f.sessions["ghost"]).toBeUndefined();
    expect(f.panes["k1"]).toBeUndefined();
  });

  it("treats ids that name inherited object properties as ordinary ids", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "constructor", paneKey: "toString" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("tool.start", T0 + 1, { tool: "Read", category: "read", toolUseId: "u1" }, { sessionId: "constructor", paneKey: "toString" }), T0 + 1, DEFAULT_CONFIG);
    expect(f.sessions["constructor"]?.state).toBe("working");
    expect(f.panes["toString"]?.sessionIds).toEqual(["constructor"]);
    expect(deriveSnapshot(f, emptyAliasMap(), T0 + 2).snapshot.sessions).toHaveLength(1);
    expect(tickFleet(f, T0 + 2, DEFAULT_CONFIG).panes["toString"]).toBeDefined();
  });
});
