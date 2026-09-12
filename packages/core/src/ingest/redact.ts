import { paneKey } from "../alias/pane";
import { EVENT_SCHEMA_VERSION, RedactedEventSchema, type RedactedEvent } from "../schema/events";
import { RawAgentEntrySchema, RawHookSchema, RawStatusLineSchema, type RawHook, type RawStatusLine } from "../schema/raw";
import { isAllowed } from "./allowlist";
import { categoryFor, normaliseTool } from "./categories";

export type IngestContext = { now: number; allowlist: readonly string[] };

/** Payload fields that must never survive ingest. Tested against every fixture. */
export const FORBIDDEN_KEYS = [
  "prompt",
  "tool_input",
  "tool_response",
  "last_assistant_message",
  "transcript_path",
  "agent_transcript_path",
  "session_name",
  "cwd",
  "workspace",
] as const;

/**
 * Turn a raw hook or status line payload into a redacted event, or null when the payload is not
 * ours to keep: outside the allowlist, an internal helper subagent, an unmodelled event, or junk.
 */
export function redact(raw: unknown, ctx: IngestContext): RedactedEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const hook = RawHookSchema.safeParse(raw);
  if (hook.success) return redactHook(hook.data, ctx);
  const status = RawStatusLineSchema.safeParse(raw);
  if (status.success && isStatusLine(status.data)) return redactStatus(status.data, ctx);
  return null;
}

/**
 * The envelope alone is not a status line: after stripping, a payload must still carry at least
 * one figure we read, or it is some other shape we do not model.
 */
function isStatusLine(p: RawStatusLine): boolean {
  return p.context_window !== undefined || p.cost !== undefined || p.rate_limits !== undefined || p.model !== undefined;
}

/**
 * Turn one entry of an agents-list poll into a presence event. `alive` is the poller's verdict:
 * true for an entry in the latest poll, false for a session that has dropped out of it.
 */
export function redactPresence(entry: unknown, alive: boolean, ctx: IngestContext): RedactedEvent | null {
  const parsed = RawAgentEntrySchema.safeParse(entry);
  if (!parsed.success) return null;
  const base = envelope(parsed.data.sessionId, parsed.data.cwd, ctx);
  return base && validate({ ...base, kind: "presence", alive });
}

/** The fields every redacted event carries, or null when the directory is outside the allowlist. */
function envelope(sessionId: string, cwd: string, ctx: IngestContext): { v: typeof EVENT_SCHEMA_VERSION; t: number; sessionId: string; paneKey: string } | null {
  if (!isAllowed(cwd, ctx.allowlist)) return null;
  return { v: EVENT_SCHEMA_VERSION, t: ctx.now, sessionId, paneKey: paneKey(cwd) };
}

function validate(event: unknown): RedactedEvent | null {
  const parsed = RedactedEventSchema.safeParse(event);
  return parsed.success ? parsed.data : null;
}

function redactHook(p: RawHook, ctx: IngestContext): RedactedEvent | null {
  // Internal helpers (the session-naming helper) have an empty agent_type. Nothing of theirs is ours.
  if (p.agent_id && !p.agent_type) return null;
  const env = envelope(p.session_id, p.cwd, ctx);
  if (!env) return null;
  const base = { ...env, ...(p.agent_id ? { agentId: p.agent_id } : {}) };
  const rawTool = p.tool_name ?? "unknown";
  const toolFields = { tool: normaliseTool(rawTool), category: categoryFor(rawTool) };
  switch (p.hook_event_name) {
    case "SessionStart":
      return validate({ ...base, kind: "session.start", ...(p.source ? { source: p.source } : {}) });
    case "SessionEnd":
      return validate({ ...base, kind: "session.end", reason: p.reason ?? "unknown" });
    case "UserPromptSubmit":
      return validate({ ...base, kind: "prompt" });
    case "PreToolUse":
      if (!p.tool_use_id) return null;
      return validate({ ...base, kind: "tool.start", ...toolFields, toolUseId: p.tool_use_id });
    case "PostToolUse":
      if (!p.tool_use_id) return null;
      return validate({ ...base, kind: "tool.end", ...toolFields, toolUseId: p.tool_use_id, durationMs: Math.max(0, p.duration_ms ?? 0) });
    case "PermissionRequest":
      return validate({ ...base, kind: "permission.request", ...toolFields, ...(p.tool_use_id ? { toolUseId: p.tool_use_id } : {}) });
    case "PermissionDenied":
      return validate({ ...base, kind: "permission.denied", ...(p.tool_name ? { tool: normaliseTool(p.tool_name) } : {}) });
    case "Stop":
      // Only subagents count: a background shell is the user's own long-running command, not work
      // the session is waiting on, so a session with one reads idle.
      return validate({ ...base, kind: "stop", backgroundTasks: (p.background_tasks ?? []).filter((t) => t.type === "subagent").length });
    case "SubagentStart":
    case "SubagentStop":
      if (!p.agent_id) return null;
      return validate({ ...base, agentId: p.agent_id, kind: p.hook_event_name === "SubagentStart" ? "subagent.start" : "subagent.stop", agentType: p.agent_type });
    default:
      return null;
  }
}

function redactStatus(p: RawStatusLine, ctx: IngestContext): RedactedEvent | null {
  const base = envelope(p.session_id, p.cwd, ctx);
  if (!base) return null;
  const pct = (v: number | null | undefined): number | undefined => (typeof v === "number" ? Math.min(100, Math.max(0, v)) : undefined);
  const contextPct = pct(p.context_window?.used_percentage);
  const costUsd = p.cost?.total_cost_usd;
  const rateLimit5h = pct(p.rate_limits?.five_hour?.used_percentage);
  const rateLimit7d = pct(p.rate_limits?.seven_day?.used_percentage);
  const model = p.model?.display_name;
  return validate({
    ...base,
    kind: "status",
    ...(contextPct !== undefined ? { contextPct } : {}),
    ...(typeof costUsd === "number" ? { costUsd: Math.max(0, costUsd) } : {}),
    ...(rateLimit5h !== undefined ? { rateLimit5h } : {}),
    ...(rateLimit7d !== undefined ? { rateLimit7d } : {}),
    ...(model ? { model } : {}),
  });
}

/**
 * Walk any value; return the first forbidden key name found, or the first extra string found
 * inside any string value, or null. Used by the redaction tests and by the agent's self-check.
 */
export function containsForbidden(value: unknown, extraStrings: readonly string[] = []): string | null {
  if (typeof value === "string") {
    for (const s of extraStrings) if (s && value.includes(s)) return s;
    return null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = containsForbidden(v, extraStrings);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if ((FORBIDDEN_KEYS as readonly string[]).includes(k)) return k;
      const hit = containsForbidden(v, extraStrings);
      if (hit) return hit;
    }
  }
  return null;
}
