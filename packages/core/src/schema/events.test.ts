import { describe, expect, it } from "vitest";
import { RedactedEventSchema, ToolCategorySchema } from "./events";
import { ActivitySchema } from "./snapshot";

const base = { v: 1, t: 1_757_671_200_000, sessionId: "s1", paneKey: "0123456789abcdef" };

describe("RedactedEventSchema", () => {
  it("accepts every kind with its own fields", () => {
    const events = [
      { ...base, kind: "session.start", source: "startup" },
      { ...base, kind: "session.end", reason: "other" },
      { ...base, kind: "prompt" },
      { ...base, kind: "tool.start", tool: "Bash", category: "run", toolUseId: "toolu_1" },
      { ...base, kind: "tool.end", tool: "Bash", category: "run", toolUseId: "toolu_1", durationMs: 12 },
      { ...base, kind: "permission.request", tool: "Write", category: "edit" },
      { ...base, kind: "permission.denied", tool: "Write" },
      { ...base, kind: "stop", backgroundTasks: 1 },
      { ...base, kind: "subagent.start", agentId: "a1", agentType: "general-purpose" },
      { ...base, kind: "subagent.stop", agentId: "a1", agentType: "general-purpose" },
      { ...base, kind: "status", contextPct: 5, costUsd: 1.34, rateLimit5h: 7, rateLimit7d: 22, model: "Fable 5" },
      { ...base, kind: "presence", alive: false },
      { ...base, kind: "presence", alive: true, lastActiveAt: 1_757_600_000_000 },
      { ...base, kind: "history", prompts: 12 },
    ];
    for (const e of events) expect(RedactedEventSchema.parse(e).kind).toBe(e.kind);
  });

  it("takes a presence's last activity only as a whole, non-negative time", () => {
    expect(() => RedactedEventSchema.parse({ ...base, kind: "presence", alive: true, lastActiveAt: -1 })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "presence", alive: true, lastActiveAt: 1.5 })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "presence", alive: true, lastActiveAt: "2026-09-12" })).toThrow();
  });

  it("takes a transcript count only as a whole, non-negative number", () => {
    expect(() => RedactedEventSchema.parse({ ...base, kind: "history" })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "history", prompts: -1 })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "history", prompts: 2.5 })).toThrow();
  });

  it("rejects forbidden or unknown fields", () => {
    expect(() => RedactedEventSchema.parse({ ...base, kind: "prompt", prompt: "hi" })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "tool.start", tool: "Bash", category: "run", toolUseId: "x", tool_input: {} })).toThrow();
  });

  it("requires an agentId on subagent events", () => {
    expect(() => RedactedEventSchema.parse({ ...base, kind: "subagent.start", agentType: "x" })).toThrow();
  });

  it("derives the activity enum from the tool categories plus think", () => {
    expect(ActivitySchema.options).toEqual([...ToolCategorySchema.options, "think"]);
  });
});
