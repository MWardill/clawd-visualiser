import { paneKey } from "@clawd/core";
import { describe, expect, it } from "vitest";
import type { SessionView } from "../host/host";
import { T0 } from "../testing/events";
import { ALLOWED_ROOT, CANARY, LOCAL_ONLY, SESSION_CWD, OUTSIDE_CWD, rawAgentEntry } from "../testing/raw";
import { listedIds, reconcile, sessionIdOf, type ReconcileInput } from "./reconcile";

const KEY = paneKey(SESSION_CWD);
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
    const { events } = reconcile(input({ entries: [rawAgentEntry("s1")] }));
    expect(events).toEqual([{ v: 1, t: T0 + 60_000, sessionId: "s1", paneKey: KEY, kind: "presence", alive: true, lastActiveAt: T0 }]);
    expect(JSON.stringify(events)).not.toContain(CANARY);
    expect(JSON.stringify(events)).not.toContain(LOCAL_ONLY);
  });

  it("keeps the directory's last segment on a first-sight presence when pane names are on, and nothing more of the path", () => {
    const [named] = reconcile(input({ entries: [rawAgentEntry("s1")], paneNames: true })).events;
    expect(named).toMatchObject({ kind: "presence", paneName: "repo" });
    expect(JSON.stringify(named)).not.toContain(CANARY);
    expect(JSON.stringify(named)).not.toContain(LOCAL_ONLY);
    expect(reconcile(input({ entries: [rawAgentEntry("s1")] })).events[0]).not.toHaveProperty("paneName");
  });

  it("puts the listed session's directory and name in detail at paths, and no detail at none", () => {
    const [atPaths] = reconcile(input({ entries: [rawAgentEntry("s1")], detail: "paths" })).events;
    expect(atPaths).toMatchObject({ kind: "presence", alive: true, detail: { dir: SESSION_CWD, name: "LOCALONLY session name" } });
    expect(JSON.stringify(atPaths)).not.toContain(CANARY);
    for (const detail of [undefined, "none", "hints"] as const) {
      const [event] = reconcile(input({ entries: [rawAgentEntry("s1")], ...(detail === undefined ? {} : { detail }) })).events;
      expect(event).not.toHaveProperty("detail");
      expect(JSON.stringify(event)).not.toContain(LOCAL_ONLY);
    }
  });

  it("dates a first-sight session by its transcript's last write when the poller found one", () => {
    const entries = [rawAgentEntry("s1", { startedAt: T0 - 86_400_000 }), rawAgentEntry("s2", { startedAt: T0 - 86_400_000 })];
    const { events } = reconcile(input({ entries, lastWriteAt: new Map([["s1", T0 - 3_600_000]]) }));
    expect(events.map((e) => (e.kind === "presence" ? e.lastActiveAt : null))).toEqual([T0 - 3_600_000, T0 - 86_400_000]);
  });

  it("says nothing about a listed session it already knows", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], sessions: new Map([["s1", view()]]) })).events).toEqual([]);
  });

  it("never brings back an ended session", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], ended: new Set(["s1"]) })).events).toEqual([]);
  });

  it("ignores listed sessions outside the allowlist", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1", { cwd: OUTSIDE_CWD })] })).events).toEqual([]);
  });

  it("skips malformed entries and repeats", () => {
    const entries = [null, 3, {}, { sessionId: 5 }, { sessionId: "no-cwd" }, rawAgentEntry("s1"), rawAgentEntry("s1")];
    expect(reconcile(input({ entries })).events).toHaveLength(1);
  });

  it("marks a session gone once nothing has been heard from it for the grace", () => {
    const { events } = reconcile(input({ sessions: new Map([["s1", view()]]) }));
    expect(events).toEqual([{ v: 1, t: T0 + 60_000, sessionId: "s1", paneKey: KEY, kind: "presence", alive: false }]);
  });

  it("keeps an unlisted session that was listed, first seen, or heard from within the grace", () => {
    const now = T0 + 60_000;
    expect(reconcile(input({ sessions: new Map([["s1", view()]]), lastListedAt: new Map([["s1", now - 10_000]]) })).events).toEqual([]);
    expect(reconcile(input({ sessions: new Map([["s1", view({ lastEventAt: now - 10_000 })]]) })).events).toEqual([]);
    expect(reconcile(input({ sessions: new Map([["s1", view({ firstSeenAt: now - 10_000, lastEventAt: now - 10_000 })]]) })).events).toEqual([]);
  });

  it("never marks a done or a listed session gone", () => {
    expect(reconcile(input({ sessions: new Map([["s1", view({ state: "done" })]]) })).events).toEqual([]);
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], sessions: new Map([["s1", view()]]) })).events).toEqual([]);
  });
});

describe("listed detail for a known session", () => {
  const known = new Map([["s1", view({ state: "working" })]]);
  const named = (name: string | undefined) => rawAgentEntry("s1", { name });
  const atPaths = (over: Partial<ReconcileInput>) => input({ sessions: known, detail: "paths", ...over });

  it("at paths sends a known session one alive presence carrying its listed directory and name", () => {
    const first = reconcile(atPaths({ entries: [named("LOCALONLY first")] }));
    expect(first.events).toEqual([{ v: 1, t: T0 + 60_000, sessionId: "s1", paneKey: KEY, kind: "presence", alive: true, lastActiveAt: T0, detail: { dir: SESSION_CWD, name: "LOCALONLY first" } }]);
    expect(JSON.stringify(first.events)).not.toContain(CANARY);
    expect(first.sent).toEqual(new Map([["s1", { dir: SESSION_CWD, name: "LOCALONLY first" }]]));
  });

  it("sends nothing when the next poll lists the same entry, and one more presence when the name changes", () => {
    const first = reconcile(atPaths({ entries: [named("LOCALONLY first")] }));
    const same = reconcile(atPaths({ entries: [named("LOCALONLY first")], sent: first.sent }));
    expect(same.events).toEqual([]);
    expect(same.sent).toEqual(first.sent);
    const renamed = reconcile(atPaths({ entries: [named("LOCALONLY second")], sent: same.sent }));
    expect(renamed.events).toHaveLength(1);
    expect(renamed.events[0]).toMatchObject({ kind: "presence", alive: true, detail: { dir: SESSION_CWD, name: "LOCALONLY second" } });
    expect(renamed.sent.get("s1")).toEqual({ dir: SESSION_CWD, name: "LOCALONLY second" });
  });

  it("counts an absent name as a value, so a name dropped or given is a change", () => {
    const unnamed = reconcile(atPaths({ entries: [named(undefined)] }));
    expect(unnamed.events[0]).toMatchObject({ detail: { dir: SESSION_CWD } });
    expect(unnamed.sent.get("s1")).toEqual({ dir: SESSION_CWD });
    expect(reconcile(atPaths({ entries: [named(undefined)], sent: unnamed.sent })).events).toEqual([]);
    expect(reconcile(atPaths({ entries: [named("LOCALONLY given")], sent: unnamed.sent })).events).toHaveLength(1);
  });

  it("sends a known session nothing below paths", () => {
    for (const detail of [undefined, "none", "hints"] as const) {
      const result = reconcile(input({ entries: [named("LOCALONLY first")], sessions: known, ...(detail === undefined ? {} : { detail }) }));
      expect(result.events).toEqual([]);
      expect(result.sent.size).toBe(0);
    }
  });

  it("sends an ended or a done session nothing", () => {
    expect(reconcile(atPaths({ entries: [named("LOCALONLY first")], ended: new Set(["s1"]) })).events).toEqual([]);
    expect(reconcile(atPaths({ entries: [named("LOCALONLY first")], sessions: new Map([["s1", view({ state: "done" })]]) })).events).toEqual([]);
  });

  it("records a first-sight presence's detail, so the next poll sends nothing", () => {
    const first = reconcile(input({ entries: [named("LOCALONLY first")], detail: "paths" }));
    expect(first.events).toHaveLength(1);
    expect(reconcile(atPaths({ entries: [named("LOCALONLY first")], sent: first.sent })).events).toEqual([]);
  });

  it("forgets an id that leaves the list, so it is sent again when it returns with the same name", () => {
    const first = reconcile(atPaths({ entries: [named("LOCALONLY first")] }));
    const left = reconcile(atPaths({ entries: [], sent: first.sent, lastListedAt: new Map([["s1", T0 + 55_000]]) }));
    expect(left.events).toEqual([]);
    expect(left.sent.has("s1")).toBe(false);
    expect(reconcile(atPaths({ entries: [named("LOCALONLY first")], sent: left.sent })).events).toHaveLength(1);
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
