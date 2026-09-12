// One ticker line per event, coloured for xterm.js. The only strings are the fields TickerEvent
// carries: a kind, an activity, a tool name, a subagent type, a state, a reason. Nothing else exists to show.
import type { Activity, SessionPhase, TickerEvent } from "@clawd/core";
import { hhmmss } from "../time";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;
const paint = (code: string, s: string): string => `${ESC}${code}m${s}${RESET}`;
const dim = (s: string): string => paint("2", s);

/** ANSI codes by activity; the terminal theme binds red to Clawd orange for spawn. */
const ACTIVITY_CODES: Record<Activity, string> = { read: "34", edit: "32", run: "33", web: "35", spawn: "31", think: "2", other: "2" };
const STATE_CODES: Record<SessionPhase, string> = { working: "32", waiting: "33", idle: "2", asleep: "34", done: "35" };

const KIND_WIDTH = 14;

export function formatTicker(e: TickerEvent): string {
  const time = dim(hhmmss(e.t));
  const kind = e.kind.padEnd(KIND_WIDTH);
  switch (e.kind) {
    case "tool.start":
    case "tool.end":
    case "permission": {
      const parts = [time, e.kind === "permission" ? paint("33", kind) : kind];
      if (e.activity) parts.push(paint(ACTIVITY_CODES[e.activity], e.activity.padEnd(5)));
      if (e.tool) parts.push(e.tool.padEnd(12));
      if (e.durationMs !== undefined) parts.push(dim(`${Math.round(e.durationMs)}ms`));
      return parts.join(" ").trimEnd();
    }
    case "state":
      return `${time} ${kind} ${e.state ? paint(STATE_CODES[e.state], e.state) : ""}`.trimEnd();
    case "subagent.start":
    case "subagent.stop":
      return `${time} ${kind} ${e.agentType ?? ""}`.trimEnd();
    case "context":
      return `${time} ${kind} ${e.contextPct !== undefined ? `${e.contextPct}%` : ""}`.trimEnd();
    case "session.end":
      return `${time} ${kind} ${e.reason ?? ""}`.trimEnd();
    case "session.start":
    case "prompt":
    case "stop":
      return `${time} ${kind}`.trimEnd();
    default:
      e.kind satisfies never;
      return `${time} ${String(e.kind)}`;
  }
}

/** Removes the colour sequences; for tests and for plain-text fallbacks. */
export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}
