import { paneKey } from "@clawd/core";
import { describe, expect, it } from "vitest";
import type { SessionView } from "../host/host";
import { T0 } from "../testing/events";
import { ALLOWED_ROOT, CANARY, CANARY_CWD, OUTSIDE_CWD, rawAgentEntry } from "../testing/raw";
import { listedIds, reconcile, sessionIdOf, type ReconcileInput } from "./reconcile";

const KEY = paneKey(CANARY_CWD);
const view = (over: Partial<SessionView> = {}): SessionView => ({ paneKey: KEY, state: "idle", firstSeenAt: T0, lastEventAt: T0, ...over });
const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  entries: [],
  sessions: new Map(),
  lastListedAt: new Map(),
  ended: new Set(),
  now: T0 + 60_000,
  allowlist: [ALLOWED_ROOT],
  graceMs: 15_000,
  ...over,
});

describe("reconcile", () => {
  it("brings a listed session the fleet has never seen in as an alive presence, without its name or path", () => {
    const events = reconcile(input({ entries: [rawAgentEntry("s1")] }));
    expect(events).toEqual([{ v: 1, t: T0 + 60_000, sessionId: "s1", paneKey: KEY, kind: "presence", alive: true }]);
    expect(JSON.stringify(events)).not.toContain(CANARY);
  });

  it("says nothing about a listed session it already knows", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], sessions: new Map([["s1", view()]]) }))).toEqual([]);
  });

  it("never brings back an ended session", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], ended: new Set(["s1"]) }))).toEqual([]);
  });

  it("ignores listed sessions outside the allowlist", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1", { cwd: OUTSIDE_CWD })] }))).toEqual([]);
  });

  it("skips malformed entries and repeats", () => {
    const entries = [null, 3, {}, { sessionId: 5 }, { sessionId: "no-cwd" }, rawAgentEntry("s1"), rawAgentEntry("s1")];
    expect(reconcile(input({ entries }))).toHaveLength(1);
  });

  it("marks a session gone once nothing has been heard from it for the grace", () => {
    const events = reconcile(input({ sessions: new Map([["s1", view()]]) }));
    expect(events).toEqual([{ v: 1, t: T0 + 60_000, sessionId: "s1", paneKey: KEY, kind: "presence", alive: false }]);
  });

  it("keeps an unlisted session that was listed, first seen, or heard from within the grace", () => {
    const now = T0 + 60_000;
    expect(reconcile(input({ sessions: new Map([["s1", view()]]), lastListedAt: new Map([["s1", now - 10_000]]) }))).toEqual([]);
    expect(reconcile(input({ sessions: new Map([["s1", view({ lastEventAt: now - 10_000 })]]) }))).toEqual([]);
    expect(reconcile(input({ sessions: new Map([["s1", view({ firstSeenAt: now - 10_000, lastEventAt: now - 10_000 })]]) }))).toEqual([]);
  });

  it("never marks a done or a listed session gone", () => {
    expect(reconcile(input({ sessions: new Map([["s1", view({ state: "done" })]]) }))).toEqual([]);
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], sessions: new Map([["s1", view()]]) }))).toEqual([]);
  });
});

describe("listed ids", () => {
  it("reads session ids leniently", () => {
    expect(sessionIdOf(rawAgentEntry("s1"))).toBe("s1");
    expect(sessionIdOf({ sessionId: "" })).toBeNull();
    expect(sessionIdOf("s1")).toBeNull();
    expect([...listedIds([rawAgentEntry("a"), null, rawAgentEntry("b"), rawAgentEntry("a")])]).toEqual(["a", "b"]);
  });
});
