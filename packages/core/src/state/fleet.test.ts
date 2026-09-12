import { describe, expect, it } from "vitest";
import type { RedactedEvent } from "../schema/events";
import { DEFAULT_CONFIG } from "./config";
import { emptyFleet, reduceFleet, tickFleet } from "./fleet";

const T0 = 1_757_671_200_000;
const ev = (sessionId: string, paneKey: string, kind: string, t: number, extra: Record<string, unknown> = {}) =>
  ({ v: 1, sessionId, paneKey, t, kind, ...extra }) as RedactedEvent;

describe("reduceFleet", () => {
  it("creates a session and its pane on the first event, and groups by pane", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s2", "k1", "prompt", T0 + 1), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s3", "k2", "prompt", T0 + 2), T0 + 2, DEFAULT_CONFIG);
    expect(Object.keys(f.sessions)).toEqual(["s1", "s2", "s3"]);
    expect(f.panes["k1"]?.sessionIds).toEqual(["s1", "s2"]);
    expect(f.panes["k2"]?.firstSeenAt).toBe(T0 + 2);
  });

  it("seeds a session from a live presence but ignores presence for unknown dead sessions", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "presence", T0, { alive: true }), T0, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.state).toBe("idle");
    f = reduceFleet(f, ev("ghost", "k1", "presence", T0, { alive: false }), T0, DEFAULT_CONFIG);
    expect(f.sessions["ghost"]).toBeUndefined();
  });

  it("removes done sessions and empty panes after the linger period", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "session.end", T0 + 10, { reason: "other" }), T0 + 10, DEFAULT_CONFIG);
    f = tickFleet(f, T0 + 10 + DEFAULT_CONFIG.doneLingerMs - 1, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.state).toBe("done");
    f = tickFleet(f, T0 + 10 + DEFAULT_CONFIG.doneLingerMs, DEFAULT_CONFIG);
    expect(f.sessions["s1"]).toBeUndefined();
    expect(f.panes["k1"]).toBeUndefined();
  });

  it("keeps a pane while any of its sessions remains", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s2", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "session.end", T0 + 10, { reason: "other" }), T0 + 10, DEFAULT_CONFIG);
    f = tickFleet(f, T0 + 10 + DEFAULT_CONFIG.doneLingerMs, DEFAULT_CONFIG);
    expect(f.panes["k1"]?.sessionIds).toEqual(["s2"]);
  });

  it("ticks every session so idle ones fall asleep", () => {
    let f = reduceFleet(emptyFleet(), ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, ev("s1", "k1", "stop", T0 + 1, { backgroundTasks: 0 }), T0 + 1, DEFAULT_CONFIG);
    f = tickFleet(f, T0 + 1 + DEFAULT_CONFIG.asleepAfterMs, DEFAULT_CONFIG);
    expect(f.sessions["s1"]?.state).toBe("asleep");
  });

  it("does not mutate its input", () => {
    const before = emptyFleet();
    reduceFleet(before, ev("s1", "k1", "prompt", T0), T0, DEFAULT_CONFIG);
    expect(before).toEqual(emptyFleet());
  });
});
