import {
  DEFAULT_CONFIG,
  SnapshotSchema,
  TICKER_BACKFILL,
  emptyAliasMap,
  parseFixture,
  snapshotFrames,
  type AliasMap,
  type Snapshot,
  type SnapshotFrame,
  type StreamTickerMessage,
} from "@clawd/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../log";
import { T0, ev } from "../testing/events";
import { FleetHost } from "./host";

const FIXTURES = fileURLToPath(new URL("../../../../packages/core/src/fixtures/", import.meta.url));
const iso = (ms: number): string => new Date(ms).toISOString();

function makeHost(start = T0, aliases: AliasMap = emptyAliasMap()) {
  const clock = { now: start };
  const host = new FleetHost({ now: () => clock.now, config: DEFAULT_CONFIG, aliases, log: silentLogger });
  const seen = { events: [] as string[], tickers: [] as StreamTickerMessage[], snapshots: [] as Snapshot[], aliases: [] as AliasMap[] };
  host.on({
    event: (e) => seen.events.push(e.kind),
    ticker: (m) => seen.tickers.push(m),
    snapshot: (s) => seen.snapshots.push(s),
    aliases: (a) => seen.aliases.push(a),
  });
  return { host, clock, seen };
}

const withoutUpdatedAt = (f: SnapshotFrame) => ({ ...f, sessions: f.sessions.map(({ updatedAt: _u, ...s }) => s) });

describe("FleetHost against core's fixtures", () => {
  it.each(["permission-denied", "killed-session", "spike-headless", "spike-interactive"])("%s ends where core's golden sequence ends", (name) => {
    const fixture = parseFixture(readFileSync(join(FIXTURES, `${name}.jsonl`), "utf8"));
    const expected = snapshotFrames(fixture).at(-1);
    expect(expected).toBeDefined();
    const { host, clock } = makeHost(0);
    for (const e of fixture.events) {
      clock.now = e.t;
      host.ingest(e);
      host.tick();
    }
    clock.now = (fixture.events.at(-1)?.t ?? 0) + DEFAULT_CONFIG.minDisplayMs;
    const { generatedAt: _g, ...last } = host.snapshot();
    expect(withoutUpdatedAt(last)).toEqual(withoutUpdatedAt(expected as SnapshotFrame));
  });
});

describe("FleetHost restore", () => {
  it("replays logged events at their recorded times, with their ticker lines, without writing them back", () => {
    const { host, seen } = makeHost(T0 + 5 * 60_000);
    host.restore([ev("prompt", T0, {}), ev("tool.start", T0 + 1_000, { tool: "Bash", category: "run", toolUseId: "u1" })]);
    expect(seen.events).toEqual([]);
    expect(host.sessions().get("s1")).toEqual({ paneKey: "pane-key-1", state: "working", firstSeenAt: T0, lastEventAt: T0 + 1_000 });
    expect(host.snapshot().sessions[0]).toMatchObject({ state: "working", activity: "run", since: iso(T0) });
    expect(host.tickerFor("agent-1")?.map((line) => line.t)).toEqual([iso(T0), iso(T0 + 1_000)]);
  });

  it("brings a session idle in the log back asleep once it has been quiet long enough", () => {
    const { host, clock } = makeHost(T0 + DEFAULT_CONFIG.asleepAfterMs + 2_000);
    host.restore([ev("prompt", T0, {}), ev("stop", T0 + 1_000, { backgroundTasks: 0 })]);
    clock.now += DEFAULT_CONFIG.minDisplayMs;
    expect(host.snapshot().sessions[0]?.state).toBe("asleep");
  });

  it("keeps a session the log shows ended out of the fleet, even when a poll still lists it", () => {
    const { host } = makeHost(T0 + 60_000);
    host.restore([ev("prompt", T0, {}), ev("session.end", T0 + 1, { reason: "other" })]);
    expect(host.sessionCount()).toBe(0);
    host.ingest(ev("presence", T0 + 60_000, { alive: true }));
    expect(host.sessionCount()).toBe(0);
  });

  it("drops restored sessions the first poll does not list, keeps those heard from since, and decides only once", () => {
    const { host, clock, seen } = makeHost(T0 + 60_000);
    host.restore([ev("prompt", T0, {}, "s1"), ev("prompt", T0, {}, "s2"), ev("prompt", T0, {}, "s3")]);
    host.ingest(ev("tool.start", clock.now, { tool: "Read", category: "read", toolUseId: "u1" }, "s3"));
    const tickers = seen.tickers.length;
    host.settleRestored(new Set(["s1"]));
    expect([...host.sessions().keys()]).toEqual(["s1", "s3"]);
    expect(host.snapshot().sessions).toHaveLength(2);
    expect(host.endedIds().size).toBe(0);
    expect(seen.tickers).toHaveLength(tickers);
    host.settleRestored(new Set());
    expect([...host.sessions().keys()]).toEqual(["s1", "s3"]);
  });
});

describe("FleetHost", () => {
  it("reduces an event and emits the event, its ticker lines under the session alias, and a snapshot", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    expect(seen.events).toEqual(["prompt"]);
    expect(seen.tickers).toEqual([{ alias: "agent-1", event: { t: iso(T0), kind: "prompt" } }]);
    expect(seen.snapshots).toHaveLength(1);
    expect(() => SnapshotSchema.parse(seen.snapshots[0])).not.toThrow();
    clock.now = T0 + DEFAULT_CONFIG.minDisplayMs;
    expect(host.snapshot().sessions[0]).toMatchObject({ alias: "agent-1", label: "Otter", state: "working", activity: "think" });
    expect(host.tickerFor("agent-1")).toEqual([{ t: iso(T0), kind: "prompt" }]);
    expect(host.tickerFor("agent-99")).toBeNull();
    expect(host.sessionIdFor("agent-1")).toBe("s1");
    expect(host.sessionIdFor("agent-99")).toBeNull();
    expect(host.sessionCount()).toBe(1);
  });

  it("emits a snapshot only when it changed", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.tick();
    host.tick();
    expect(seen.snapshots).toHaveLength(1);
    clock.now = T0 + DEFAULT_CONFIG.minDisplayMs;
    host.tick();
    expect(seen.snapshots).toHaveLength(2);
  });

  it("keeps the last TICKER_BACKFILL lines per session", () => {
    const { host } = makeHost();
    for (let i = 0; i < 150; i++) {
      host.ingest(ev("tool.start", T0, { tool: "Read", category: "read", toolUseId: `u${i}` }));
      host.ingest(ev("tool.end", T0, { tool: "Read", category: "read", toolUseId: `u${i}`, durationMs: 1 }));
    }
    const lines = host.tickerFor("agent-1");
    expect(lines).toHaveLength(TICKER_BACKFILL);
    expect(lines?.at(-1)).toMatchObject({ kind: "tool.end" });
  });

  it("drops a second session.start inside five seconds and keeps one after", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("session.start", T0, { source: "startup" }));
    clock.now = T0 + 1_000;
    host.ingest(ev("session.start", clock.now, {}));
    expect(seen.tickers.map((m) => m.event.kind)).toEqual(["session.start"]);
    clock.now = T0 + 7_000;
    host.ingest(ev("session.start", clock.now, {}));
    expect(seen.tickers.map((m) => m.event.kind)).toEqual(["session.start", "session.start"]);
  });

  it("drops a status line that does not change the rounded context percentage", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("status", T0, { contextPct: 40.2 }));
    clock.now = T0 + 100;
    host.ingest(ev("status", clock.now, { contextPct: 39.8 }));
    host.ingest(ev("status", clock.now, { costUsd: 2 }));
    expect(seen.events).toEqual(["status"]);
    host.ingest(ev("status", clock.now, { contextPct: 41 }));
    expect(seen.events).toEqual(["status", "status"]);
    expect(seen.tickers.map((m) => m.event)).toEqual([
      { t: iso(T0), kind: "context", contextPct: 40.2 },
      { t: iso(T0 + 100), kind: "context", contextPct: 41 },
    ]);
  });

  it("drops stragglers for an ended session until a session.start reopens it", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("session.end", T0, { reason: "other" }));
    expect(host.endedIds().has("s1")).toBe(true);
    clock.now = T0 + DEFAULT_CONFIG.doneLingerMs;
    host.tick();
    expect(host.sessionCount()).toBe(0);
    const before = seen.events.length;
    host.ingest(ev("status", clock.now, { contextPct: 12 }));
    host.ingest(ev("subagent.stop", clock.now, { agentId: "a1", agentType: "general-purpose" }));
    host.ingest(ev("presence", clock.now, { alive: true }));
    expect(host.sessionCount()).toBe(0);
    expect(seen.events).toHaveLength(before);
    host.ingest(ev("session.start", clock.now, { source: "resume" }));
    expect(host.endedIds().has("s1")).toBe(false);
    expect(host.sessionCount()).toBe(1);
  });

  it("records a session.end for a session it never saw, so a presence poll cannot create it", () => {
    const { host } = makeHost();
    host.ingest(ev("session.end", T0, { reason: "other" }));
    expect(host.sessionCount()).toBe(0);
    host.ingest(ev("presence", T0, { alive: true }));
    expect(host.sessionCount()).toBe(0);
  });

  it("adds a dead presence to the ended set and forgets ended ids the poll no longer lists", () => {
    const { host } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("presence", T0, { alive: false }));
    expect([...host.endedIds()]).toEqual(["s1"]);
    host.forgetEnded(new Set(["s1"]));
    expect([...host.endedIds()]).toEqual(["s1"]);
    host.forgetEnded(new Set());
    expect([...host.endedIds()]).toEqual([]);
  });

  it("hands out a copy of the ended set that later events do not change", () => {
    const { host } = makeHost();
    const before = host.endedIds();
    host.ingest(ev("session.end", T0, { reason: "other" }));
    expect([...before]).toEqual([]);
    expect([...host.endedIds()]).toEqual(["s1"]);
  });

  it("writes a state line when a tick changes a session's state", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("stop", T0, { backgroundTasks: 0 }));
    clock.now = T0 + DEFAULT_CONFIG.asleepAfterMs;
    host.tick();
    expect(seen.tickers.at(-1)).toEqual({ alias: "agent-1", event: { t: iso(clock.now), kind: "state", state: "asleep" } });
    clock.now += DEFAULT_CONFIG.minDisplayMs;
    expect(host.snapshot().sessions[0]?.state).toBe("asleep");
  });

  it("drops the ticker of a pruned session but still knows its alias", () => {
    const { host, clock } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("session.end", T0, { reason: "other" }));
    clock.now = T0 + DEFAULT_CONFIG.doneLingerMs;
    host.tick();
    expect(host.tickerFor("agent-1")).toEqual([]);
  });

  it("announces the alias map when a session or pane is first named, not on every event", () => {
    const { host, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    const count = seen.aliases.length;
    expect(count).toBeGreaterThan(0);
    expect(Object.keys(seen.aliases.at(-1)?.sessions ?? {})).toEqual(["s1"]);
    expect(host.aliases()).toBe(seen.aliases.at(-1));
    host.ingest(ev("tool.start", T0, { tool: "Read", category: "read", toolUseId: "u1" }));
    expect(seen.aliases).toHaveLength(count);
  });

  it("starts from a persisted alias map", () => {
    const persisted: AliasMap = { sessions: { s1: { alias: "agent-7", label: "Otter" } }, panes: {}, nextSession: 8, nextPane: 1 };
    const { host, seen } = makeHost(T0, persisted);
    host.ingest(ev("prompt", T0, {}));
    expect(seen.tickers[0]?.alias).toBe("agent-7");
  });

  it("describes sessions for reconciliation", () => {
    const { host, clock } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    clock.now = T0 + 50;
    host.ingest(ev("stop", clock.now, { backgroundTasks: 0 }));
    expect(host.sessions().get("s1")).toEqual({ paneKey: "pane-key-1", state: "idle", firstSeenAt: T0, lastEventAt: T0 + 50 });
  });

  it("keeps going when a listener throws, and stops calling one that unsubscribed", () => {
    const log = vi.fn();
    const host = new FleetHost({ now: () => T0, config: DEFAULT_CONFIG, aliases: emptyAliasMap(), log });
    const snapshots: Snapshot[] = [];
    const events: string[] = [];
    host.on({ event: () => { throw new Error("boom"); } });
    host.on({ snapshot: (s) => snapshots.push(s) });
    const off = host.on({ event: (e) => events.push(e.kind) });
    host.ingest(ev("prompt", T0, {}));
    off();
    host.ingest(ev("stop", T0, { backgroundTasks: 0 }));
    expect(snapshots.length).toBeGreaterThan(0);
    expect(events).toEqual(["prompt"]);
    expect(log).toHaveBeenCalledWith("host.listenerFailed");
  });
});
