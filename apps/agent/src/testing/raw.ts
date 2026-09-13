/**
 * Raw payloads shaped like the ones measured in docs/spike-hooks.md. Every field that must never
 * survive ingest carries the canary marker, and so does the parent of the session's directory, so a
 * test can assert that no sink ever contains the marker. The directory's own name, `repo`, is the
 * one part of the path the agent keeps, as the pane label.
 */
export const CANARY = "CANARY";
/** The allowlisted root the canary sessions run under. */
export const ALLOWED_ROOT = "C:/work";
export const CANARY_CWD = "C:/work/CANARY-parent/repo";
export const OUTSIDE_CWD = "C:/private/CANARY-elsewhere";

const content = {
  transcript_path: "C:/Users/someone/.claude/projects/CANARY-project/CANARY-transcript.jsonl",
  permission_mode: "default",
  prompt_id: "prompt-1",
  effort: "high",
  prompt: "CANARY prompt: please read the secret file",
  tool_input: { file_path: "C:/work/CANARY-repo/CANARY-secret.ts", command: "cat CANARY-secret" },
  tool_response: { stdout: "CANARY tool output", file: { content: "CANARY file content" } },
  last_assistant_message: "CANARY assistant reply",
  session_name: "CANARY session name",
  agent_transcript_path: "C:/Users/someone/.claude/CANARY-agent.jsonl",
  error: "CANARY error text",
};

export function rawHook(event: string, sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: sessionId, cwd: CANARY_CWD, hook_event_name: event, ...content, ...extra };
}

export function rawStatus(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd: CANARY_CWD,
    transcript_path: content.transcript_path,
    session_name: content.session_name,
    workspace: { current_dir: CANARY_CWD, project_dir: CANARY_CWD },
    model: { id: "claude-opus-5", display_name: "Opus 5" },
    context_window: { used_percentage: 42, remaining_percentage: 58, context_window_size: 200_000 },
    cost: { total_cost_usd: 1.25 },
    rate_limits: { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 20 } },
    version: "2.1.205",
    ...extra,
  };
}

/** One entry of `claude agents --json`, with the session name the agent must never keep. */
export function rawAgentEntry(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { pid: 4242, cwd: CANARY_CWD, kind: "interactive", startedAt: 1_757_671_200_000, sessionId, name: "CANARY session name", ...extra };
}

/** Every modelled hook once, in a plausible order, including both failure hooks and an MCP tool. */
export function rawSessionScript(sessionId: string): Record<string, unknown>[] {
  return [
    rawHook("SessionStart", sessionId, { source: "startup" }),
    rawHook("UserPromptSubmit", sessionId),
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
