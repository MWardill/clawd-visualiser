/**
 * Raw payloads shaped like the ones measured in docs/spike-hooks.md, carrying two marker families.
 * CANARY marks content: it must never reach any sink at any detail level. LOCAL_ONLY marks paths
 * and names: they may reach responses and the stream inside `detail` at the paths level, and never
 * the event log, the alias file, the config or stdout. The session's directory name, `repo`, is the
 * one part of the path the agent keeps at level none, as the pane label.
 */
export const CANARY = "CANARY";
export const LOCAL_ONLY = "LOCALONLY";
/** The allowlisted root the sessions run under. */
export const ALLOWED_ROOT = "C:/work";
export const SESSION_CWD = "C:/work/LOCALONLY-parent/repo";
export const OUTSIDE_CWD = "C:/private/CANARY-elsewhere";

const content = {
  transcript_path: "C:/Users/someone/.claude/projects/CANARY-project/CANARY-transcript.jsonl",
  permission_mode: "default",
  prompt_id: "prompt-1",
  effort: "high",
  prompt: "CANARY prompt: please read the secret file",
  tool_input: {
    file_path: "C:/work/LOCALONLY-parent/repo/src/LOCALONLY-secret.ts",
    command: "cat CANARY-secret",
    prompt: "CANARY agent prompt",
    pattern: "CANARY pattern",
    query: "CANARY query",
    url: "https://example.test/CANARY-path?q=CANARY",
    subagent_type: "general-purpose",
    description: "LOCALONLY description",
    content: "CANARY file content",
  },
  tool_response: { stdout: "CANARY tool output", file: { content: "CANARY file content" } },
  last_assistant_message: "CANARY assistant reply",
  session_name: "LOCALONLY session name",
  agent_transcript_path: "C:/Users/someone/.claude/CANARY-agent.jsonl",
  error: "CANARY error text",
};

export function rawHook(event: string, sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: sessionId, cwd: SESSION_CWD, hook_event_name: event, ...content, ...extra };
}

export function rawStatus(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd: SESSION_CWD,
    transcript_path: content.transcript_path,
    session_name: content.session_name,
    workspace: { current_dir: SESSION_CWD, project_dir: SESSION_CWD },
    model: { id: "claude-opus-5", display_name: "Opus 5" },
    context_window: { used_percentage: 42, remaining_percentage: 58, context_window_size: 200_000 },
    cost: { total_cost_usd: 1.25 },
    rate_limits: { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 20 } },
    version: "2.1.205",
    ...extra,
  };
}

/** One entry of `claude agents --json`, with a session name the agent keeps only at the paths level. */
export function rawAgentEntry(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { pid: 4242, cwd: SESSION_CWD, kind: "interactive", startedAt: 1_757_671_200_000, sessionId, name: content.session_name, ...extra };
}

/** Every modelled hook once, in a plausible order, including an Agent call, both failure hooks and an MCP tool. */
export function rawSessionScript(sessionId: string): Record<string, unknown>[] {
  return [
    rawHook("SessionStart", sessionId, { source: "startup" }),
    rawHook("UserPromptSubmit", sessionId),
    rawHook("PreToolUse", sessionId, { tool_name: "Agent", tool_use_id: "toolu_0" }),
    rawHook("PostToolUse", sessionId, { tool_name: "Agent", tool_use_id: "toolu_0", duration_ms: 30 }),
    rawHook("PreToolUse", sessionId, { tool_name: "Write", tool_use_id: "toolu_1" }),
    rawHook("PermissionRequest", sessionId, { tool_name: "Write" }),
    rawHook("PostToolUse", sessionId, { tool_name: "Write", tool_use_id: "toolu_1", duration_ms: 12 }),
    rawHook("PreToolUse", sessionId, { tool_name: "mcp__CANARY-server__lookup", tool_use_id: "toolu_2" }),
    rawHook("PostToolUseFailure", sessionId, { tool_name: "mcp__CANARY-server__lookup", tool_use_id: "toolu_2" }),
    rawHook("SubagentStart", sessionId, { agent_id: "agent_1", agent_type: "general-purpose" }),
    rawHook("PreToolUse", sessionId, { tool_name: "Read", tool_use_id: "toolu_3", agent_id: "agent_1", agent_type: "general-purpose" }),
    rawHook("SubagentStop", sessionId, { agent_id: "agent_1", agent_type: "general-purpose" }),
    rawHook("Stop", sessionId, {
      stop_hook_active: false,
      background_tasks: [{ id: "b1", type: "shell", status: "running", description: "CANARY shell description", command: "CANARY shell command" }],
    }),
    rawHook("SessionEnd", sessionId, { reason: "prompt_input_exit" }),
  ];
}
