import type { RedactedEvent } from "../schema/events";
import type { Activity, SessionPhase } from "../schema/snapshot";
import type { StateConfig } from "./config";

export type SessionState = {
  sessionId: string;
  paneKey: string;
  state: SessionPhase;
  activity: Activity | null;
  /** When `state` began. */
  since: number;
  lastEventAt: number;
  /** toolUseId of the pending permission while waiting. */
  waitingOn: string | null;
  /** toolUseId of the most recent tool.start on the parent (not a subagent). */
  currentToolUseId: string | null;
  backgroundTasks: number;
  /** Live subagent ids. An array, not a Set, so state is JSON-serialisable and comparable. */
  subagents: string[];
  contextPct: number | null;
  errorFlag: boolean;
  /** The previous state, shown until `until` so quick flips do not flicker. */
  displayHold: { state: SessionPhase; until: number } | null;
};

export function newSession(sessionId: string, paneKey: string, now: number): SessionState {
  return {
    sessionId,
    paneKey,
    state: "idle",
    activity: null,
    since: now,
    lastEventAt: now,
    waitingOn: null,
    currentToolUseId: null,
    backgroundTasks: 0,
    subagents: [],
    contextPct: null,
    errorFlag: false,
    displayHold: null,
  };
}

function transition(s: SessionState, to: SessionPhase, now: number, cfg: StateConfig): SessionState {
  if (s.state === to) return s;
  return { ...s, state: to, since: now, displayHold: { state: s.state, until: now + cfg.minDisplayMs } };
}

const busy = (s: SessionState): boolean => s.backgroundTasks > 0 || s.subagents.length > 0;
const resting = (s: SessionState): boolean => s.state === "idle" || s.state === "asleep";

/** Pure: applies one event to one session. `now` is the event time. */
export function reduceSession(prev: SessionState, e: RedactedEvent, now: number, cfg: StateConfig): SessionState {
  if (prev.state === "done") return prev;
  let s: SessionState = { ...prev, lastEventAt: now };
  switch (e.kind) {
    case "session.start":
      return s;
    case "session.end":
      return transition({ ...s, activity: null, waitingOn: null }, "done", now, cfg);
    case "presence":
      return e.alive ? s : transition({ ...s, activity: null, waitingOn: null }, "done", now, cfg);
    case "prompt":
      return transition({ ...s, activity: "think", waitingOn: null }, "working", now, cfg);
    case "tool.start":
      s = e.agentId ? { ...s, activity: "spawn" } : { ...s, activity: e.category, currentToolUseId: e.toolUseId };
      return resting(s) ? transition(s, "working", now, cfg) : s;
    case "tool.end":
      if (s.state === "waiting" && s.waitingOn === e.toolUseId) s = transition({ ...s, waitingOn: null }, "working", now, cfg);
      return { ...s, activity: e.agentId || busy(s) ? "spawn" : "think" };
    case "permission.request":
      if (s.state === "working" || s.state === "idle") return transition({ ...s, waitingOn: e.toolUseId ?? s.currentToolUseId }, "waiting", now, cfg);
      return s;
    case "permission.denied":
      return s.state === "waiting" ? transition({ ...s, waitingOn: null, activity: "think" }, "working", now, cfg) : s;
    case "stop":
      s = { ...s, backgroundTasks: e.backgroundTasks };
      if (s.state !== "working") return s;
      if (busy(s)) return { ...s, activity: "spawn" };
      return transition({ ...s, activity: null, currentToolUseId: null }, "idle", now, cfg);
    case "subagent.start": {
      const subagents = s.subagents.includes(e.agentId) ? s.subagents : [...s.subagents, e.agentId];
      return { ...s, subagents, activity: s.state === "working" ? "spawn" : s.activity };
    }
    case "subagent.stop":
      return { ...s, subagents: s.subagents.filter((id) => id !== e.agentId) };
    case "status":
      return e.contextPct === undefined ? s : { ...s, contextPct: e.contextPct };
    default:
      return s;
  }
}

/** Pure: applies the passage of time. Called by the host on an interval. */
export function tickSession(s: SessionState, now: number, cfg: StateConfig): SessionState {
  if (s.state === "idle" && now - s.since >= cfg.asleepAfterMs) return transition(s, "asleep", now, cfg);
  return s;
}
