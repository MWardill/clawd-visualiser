import { describe, expect, it } from "vitest";
import type { RedactedEvent } from "../schema/events";
import { TickerEventSchema } from "../schema/ticker";
import { DEFAULT_CONFIG } from "./config";
import { newSession, reduceSession } from "./session";
import { toTickerEvents } from "./ticker";

const T0 = 1_757_671_200_000;
const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ v: 1, t: T0, sessionId: "s1", paneKey: "k1", kind, ...extra }) as RedactedEvent;

describe("toTickerEvents", () => {
  it("emits the event line plus a state line when the state changed", () => {
    const before = newSession("s1", "k1", T0);
    const e = ev("prompt");
    const after = reduceSession(before, e, T0, DEFAULT_CONFIG);
    expect(toTickerEvents(e, before, after)).toEqual([
      { t: new Date(T0).toISOString(), kind: "prompt" },
      { t: new Date(T0).toISOString(), kind: "state", state: "working" },
    ]);
  });

  it("maps tool, permission, subagent, stop, end and context events", () => {
    const s = newSession("s1", "k1", T0);
    const line = (e: RedactedEvent) => toTickerEvents(e, s, s)[0];
    expect(line(ev("session.start"))).toEqual({ t: new Date(T0).toISOString(), kind: "session.start" });
    expect(line(ev("tool.start", { tool: "Bash", category: "run", toolUseId: "u" }))).toEqual({ t: new Date(T0).toISOString(), kind: "tool.start", tool: "Bash", activity: "run" });
    expect(line(ev("tool.end", { tool: "Bash", category: "run", toolUseId: "u", durationMs: 12 }))).toMatchObject({ kind: "tool.end", durationMs: 12 });
    expect(line(ev("permission.request", { tool: "Write", category: "edit" }))).toMatchObject({ kind: "permission", tool: "Write" });
    expect(line(ev("permission.denied", {}))).toEqual({ t: new Date(T0).toISOString(), kind: "permission" });
    expect(line(ev("subagent.start", { agentId: "a", agentType: "general-purpose" }))).toMatchObject({ kind: "subagent.start", agentType: "general-purpose" });
    expect(line(ev("subagent.stop", { agentId: "a", agentType: "general-purpose" }))).toMatchObject({ kind: "subagent.stop" });
    expect(line(ev("stop", { backgroundTasks: 0 }))).toMatchObject({ kind: "stop" });
    expect(line(ev("session.end", { reason: "other" }))).toMatchObject({ kind: "session.end", reason: "other" });
    expect(line(ev("status", { contextPct: 9 }))).toMatchObject({ kind: "context", contextPct: 9 });
  });

  it("emits nothing for presence or a status without context, and every line validates", () => {
    const s = newSession("s1", "k1", T0);
    expect(toTickerEvents(ev("presence", { alive: true }), s, s)).toEqual([]);
    expect(toTickerEvents(ev("status", { costUsd: 1 }), s, s)).toEqual([]);
    for (const e of [ev("prompt"), ev("tool.start", { tool: "Read", category: "read", toolUseId: "u" })]) {
      for (const line of toTickerEvents(e, s, reduceSession(s, e, T0, DEFAULT_CONFIG))) expect(() => TickerEventSchema.parse(line)).not.toThrow();
    }
  });
});
