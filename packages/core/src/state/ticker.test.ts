import { describe, expect, it } from "vitest";
import type { RedactedEvent } from "../schema/events";
import { TickerEventSchema } from "../schema/ticker";
import { T0, event } from "../testing/events";
import { DEFAULT_CONFIG } from "./config";
import { newSession, reduceSession } from "./session";
import { toTickerEvents } from "./ticker";


describe("toTickerEvents", () => {
  it("emits the event line plus a state line when the state changed", () => {
    const before = newSession("s1", "k1", T0);
    const e = event("prompt", T0, {});
    const after = reduceSession(before, e, T0, DEFAULT_CONFIG);
    expect(toTickerEvents(e, before, after)).toEqual([
      { t: new Date(T0).toISOString(), kind: "prompt" },
      { t: new Date(T0).toISOString(), kind: "state", state: "working" },
    ]);
  });

  it("maps tool, permission, subagent, stop, end and context events", () => {
    const s = newSession("s1", "k1", T0);
    const line = (e: RedactedEvent) => toTickerEvents(e, s, s)[0];
    expect(line(event("session.start", T0, {}))).toEqual({ t: new Date(T0).toISOString(), kind: "session.start" });
    expect(line(event("tool.start", T0, { tool: "Bash", category: "run", toolUseId: "u" }))).toEqual({ t: new Date(T0).toISOString(), kind: "tool.start", tool: "Bash", activity: "run" });
    expect(line(event("tool.end", T0, { tool: "Bash", category: "run", toolUseId: "u", durationMs: 12 }))).toMatchObject({ kind: "tool.end", durationMs: 12 });
    expect(line(event("permission.request", T0, { tool: "Write", category: "edit" }))).toMatchObject({ kind: "permission", tool: "Write" });
    expect(line(event("permission.denied", T0, {}))).toEqual({ t: new Date(T0).toISOString(), kind: "permission", reason: "denied" });
    expect(line(event("permission.denied", T0, { tool: "Write" }))).toEqual({ t: new Date(T0).toISOString(), kind: "permission", tool: "Write", reason: "denied" });
    expect(line(event("subagent.start", T0, { agentId: "a", agentType: "general-purpose" }))).toMatchObject({ kind: "subagent.start", agentType: "general-purpose" });
    expect(line(event("subagent.stop", T0, { agentId: "a", agentType: "general-purpose" }))).toMatchObject({ kind: "subagent.stop" });
    expect(line(event("stop", T0, { backgroundTasks: 0 }))).toMatchObject({ kind: "stop" });
    expect(line(event("session.end", T0, { reason: "other" }))).toMatchObject({ kind: "session.end", reason: "other" });
    expect(line(event("status", T0, { contextPct: 9 }))).toMatchObject({ kind: "context", contextPct: 9 });
  });

  it("emits nothing for presence or a status without context, and every line validates", () => {
    const s = newSession("s1", "k1", T0);
    expect(toTickerEvents(event("presence", T0, { alive: true }), s, s)).toEqual([]);
    expect(toTickerEvents(event("history", T0, { prompts: 3 }), s, { ...s, prompts: 3 })).toEqual([]);
    expect(toTickerEvents(event("status", T0, { costUsd: 1 }), s, s)).toEqual([]);
    for (const e of [event("prompt", T0, {}), event("tool.start", T0, { tool: "Read", category: "read", toolUseId: "u" })]) {
      for (const line of toTickerEvents(e, s, reduceSession(s, e, T0, DEFAULT_CONFIG))) expect(() => TickerEventSchema.parse(line)).not.toThrow();
    }
  });
  it("emits no state line for a session it has never seen before", () => {
    const e = event("prompt", T0, {});
    const after = reduceSession(newSession("s1", "k1", T0), e, T0, DEFAULT_CONFIG);
    expect(toTickerEvents(e, null, after)).toEqual([{ t: new Date(T0).toISOString(), kind: "prompt" }]);
  });
});
