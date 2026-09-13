import { ENDPOINTS, STREAM_EVENTS, type Snapshot, type TickerEvent } from "@clawd/core";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "./agent";
import { createLiveFeed, type EventSourceLike } from "./live";

const BASE = "http://127.0.0.1:4750";
const T = "2026-09-12T10:04:31.000Z";
const snapshot: Snapshot = { version: 1, generatedAt: T, panes: [{ pane: "pane-1", label: "Oak" }], sessions: [] };

class StubSource implements EventSourceLike {
  static instances: StubSource[] = [];
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  closed = false;
  constructor(public url: string) {
    StubSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data?: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: data === undefined ? undefined : JSON.stringify(data) } as MessageEvent);
  }
}

function harness(fetchFn?: FetchLike) {
  StubSource.instances = [];
  const feed = createLiveFeed(BASE, { EventSource: StubSource, ...(fetchFn ? { fetch: fetchFn } : {}) });
  const snapshots: Snapshot[] = [];
  const ticker: [string, TickerEvent][] = [];
  const connections: [boolean, number][] = [];
  const stop = feed.start({ onSnapshot: (s) => snapshots.push(s), onTicker: (a, e) => ticker.push([a, e]), onConnection: (c, r) => connections.push([c, r]) });
  return { feed, source: StubSource.instances[0]!, snapshots, ticker, connections, stop };
}

describe("live feed", () => {
  it("opens the stream endpoint and reports open and error as connection facts", () => {
    const h = harness();
    expect(h.source.url).toBe(`${BASE}${ENDPOINTS.stream}`);
    h.source.emit("open");
    h.source.emit("error");
    expect(h.connections).toEqual([[true, 0], [false, 0]]);
    h.stop();
    expect(h.source.closed).toBe(true);
  });

  it("delivers valid snapshots and drops invalid ones, counting them", () => {
    const h = harness();
    h.source.emit(STREAM_EVENTS.snapshot, snapshot);
    h.source.emit(STREAM_EVENTS.snapshot, { ...snapshot, prompt: "leak" });
    h.source.emit(STREAM_EVENTS.snapshot, "not json at all");
    expect(h.snapshots).toEqual([snapshot]);
    expect(h.connections.at(-1)).toEqual([true, 2]);
  });

  it("routes ticker messages by alias and rejects malformed ones", () => {
    const h = harness();
    const event: TickerEvent = { t: T, kind: "tool.end", activity: "edit", tool: "Write", durationMs: 40 };
    h.source.emit(STREAM_EVENTS.ticker, { alias: "agent-1", event });
    h.source.emit(STREAM_EVENTS.ticker, { alias: "agent-1", event: { ...event, tool_input: {} } });
    expect(h.ticker).toEqual([["agent-1", event]]);
    expect(h.connections.at(-1)).toEqual([true, 1]);
  });

  it("backfills and focuses through the agent helpers", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      return input.endsWith(ENDPOINTS.command) ? new Response(null, { status: 202 }) : new Response(JSON.stringify([{ t: T, kind: "prompt" }]), { status: 200 });
    };
    const h = harness(fetchFn);
    expect(await h.feed.backfill("agent-1")).toEqual([{ t: T, kind: "prompt" }]);
    expect(await h.feed.focus("agent-1")).toBe(true);
    expect(calls).toEqual([`GET ${BASE}${ENDPOINTS.ticker("agent-1")}`, `POST ${BASE}${ENDPOINTS.command}`]);
  });
});
