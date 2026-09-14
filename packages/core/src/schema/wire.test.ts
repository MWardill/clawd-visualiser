import { describe, expect, it } from "vitest";
import { CommandSchema, SnapshotSchema, TickerEventSchema } from "./index";
import { DEFAULT_AGENT_URL, ENDPOINTS, STREAM_EVENTS, StreamTickerMessageSchema } from "./transport";

const validSnapshot = {
  version: 1,
  generatedAt: "2026-09-12T10:00:00.000Z",
  panes: [{ pane: "pane-1", label: "Oak", collision: false }],
  sessions: [
    {
      alias: "agent-1",
      label: "Otter",
      pane: "pane-1",
      state: "working",
      activity: "edit",
      subagents: 0,
      contextPct: 12,
      since: "2026-09-12T09:59:00.000Z",
      updatedAt: "2026-09-12T10:00:00.000Z",
    },
  ],
};

describe("wire schemas", () => {
  it("accepts a valid snapshot and infers its type", () => {
    const parsed = SnapshotSchema.parse(validSnapshot);
    expect(parsed.sessions[0]?.state).toBe("working");
  });

  it("rejects unknown top-level fields but allows ext", () => {
    expect(() => SnapshotSchema.parse({ ...validSnapshot, extra: 1 })).toThrow();
    expect(SnapshotSchema.parse({ ...validSnapshot, ext: { anything: [1, 2] } }).ext).toEqual({ anything: [1, 2] });
  });

  it("rejects a session with an unknown state or a contextPct outside 0-100", () => {
    const bad = { ...validSnapshot, sessions: [{ ...validSnapshot.sessions[0], state: "busy" }] };
    expect(() => SnapshotSchema.parse(bad)).toThrow();
    const over = { ...validSnapshot, sessions: [{ ...validSnapshot.sessions[0], contextPct: 101 }] };
    expect(() => SnapshotSchema.parse(over)).toThrow();
  });

  it("validates ticker events and commands", () => {
    expect(TickerEventSchema.parse({ t: "2026-09-12T10:00:00.000Z", kind: "tool.start", tool: "Read", activity: "read" }).tool).toBe("Read");
    expect(() => TickerEventSchema.parse({ t: "2026-09-12T10:00:00.000Z", kind: "tool.start", prompt: "secret" })).toThrow();
    expect(CommandSchema.parse({ type: "focus", alias: "agent-1" })).toEqual({ type: "focus", alias: "agent-1" });
    expect(() => CommandSchema.parse({ type: "shutdown" })).toThrow();
  });

  it("pins the transport constants", () => {
    expect(DEFAULT_AGENT_URL).toBe("http://127.0.0.1:4750");
    expect(ENDPOINTS.stream).toBe("/api/stream");
    expect(ENDPOINTS.ticker("agent-3")).toBe("/api/ticker/agent-3");
    expect(STREAM_EVENTS).toEqual({ snapshot: "snapshot", ticker: "ticker" });
    expect(StreamTickerMessageSchema.parse({ alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "prompt" } }).alias).toBe("agent-1");
  });

  it("accepts a pane that does not report collision yet", () => {
    const parsed = SnapshotSchema.parse({ ...validSnapshot, panes: [{ pane: "pane-1", label: "Oak" }] });
    expect(parsed.panes[0]).toEqual({ pane: "pane-1", label: "Oak" });
  });

  it("carries detail on sessions, panes and ticker lines, and rejects a raw key inside it", () => {
    const session = { ...validSnapshot.sessions[0], detail: { name: "Fix login", dir: "C:/mw/visualiser", permissionMode: "plan", shells: 1, subject: { kind: "file", text: "src/app.ts" } } };
    const pane = { pane: "pane-1", label: "Oak", detail: { dir: "C:/mw/visualiser" } };
    const parsed = SnapshotSchema.parse({ ...validSnapshot, panes: [pane], sessions: [session] });
    expect(parsed.sessions[0]?.detail?.subject).toEqual({ kind: "file", text: "src/app.ts" });
    expect(parsed.panes[0]?.detail).toEqual({ dir: "C:/mw/visualiser" });
    expect(() => SnapshotSchema.parse({ ...validSnapshot, sessions: [{ ...validSnapshot.sessions[0], detail: { cwd: "C:/mw" } }] })).toThrow();
    expect(TickerEventSchema.parse({ t: "2026-09-12T10:00:00.000Z", kind: "tool.start", tool: "Bash", activity: "run", detail: { subject: { kind: "program", text: "git" } } }).detail?.subject?.text).toBe("git");
    expect(() => TickerEventSchema.parse({ t: "2026-09-12T10:00:00.000Z", kind: "tool.start", detail: { file: "x" } })).toThrow();
  });
});
