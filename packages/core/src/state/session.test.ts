import { describe, expect, it } from "vitest";
import type { RedactedEvent } from "../schema/events";
import { DEFAULT_CONFIG } from "./config";
import { newSession, reduceSession, tickSession, type SessionState } from "./session";

const T0 = 1_757_671_200_000;
const base = { v: 1 as const, sessionId: "s1", paneKey: "k1" };
const ev = (kind: string, t: number, extra: Record<string, unknown> = {}) => ({ ...base, t, kind, ...extra }) as RedactedEvent;

function run(events: RedactedEvent[], start: SessionState = newSession("s1", "k1", T0)): SessionState {
  return events.reduce((s, e) => reduceSession(s, e, e.t, DEFAULT_CONFIG), start);
}

describe("reduceSession", () => {
  it("starts idle and goes working on a prompt", () => {
    const s = run([ev("prompt", T0 + 100)]);
    expect(s.state).toBe("working");
    expect(s.activity).toBe("think");
    expect(s.since).toBe(T0 + 100);
  });

  it("tracks tool activity and returns to think after a tool ends", () => {
    let s = run([ev("prompt", T0), ev("tool.start", T0 + 1, { tool: "Edit", category: "edit", toolUseId: "u1" })]);
    expect(s.activity).toBe("edit");
    expect(s.currentToolUseId).toBe("u1");
    s = run([ev("tool.end", T0 + 2, { tool: "Edit", category: "edit", toolUseId: "u1", durationMs: 1 })], s);
    expect(s.activity).toBe("think");
  });

  it("joins a session mid-flight: a tool.start while idle means working", () => {
    const s = run([ev("tool.start", T0, { tool: "Read", category: "read", toolUseId: "u1" })]);
    expect(s.state).toBe("working");
    expect(s.activity).toBe("read");
  });

  it("waits on a permission request and resumes on the matching tool end", () => {
    let s = run([ev("prompt", T0), ev("tool.start", T0 + 1, { tool: "Write", category: "edit", toolUseId: "u1" }), ev("permission.request", T0 + 2, { tool: "Write", category: "edit" })]);
    expect(s.state).toBe("waiting");
    expect(s.waitingOn).toBe("u1");
    s = run([ev("tool.end", T0 + 9000, { tool: "Read", category: "read", toolUseId: "other", durationMs: 1 })], s);
    expect(s.state).toBe("waiting");
    s = run([ev("tool.end", T0 + 9500, { tool: "Write", category: "edit", toolUseId: "u1", durationMs: 1 })], s);
    expect(s.state).toBe("working");
    expect(s.waitingOn).toBeNull();
  });

  it("prefers the request's own toolUseId when it has one", () => {
    const s = run([ev("prompt", T0), ev("tool.start", T0 + 1, { tool: "Read", category: "read", toolUseId: "old" }), ev("permission.request", T0 + 2, { tool: "Write", category: "edit", toolUseId: "u9" })]);
    expect(s.waitingOn).toBe("u9");
  });

  it("resumes working on a denial, and a request while idle also waits", () => {
    let s = run([ev("prompt", T0), ev("stop", T0 + 1, { backgroundTasks: 0 }), ev("permission.request", T0 + 2, { tool: "Bash", category: "run" })]);
    expect(s.state).toBe("waiting");
    s = run([ev("permission.denied", T0 + 3, { tool: "Bash" })], s);
    expect(s.state).toBe("working");
  });

  it("goes idle on a stop with nothing in the background, stays working otherwise", () => {
    const idle = run([ev("prompt", T0), ev("stop", T0 + 1, { backgroundTasks: 0 })]);
    expect(idle.state).toBe("idle");
    expect(idle.activity).toBeNull();
    const busy = run([ev("prompt", T0), ev("stop", T0 + 1, { backgroundTasks: 1 })]);
    expect(busy.state).toBe("working");
    expect(busy.activity).toBe("spawn");
  });

  it("ignores a duplicate stop while already idle", () => {
    const s = run([ev("prompt", T0), ev("stop", T0 + 1, { backgroundTasks: 0 }), ev("stop", T0 + 7000, { backgroundTasks: 0 })]);
    expect(s.state).toBe("idle");
    expect(s.since).toBe(T0 + 1);
  });

  it("counts subagents, marks the parent as spawning, and stays working until the last stop", () => {
    let s = run([ev("prompt", T0), ev("subagent.start", T0 + 1, { agentId: "a1", agentType: "general-purpose" }), ev("tool.start", T0 + 2, { agentId: "a1", tool: "Bash", category: "run", toolUseId: "u2" })]);
    expect(s.subagents).toEqual(["a1"]);
    expect(s.activity).toBe("spawn");
    s = run([ev("stop", T0 + 3, { backgroundTasks: 1 })], s);
    expect(s.state).toBe("working");
    s = run([ev("subagent.stop", T0 + 4, { agentId: "a1", agentType: "general-purpose" }), ev("prompt", T0 + 5), ev("stop", T0 + 6, { backgroundTasks: 0 })], s);
    expect(s.subagents).toEqual([]);
    expect(s.state).toBe("idle");
  });

  it("does not change state on subagent events alone", () => {
    const s = run([ev("prompt", T0), ev("stop", T0 + 1, { backgroundTasks: 0 }), ev("subagent.start", T0 + 2, { agentId: "a1", agentType: "x" })]);
    expect(s.state).toBe("idle");
    expect(s.subagents).toEqual(["a1"]);
  });

  it("records a display hold when the state changes", () => {
    const s = run([ev("prompt", T0 + 100)]);
    expect(s.displayHold).toEqual({ state: "idle", until: T0 + 100 + DEFAULT_CONFIG.minDisplayMs });
  });

  it("falls asleep after the threshold and wakes on a prompt", () => {
    let s = run([ev("prompt", T0), ev("stop", T0 + 1, { backgroundTasks: 0 })]);
    s = tickSession(s, T0 + 1 + DEFAULT_CONFIG.asleepAfterMs - 1, DEFAULT_CONFIG);
    expect(s.state).toBe("idle");
    s = tickSession(s, T0 + 1 + DEFAULT_CONFIG.asleepAfterMs, DEFAULT_CONFIG);
    expect(s.state).toBe("asleep");
    s = run([ev("prompt", T0 + 2 + DEFAULT_CONFIG.asleepAfterMs)], s);
    expect(s.state).toBe("working");
  });

  it("is done on session end or lost presence, and done is terminal", () => {
    const ended = run([ev("prompt", T0), ev("session.end", T0 + 1, { reason: "other" })]);
    expect(ended.state).toBe("done");
    const lost = run([ev("prompt", T0), ev("presence", T0 + 1, { alive: false })]);
    expect(lost.state).toBe("done");
    const still = run([ev("prompt", T0 + 2)], ended);
    expect(still.state).toBe("done");
    expect(run([ev("presence", T0 + 1, { alive: true })]).state).toBe("idle");
  });

  it("stores context from status events", () => {
    expect(run([ev("status", T0, { contextPct: 42 })]).contextPct).toBe(42);
    expect(run([ev("status", T0, { costUsd: 1 })]).contextPct).toBeNull();
  });
});
