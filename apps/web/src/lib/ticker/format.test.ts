import { TickerEventSchema, type TickerEvent } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { formatTicker, stripAnsi } from "./format";

const T = "2026-09-12T10:04:31.000Z";
const TIME = /^\d\d:\d\d:\d\d /;

describe("formatTicker", () => {
  it("renders a tool end with its activity, tool and duration", () => {
    const line = stripAnsi(formatTicker({ t: T, kind: "tool.end", activity: "edit", tool: "Write", durationMs: 40 }));
    expect(line).toMatch(TIME);
    expect(line).toContain("tool.end");
    expect(line).toContain("edit");
    expect(line).toContain("Write");
    expect(line).toContain("40ms");
  });

  it("renders every other kind with only its own fields", () => {
    const cases: [TickerEvent, string[]][] = [
      [{ t: T, kind: "session.start" }, ["session.start"]],
      [{ t: T, kind: "prompt" }, ["prompt"]],
      [{ t: T, kind: "tool.start", activity: "read", tool: "Grep" }, ["tool.start", "read", "Grep"]],
      [{ t: T, kind: "permission", activity: "edit", tool: "Write" }, ["permission", "edit", "Write"]],
      [{ t: T, kind: "stop" }, ["stop"]],
      [{ t: T, kind: "subagent.start", agentType: "general-purpose" }, ["subagent.start", "general-purpose"]],
      [{ t: T, kind: "subagent.stop", agentType: "general-purpose" }, ["subagent.stop", "general-purpose"]],
      [{ t: T, kind: "state", state: "waiting" }, ["state", "waiting"]],
      [{ t: T, kind: "context", contextPct: 41 }, ["context", "41%"]],
      [{ t: T, kind: "session.end", reason: "prompt_input_exit" }, ["session.end", "prompt_input_exit"]],
    ];
    for (const [event, expected] of cases) {
      const line = stripAnsi(formatTicker(event));
      const tokens = line.replace(TIME, "").split(/\s+/).filter(Boolean);
      expect(tokens, event.kind).toEqual(expected);
    }
  });

  it("colours lines with ANSI sequences and strips them cleanly", () => {
    const raw = formatTicker({ t: T, kind: "state", state: "waiting" });
    expect(raw).toContain("\u001b[");
    expect(stripAnsi(raw)).not.toContain("\u001b");
  });

  it("only ever prints values the TickerEvent schema carries", () => {
    const full = TickerEventSchema.parse({ t: T, kind: "tool.end", activity: "run", tool: "Bash", durationMs: 1234, agentType: "x", state: "working", contextPct: 12, reason: "r" });
    const tokens = stripAnsi(formatTicker(full)).replace(TIME, "").split(/\s+/).filter(Boolean);
    const allowed = new Set([full.kind, full.activity, full.tool, `${full.durationMs}ms`, full.agentType, full.state, `${full.contextPct}%`, full.reason]);
    for (const token of tokens) expect(allowed.has(token), token).toBe(true);
  });
});
