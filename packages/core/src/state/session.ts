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
  /** Parent tool calls started and not yet ended, oldest first. Subagent calls are not tracked. */
  inFlight: { toolUseId: string; tool: string }[];
  backgroundTasks: number;
  /** Live subagent ids. An array, not a Set, so state is JSON-serialisable and comparable. */
  subagents: string[];
  contextPct: number | null;
  /** When the session was first seen. Never changes; the snapshot's sort key. */
  firstSeenAt: number;
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
    inFlight: [],
    backgroundTasks: 0,
    subagents: [],
    contextPct: null,
    firstSeenAt: now,
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
    case "tool.start": {
      if (e.agentId) {
        s = { ...s, activity: "spawn" };
      } else {
        const others = s.inFlight.filter((t) => t.toolUseId !== e.toolUseId);
        s = { ...s, activity: e.category, inFlight: [...others, { toolUseId: e.toolUseId, tool: e.tool }] };
      }
      return resting(s) ? transition(s, "working", now, cfg) : s;
    }
    case "tool.end": {
      if (!e.agentId) s = { ...s, inFlight: s.inFlight.filter((t) => t.toolUseId !== e.toolUseId) };
      // A wait with no resolved id is ended by any parent tool finishing: the id was never known.
      if (s.state === "waiting" && ((!e.agentId && s.waitingOn === null) || s.waitingOn === e.toolUseId)) {
        s = transition({ ...s, waitingOn: null }, "working", now, cfg);
      }
      return s.state === "working" ? { ...s, activity: e.agentId || busy(s) ? "spawn" : "think" } : s;
    }
    case "permission.request": {
      if (s.state === "waiting") return s;
      // PermissionRequest carries no tool_use_id, so match the newest in-flight call of the same
      // tool, else the newest call of any tool, else wait with no id at all.
      const sameTool = [...s.inFlight].reverse().find((t) => t.tool === e.tool);
      const waitingOn = e.toolUseId ?? sameTool?.toolUseId ?? s.inFlight.at(-1)?.toolUseId ?? null;
      return transition({ ...s, waitingOn }, "waiting", now, cfg);
    }
    case "permission.denied":
      return s.state === "waiting" ? transition({ ...s, waitingOn: null, activity: "think" }, "working", now, cfg) : s;
    case "stop": {
      // Claude Code's own background_tasks is authoritative: zero means no subagent is live,
      // whatever we tracked (a lost SubagentStop must not wedge the parent on spawn).
      s = { ...s, backgroundTasks: e.backgroundTasks, subagents: e.backgroundTasks === 0 ? [] : s.subagents, inFlight: [] };
      if (s.state !== "working" && s.state !== "waiting") return s;
      if (busy(s)) return transition({ ...s, waitingOn: null, activity: "spawn" }, "working", now, cfg);
      return transition({ ...s, activity: null, waitingOn: null }, "idle", now, cfg);
    }
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
