import { describe, expect, it } from "vitest";
import { RawHookSchema } from "../schema/raw";
import { FORBIDDEN_KEYS, containsForbidden, redact, redactPresence } from "./redact";

const cwd = "C:\\mw\\visualiser";
const ctx = { now: 1_757_671_200_000, allowlist: ["C:\\mw"] };
const common = { session_id: "e82c9e2a", transcript_path: "C:\\Users\\me\\.claude\\projects\\x\\e82c9e2a.jsonl", cwd, prompt_id: "p1", permission_mode: "default" };

/** Raw payloads shaped exactly as the spike recorded them. */
const raw = {
  sessionStart: { ...common, hook_event_name: "SessionStart", source: "startup" },
  prompt: { ...common, hook_event_name: "UserPromptSubmit", prompt: "use the bash tool to run: whoami" },
  preTool: { ...common, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "whoami" }, tool_use_id: "toolu_01" },
  postTool: { ...common, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "whoami" }, tool_response: { stdout: "MWardill" }, tool_use_id: "toolu_01", duration_ms: 14437 },
  permission: { ...common, hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which colour?" }] } },
  denied: { ...common, hook_event_name: "PermissionDenied", tool_name: "Write" },
  stop: { ...common, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Blue it is", background_tasks: [{ id: "a1", type: "subagent", status: "running" }], session_crons: [] },
  subStart: { ...common, hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "general-purpose" },
  subToolStart: { ...common, hook_event_name: "PreToolUse", agent_id: "a1", agent_type: "general-purpose", tool_name: "Bash", tool_input: { command: "echo sub-ok" }, tool_use_id: "toolu_02" },
  subStop: { ...common, hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "general-purpose", agent_transcript_path: "C:\\x\\agent-a1.jsonl", last_assistant_message: "ok" },
  helperStop: { ...common, hook_event_name: "SubagentStop", agent_id: "h1", agent_type: "", last_assistant_message: "Run whoami bash command" },
  end: { ...common, hook_event_name: "SessionEnd", reason: "prompt_input_exit" },
  mcpTool: { ...common, hook_event_name: "PreToolUse", tool_name: "mcp__atlassian__getJiraIssue", tool_input: { key: "FP-1" }, tool_use_id: "toolu_03" },
  preToolNoId: { ...common, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "whoami" } },
  postToolNoId: { ...common, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "whoami" }, tool_response: { stdout: "MWardill" }, duration_ms: 1 },
  statusLine: { session_id: "e82c9e2a", transcript_path: "C:\\x\\e82c9e2a.jsonl", cwd, session_name: "Run whoami bash command", model: { id: "claude-fable-5", display_name: "Fable 5" }, workspace: { current_dir: cwd, project_dir: cwd }, cost: { total_cost_usd: 1.342142 }, context_window: { used_percentage: 5, remaining_percentage: 95, context_window_size: 1000000 }, rate_limits: { five_hour: { used_percentage: 7 }, seven_day: { used_percentage: 22 } } },
  messageDisplay: { ...common, hook_event_name: "MessageDisplay", delta: "done", final: true },
  notification: { ...common, hook_event_name: "Notification", message: "Claude needs your permission", notification_type: "permission_prompt" },
};

describe("redact", () => {
  it("maps each hook event to its redacted kind with only allowlisted fields", () => {
    expect(redact(raw.sessionStart, ctx)).toMatchObject({ kind: "session.start", source: "startup", v: 1, t: ctx.now, sessionId: "e82c9e2a" });
    expect(redact(raw.prompt, ctx)).toMatchObject({ kind: "prompt" });
    expect(redact(raw.preTool, ctx)).toMatchObject({ kind: "tool.start", tool: "Bash", category: "run", toolUseId: "toolu_01" });
    expect(redact(raw.postTool, ctx)).toMatchObject({ kind: "tool.end", tool: "Bash", toolUseId: "toolu_01", durationMs: 14437 });
    expect(redact(raw.permission, ctx)).toMatchObject({ kind: "permission.request", tool: "AskUserQuestion", category: "other" });
    expect(redact(raw.permission, ctx)).not.toHaveProperty("toolUseId");
    expect(redact(raw.denied, ctx)).toMatchObject({ kind: "permission.denied", tool: "Write" });
    expect(redact(raw.stop, ctx)).toMatchObject({ kind: "stop", backgroundTasks: 1 });
    expect(redact(raw.subStart, ctx)).toMatchObject({ kind: "subagent.start", agentId: "a1", agentType: "general-purpose" });
    expect(redact(raw.subToolStart, ctx)).toMatchObject({ kind: "tool.start", agentId: "a1" });
    expect(redact(raw.subStop, ctx)).toMatchObject({ kind: "subagent.stop", agentId: "a1" });
    expect(redact(raw.end, ctx)).toMatchObject({ kind: "session.end", reason: "prompt_input_exit" });
    expect(redact(raw.mcpTool, ctx)).toMatchObject({ kind: "tool.start", tool: "mcp", category: "other" });
    expect(redact(raw.statusLine, ctx)).toMatchObject({ kind: "status", contextPct: 5, costUsd: 1.342142, rateLimit5h: 7, rateLimit7d: 22, model: "Fable 5" });
  });

  it("drops helper subagents, unmodelled events, disallowed directories and junk", () => {
    expect(redact(raw.helperStop, ctx)).toBeNull();
    expect(redact(raw.messageDisplay, ctx)).toBeNull();
    expect(redact(raw.notification, ctx)).toBeNull();
    expect(redact(raw.preToolNoId, ctx)).toBeNull();
    expect(redact(raw.postToolNoId, ctx)).toBeNull();
    expect(redact(raw.prompt, { ...ctx, allowlist: ["C:\\git"] })).toBeNull();
    expect(redact(raw.statusLine, { ...ctx, allowlist: ["C:\\git"] })).toBeNull();
    expect(redact("nonsense", ctx)).toBeNull();
    expect(redact(null, ctx)).toBeNull();
    expect(redact({ hook_event_name: "Stop" }, ctx)).toBeNull();
  });

  it("never lets a forbidden key or a recorded string survive", () => {
    const secrets = [cwd, "e82c9e2a.jsonl", "whoami", "MWardill", "Which colour?", "Blue it is", "Run whoami bash command", "atlassian"];
    for (const payload of Object.values(raw)) {
      const event = redact(payload, ctx);
      if (!event) continue;
      expect(containsForbidden(event, secrets)).toBeNull();
    }
    expect(FORBIDDEN_KEYS).toEqual(["prompt", "tool_input", "tool_response", "last_assistant_message", "transcript_path", "agent_transcript_path", "session_name", "cwd", "workspace"]);
  });

  it("containsForbidden reports the offending key or string", () => {
    expect(containsForbidden({ a: { prompt: "x" } })).toBe("prompt");
    expect(containsForbidden({ a: ["C:/mw/visualiser"] }, ["C:/mw/visualiser"])).toBe("C:/mw/visualiser");
    expect(containsForbidden({ tool: "Bash" }, ["secret"])).toBeNull();
  });
  it("parses in strip mode, so a raw payload loses its forbidden fields before ingest reads it", () => {
    expect(RawHookSchema.parse(raw.prompt)).not.toHaveProperty("prompt");
    expect(RawHookSchema.parse(raw.stop)).not.toHaveProperty("last_assistant_message");
    expect(RawHookSchema.parse(raw.preTool)).not.toHaveProperty("tool_input");
  });

  it("counts only subagent background tasks and never reads a background shell's command", () => {
    const mixed = {
      ...common,
      hook_event_name: "Stop",
      background_tasks: [
        { id: "a1", type: "subagent", status: "running", description: "Explore the repo", agent_type: "Explore" },
        { id: "b1", type: "shell", status: "running", description: "sleep 40", command: "sleep 40" },
      ],
    };
    expect(redact(mixed, ctx)).toMatchObject({ kind: "stop", backgroundTasks: 1 });
    expect(RawHookSchema.parse(mixed).background_tasks).toEqual([{ type: "subagent" }, { type: "shell" }]);
    expect(redact({ ...mixed, background_tasks: [mixed.background_tasks[1]] }, ctx)).toMatchObject({ kind: "stop", backgroundTasks: 0 });
  });

  it("tolerates a status line with null or missing figures, and rejects one with no figures at all", () => {
    const nulled = { ...raw.statusLine, context_window: { used_percentage: null }, rate_limits: { five_hour: { used_percentage: null }, seven_day: {} } };
    expect(redact(nulled, ctx)).toMatchObject({ kind: "status", costUsd: 1.342142 });
    expect(redact(nulled, ctx)).not.toHaveProperty("contextPct");
    expect(redact(nulled, ctx)).not.toHaveProperty("rateLimit5h");
    const { context_window: _contextWindow, ...noContext } = raw.statusLine;
    expect(redact(noContext, ctx)).toMatchObject({ kind: "status", costUsd: 1.342142 });
    expect(redact({ session_id: "x", cwd }, ctx)).toBeNull();
    expect(redact({ session_id: "x", cwd, workspace: { current_dir: cwd } }, ctx)).toBeNull();
  });
  it("keeps a Stop whose background_tasks carry entries it cannot read", () => {
    const odd = { ...common, hook_event_name: "Stop", background_tasks: [{ type: null }, "junk", { type: "subagent" }] };
    expect(redact(odd, ctx)).toMatchObject({ kind: "stop", backgroundTasks: 1 });
    expect(redact({ ...common, hook_event_name: "Stop", background_tasks: null }, ctx)).toMatchObject({ kind: "stop", backgroundTasks: 0 });
  });

  it("drops every event from an internal helper subagent, not only its start and stop", () => {
    const helper = { ...common, agent_id: "h1", agent_type: "", tool_name: "Bash", tool_use_id: "toolu_09" };
    expect(redact({ ...helper, hook_event_name: "PreToolUse", tool_input: {} }, ctx)).toBeNull();
    expect(redact({ ...helper, hook_event_name: "PostToolUse", duration_ms: 1 }, ctx)).toBeNull();
    expect(redact({ ...helper, hook_event_name: "PermissionRequest" }, ctx)).toBeNull();
  });
});

describe("redactPresence", () => {
  /** One entry of `claude agents --json`, shaped as the spike recorded it. */
  const entry = { pid: 1234, cwd, kind: "interactive", startedAt: "2026-09-12T16:20:00.000Z", sessionId: "e82c9e2a", name: "Run whoami bash command" };

  it("turns an agents-list entry into a presence event on the same pane, keeping no name or path", () => {
    for (const alive of [true, false]) {
      const event = redactPresence(entry, alive, ctx);
      expect(event).toMatchObject({ kind: "presence", alive, v: 1, t: ctx.now, sessionId: "e82c9e2a" });
      expect(event?.paneKey).toBe(redact(raw.prompt, ctx)?.paneKey);
      expect(containsForbidden(event, ["Run whoami bash command", cwd, "interactive"])).toBeNull();
    }
  });

  it("drops entries outside the allowlist and junk", () => {
    expect(redactPresence(entry, true, { ...ctx, allowlist: ["C:\\git"] })).toBeNull();
    expect(redactPresence({ pid: 1234, kind: "interactive" }, true, ctx)).toBeNull();
    expect(redactPresence({ sessionId: "", cwd }, true, ctx)).toBeNull();
    expect(redactPresence("nonsense", true, ctx)).toBeNull();
    expect(redactPresence(null, true, ctx)).toBeNull();
  });

  it("dates a live entry by the later of its transcript's last write and its start", () => {
    const activeAt = (...args: Parameters<typeof redactPresence>): number | undefined => {
      const event = redactPresence(...args);
      return event?.kind === "presence" ? event.lastActiveAt : undefined;
    };
    const started = Date.parse(entry.startedAt);
    expect(activeAt(entry, true, ctx, started + 5_000)).toBe(started + 5_000);
    expect(activeAt(entry, true, ctx, started - 5_000)).toBe(started);
    expect(activeAt(entry, true, ctx)).toBe(started);
    expect(activeAt(entry, true, ctx, null)).toBe(started);
    expect(activeAt({ ...entry, startedAt: started }, true, ctx)).toBe(started);
    // A file's modified time has a fractional part; event times are whole milliseconds.
    expect(activeAt({ ...entry, startedAt: undefined }, true, ctx, started + 0.75)).toBe(started);
  });

  it("keeps an entry whose start cannot be read, and never dates a dead one", () => {
    for (const startedAt of ["yesterday-ish", -5, { at: 1 }]) {
      const event = redactPresence({ ...entry, startedAt }, true, ctx);
      expect(event).toMatchObject({ kind: "presence", alive: true });
      expect(event).not.toHaveProperty("lastActiveAt");
    }
    expect(redactPresence(entry, false, ctx, ctx.now)).not.toHaveProperty("lastActiveAt");
  });
});
