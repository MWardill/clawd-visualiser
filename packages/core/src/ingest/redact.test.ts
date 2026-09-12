import { describe, expect, it } from "vitest";
import { FORBIDDEN_KEYS, containsForbidden, redact } from "./redact";

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
});
