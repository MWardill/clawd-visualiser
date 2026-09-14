import type { TickerDetail } from "../schema/detail";
import type { RedactedEvent } from "../schema/events";
import { TickerEventSchema, type TickerEvent } from "../schema/ticker";
import { subjectOf } from "./detail";
import type { SessionState } from "./session";

/**
 * Zero, one or two ticker lines for an event: the event's own line, then a `state` line when the
 * reducer changed the session's state. This is the only source of ticker lines, so the ticker can
 * never carry more than the redacted event does. Lines are stamped with `now`, the same clock the
 * reducer was given, so a replayed or rescaled event never puts the ticker and the snapshot on
 * different clocks.
 */
export function toTickerEvents(e: RedactedEvent, before: SessionState | null, after: SessionState, now: number = e.t): TickerEvent[] {
  const t = new Date(now).toISOString();
  const lines: TickerEvent[] = [];
  const own = ownLine(e, t);
  if (own) lines.push(own);
  if (before && before.state !== after.state) lines.push({ t, kind: "state", state: after.state });
  return lines.map((l) => TickerEventSchema.parse(l));
}

/** The subject and permission mode a tool or permission line carries, when the event has either. */
function lineDetail(e: RedactedEvent): { detail: TickerDetail } | Record<string, never> {
  const subject = subjectOf(e);
  const permissionMode = e.detail?.permissionMode;
  if (subject === undefined && permissionMode === undefined) return {};
  return { detail: { ...(subject === undefined ? {} : { subject }), ...(permissionMode === undefined ? {} : { permissionMode }) } };
}

function ownLine(e: RedactedEvent, t: string): TickerEvent | null {
  switch (e.kind) {
    case "session.start":
      return { t, kind: "session.start" };
    case "session.end":
      return { t, kind: "session.end", reason: e.reason };
    case "prompt":
      return { t, kind: "prompt" };
    case "tool.start":
      return { t, kind: "tool.start", tool: e.tool, activity: e.category, ...lineDetail(e) };
    case "tool.end":
      return { t, kind: "tool.end", tool: e.tool, activity: e.category, durationMs: e.durationMs, ...lineDetail(e) };
    case "permission.request":
      return { t, kind: "permission", tool: e.tool, ...lineDetail(e) };
    case "permission.denied":
      return { t, kind: "permission", ...(e.tool ? { tool: e.tool } : {}), reason: "denied" };
    case "stop":
      return { t, kind: "stop" };
    case "subagent.start":
      return { t, kind: "subagent.start", agentType: e.agentType };
    case "subagent.stop":
      return { t, kind: "subagent.stop", agentType: e.agentType };
    case "status":
      return e.contextPct === undefined ? null : { t, kind: "context", contextPct: e.contextPct };
    case "presence":
    case "history":
      return null;
    default:
      e satisfies never;
      return null;
  }
}
