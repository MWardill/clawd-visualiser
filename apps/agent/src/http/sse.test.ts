import type { Snapshot } from "@clawd/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamHub, type StreamRequest, type StreamResponse } from "./sse";

class FakeRes implements StreamResponse {
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableLength = 0;
  writableEnded = false;
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
    return this;
  }
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end(chunk?: string) {
    if (chunk !== undefined) this.chunks.push(chunk);
    this.writableEnded = true;
    return this;
  }
  get text() {
    return this.chunks.join("");
  }
}

class FakeReq implements StreamRequest {
  private listeners: (() => void)[] = [];
  on(_event: "close", listener: () => void) {
    this.listeners.push(listener);
    return this;
  }
  close() {
    for (const l of this.listeners) l();
  }
}

const snap = (generatedAt: string, extra: Partial<Snapshot> = {}): Snapshot => ({ version: 1, generatedAt, panes: [], sessions: [], ...extra });
const frames = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => ({ event: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null") as unknown }));

describe("stream hub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function hub(over: Partial<Parameters<typeof createStreamHub>[0]> = {}) {
    const log = vi.fn();
    const h = createStreamHub({ current: () => snap("1970-01-01T00:00:00.000Z"), log, ...over });
    return { h, log };
  }

  it("opens an event stream with the extra headers and sends the current snapshot at once", () => {
    const { h } = hub();
    const res = new FakeRes();
    h.connect(new FakeReq(), res, { "access-control-allow-origin": "http://localhost:3000" });
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "http://localhost:3000" });
    expect(frames(res.text)).toEqual([{ event: "snapshot", data: snap("1970-01-01T00:00:00.000Z") }]);
    expect(h.clientCount()).toBe(1);
  });

  it("sends at most one snapshot per interval, then the latest one", async () => {
    const { h } = hub();
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    h.snapshot(snap("1970-01-01T00:00:00.001Z"));
    await vi.advanceTimersByTimeAsync(100);
    h.snapshot(snap("1970-01-01T00:00:00.100Z"));
    await vi.advanceTimersByTimeAsync(100);
    h.snapshot(snap("1970-01-01T00:00:00.200Z"));
    expect(frames(res.text).map((f) => (f.data as Snapshot).generatedAt)).toEqual(["1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.001Z"]);
    await vi.advanceTimersByTimeAsync(50);
    expect(frames(res.text).map((f) => (f.data as Snapshot).generatedAt)).toEqual(["1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.001Z", "1970-01-01T00:00:00.200Z"]);
  });

  it("broadcasts valid ticker messages to every client at once and drops invalid ones", () => {
    const { h, log } = hub();
    const a = new FakeRes();
    const b = new FakeRes();
    h.connect(new FakeReq(), a);
    h.connect(new FakeReq(), b);
    h.ticker({ alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "prompt" } });
    h.ticker({ alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "prompt", prompt: "CANARY" } } as never);
    for (const res of [a, b]) {
      expect(frames(res.text).filter((f) => f.event === "ticker")).toEqual([{ event: "ticker", data: { alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "prompt" } } }]);
      expect(res.text).not.toContain("CANARY");
    }
    expect(log).toHaveBeenCalledWith("privacy.blocked");
  });

  it("sends a heartbeat comment every fifteen seconds while clients are connected", async () => {
    const { h } = hub();
    const req = new FakeReq();
    const res = new FakeRes();
    h.connect(req, res);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.text).toContain(": heartbeat\n\n");
    req.close();
    expect(h.clientCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses a client over the limit", () => {
    const { h, log } = hub({ maxClients: 1 });
    h.connect(new FakeReq(), new FakeRes());
    const extra = new FakeRes();
    h.connect(new FakeReq(), extra);
    expect(extra.status).toBe(503);
    expect(extra.writableEnded).toBe(true);
    expect(h.clientCount()).toBe(1);
    expect(log).toHaveBeenCalledWith("stream.clientLimit");
  });

  it("closes a client that stops reading", () => {
    const { h, log } = hub({ maxBufferedBytes: 10 });
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    res.writableLength = 11;
    h.ticker({ alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "stop" } });
    expect(res.writableEnded).toBe(true);
    expect(h.clientCount()).toBe(0);
    expect(log).toHaveBeenCalledWith("stream.slowClient");
  });

  it("never sends a snapshot carrying a forbidden key or a live directory", async () => {
    const { h, log } = hub({ sensitive: () => ["C:/work/CANARY-repo"] });
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    h.snapshot(snap("1970-01-01T00:00:01.000Z", { ext: { prompt: "x" } }));
    await vi.advanceTimersByTimeAsync(1_000);
    h.snapshot(snap("1970-01-01T00:00:02.000Z", { panes: [{ pane: "pane-1", label: "C:/work/CANARY-repo" }] }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(frames(res.text)).toHaveLength(1);
    expect(res.text).not.toContain("CANARY");
    expect(log).toHaveBeenCalledWith("privacy.blocked");
  });

  it("ends every client and clears its timers on closeAll", async () => {
    const { h } = hub();
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    h.snapshot(snap("1970-01-01T00:00:00.001Z"));
    h.snapshot(snap("1970-01-01T00:00:00.002Z"));
    h.closeAll();
    expect(res.writableEnded).toBe(true);
    expect(h.clientCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
