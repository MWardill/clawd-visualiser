import { containsForbidden } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { ALLOWED_ROOT, CANARY, OUTSIDE_CWD, rawHook, rawSessionScript, rawStatus } from "../testing/raw";
import { ingestHook, ingestStatus, parseJson } from "./ingest";

const ctx = { now: 1_757_671_200_000, allowlist: [ALLOWED_ROOT] };

describe("ingestHook", () => {
  it("redacts every modelled hook and keeps no canary", () => {
    const events = rawSessionScript("s1").map((raw) => ingestHook(raw, ctx));
    expect(events.map((e) => e?.kind)).toEqual([
      "session.start",
      "prompt",
      "tool.start",
      "permission.request",
      "tool.end",
      "tool.start",
      "tool.end",
      "subagent.start",
      "tool.start",
      "subagent.stop",
      "stop",
      "session.end",
    ]);
    expect(JSON.stringify(events)).not.toContain(CANARY);
    expect(containsForbidden(events)).toBeNull();
  });

  it("reads PostToolUseFailure as the end of that tool call", () => {
    const e = ingestHook(rawHook("PostToolUseFailure", "s1", { tool_name: "Bash", tool_use_id: "toolu_9", is_interrupt: true }), ctx);
    expect(e).toMatchObject({ kind: "tool.end", tool: "Bash", category: "run", toolUseId: "toolu_9", durationMs: 0 });
  });

  it("reads StopFailure as a stop with nothing in the background", () => {
    expect(ingestHook(rawHook("StopFailure", "s1", { error_type: "rate_limit" }), ctx)).toMatchObject({ kind: "stop", backgroundTasks: 0 });
  });

  it("counts only subagent background tasks, never a shell", () => {
    const e = ingestHook(rawHook("Stop", "s1", { background_tasks: [{ type: "shell", command: "CANARY" }, { type: "subagent", agent_type: "x" }] }), ctx);
    expect(e).toMatchObject({ kind: "stop", backgroundTasks: 1 });
  });

  it("drops sessions outside the allowlist", () => {
    expect(ingestHook(rawHook("UserPromptSubmit", "s1", { cwd: OUTSIDE_CWD }), ctx)).toBeNull();
    expect(ingestHook(rawHook("UserPromptSubmit", "s1"), { ...ctx, allowlist: [] })).toBeNull();
  });

  it("drops unmodelled events and anything that is not a hook payload", () => {
    for (const raw of [rawHook("MessageDisplay", "s1", { delta: "CANARY" }), rawHook("Notification", "s1"), rawHook("PreCompact", "s1"), null, 42, "text", [], {}]) {
      expect(ingestHook(raw, ctx)).toBeNull();
    }
  });

  it("never accepts a status line payload on the hook route", () => {
    expect(ingestHook(rawStatus("s1"), ctx)).toBeNull();
  });

  it("stamps the event with the ingest clock", () => {
    expect(ingestHook(rawHook("UserPromptSubmit", "s1"), ctx)?.t).toBe(ctx.now);
  });
});

describe("ingestStatus", () => {
  it("keeps only context, cost, limits and model", () => {
    const e = ingestStatus(rawStatus("s1"), ctx);
    expect(e).toMatchObject({ kind: "status", contextPct: 42, costUsd: 1.25, rateLimit5h: 10, rateLimit7d: 20, model: "Opus 5" });
    expect(JSON.stringify(e)).not.toContain(CANARY);
    expect(containsForbidden(e)).toBeNull();
  });

  it("never accepts a hook payload on the status route", () => {
    expect(ingestStatus(rawHook("UserPromptSubmit", "s1"), ctx)).toBeNull();
    expect(ingestStatus(rawHook("Stop", "s1", { context_window: { used_percentage: 5 } }), ctx)).toBeNull();
  });

  it("drops junk and sessions outside the allowlist", () => {
    expect(ingestStatus(null, ctx)).toBeNull();
    expect(ingestStatus([], ctx)).toBeNull();
    expect(ingestStatus(rawStatus("s1", { cwd: OUTSIDE_CWD }), ctx)).toBeNull();
  });
});

describe("parseJson", () => {
  it("parses JSON and reports anything else without throwing", () => {
    expect(parseJson(Buffer.from('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson(Buffer.from("{"))).toEqual({ ok: false });
    expect(parseJson(Buffer.alloc(0))).toEqual({ ok: false });
  });
});
