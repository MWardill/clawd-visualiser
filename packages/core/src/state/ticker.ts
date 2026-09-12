import type { RedactedEvent } from "../schema/events";
import { TickerEventSchema, type TickerEvent } from "../schema/ticker";
import type { SessionState } from "./session";

/**
 * Zero, one or two ticker lines for an event: the event's own line, then a `state` line when the
 * reducer changed the session's state. This is the only source of ticker lines, so the ticker can
 * never carry more than the redacted event does.
 */
export function toTickerEvents(e: RedactedEvent, before: SessionState | null, after: SessionState): TickerEvent[] {
  const t = new Date(e.t).toISOString();
  const lines: TickerEvent[] = [];
  const own = ownLine(e, t);
  if (own) lines.push(own);
  if (before && before.state !== after.state) lines.push({ t, kind: "state", state: after.state });
  return lines.map((l) => TickerEventSchema.parse(l));
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
      return { t, kind: "tool.start", tool: e.tool, activity: e.category };
    case "tool.end":
      return { t, kind: "tool.end", tool: e.tool, activity: e.category, durationMs: e.durationMs };
    case "permission.request":
      return { t, kind: "permission", tool: e.tool };
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
      return null;
    default:
      return null;
  }
}
