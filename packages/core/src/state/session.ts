import type { RedactedEvent, ToolCategory } from "../schema/events";
import type { Activity, SessionPhase } from "../schema/snapshot";
import type { StateConfig } from "./config";

export type InFlightTool = { toolUseId: string; tool: string; category: ToolCategory };

export type SessionState = {
  sessionId: string;
  paneKey: string;
  state: SessionPhase;
  activity: Activity | null;
  /** When `state` began. */
  since: number;
  lastEventAt: number;
  /** toolUseId of the pending permission while waiting, when one could be resolved. */
  waitingOn: string | null;
  /** The subagent whose permission request is pending, or null when it is the parent's own. */
  waitingAgent: string | null;
  /** Parent tool calls started and not yet ended, oldest first. Subagent calls are not tracked. */
  inFlight: InFlightTool[];
  backgroundTasks: number;
  /** Live subagent ids. An array, not a Set, so state is JSON-serialisable and comparable. */
  subagents: string[];
  contextPct: number | null;
  /** Typed prompts: one per prompt event, raised to the transcript's count by a `history` event. */
  prompts: number;
  /** When the session last did something: a prompt, a tool call, a permission request or denial, a stop, a subagent change. A `history` event sets it to the transcript's last write. */
  lastActiveAt: number;
  /** When the session was first seen. Never changes; the snapshot's sort key. */
  firstSeenAt: number;
  /** What was shown before the last transition, held until `until` so quick flips do not flicker. */
  displayHold: { state: SessionPhase; activity: Activity | null; until: number } | null;
};

/** `since` is when the session went idle, for one that was already quiet when first seen; never later than `now`. */
export function newSession(sessionId: string, paneKey: string, now: number, since: number = now): SessionState {
  return {
    sessionId,
    paneKey,
    state: "idle",
    activity: null,
    since: Math.min(since, now),
    lastEventAt: now,
    waitingOn: null,
    waitingAgent: null,
    inFlight: [],
    backgroundTasks: 0,
    subagents: [],
    contextPct: null,
    prompts: 0,
    lastActiveAt: Math.min(since, now),
    firstSeenAt: now,
    displayHold: null,
  };
}

function transition(s: SessionState, to: SessionPhase, now: number, cfg: StateConfig): SessionState {
  if (s.state === to) return s;
  // A hold still running is kept, so a burst of transitions shows one state per minDisplayMs
  // rather than a phantom hold of whichever transient state came last.
  const displayHold = s.displayHold && now < s.displayHold.until ? s.displayHold : { state: s.state, activity: s.activity, until: now + cfg.minDisplayMs };
  return { ...s, state: to, since: now, displayHold };
}

const busy = (s: SessionState): boolean => s.backgroundTasks > 0 || s.subagents.length > 0;
const resting = (s: SessionState): boolean => s.state === "idle" || s.state === "asleep";
/** What a working session is doing: its newest parent tool, else spawning while subagents run, else thinking. */
const activityOf = (s: SessionState, spawning = false): Activity => s.inFlight.at(-1)?.category ?? (spawning || busy(s) ? "spawn" : "think");
/** Re-derive activity for a working session; resting and waiting ones keep what they have. */
const settle = (s: SessionState, spawning = false): SessionState => (s.state === "working" ? { ...s, activity: activityOf(s, spawning) } : s);
const endWait = (s: SessionState): SessionState => ({ ...s, waitingOn: null, waitingAgent: null });
const rest = (s: SessionState): SessionState => ({ ...endWait(s), activity: null });

/** Events that mean the session did something. A start, an end, a presence poll or a status line does not. */
const ACTIVE = new Set<RedactedEvent["kind"]>(["prompt", "tool.start", "tool.end", "permission.request", "permission.denied", "stop", "subagent.start", "subagent.stop"]);

/** Pure: applies one event to one session. `now` is the event time. */
export function reduceSession(prev: SessionState, e: RedactedEvent, now: number, cfg: StateConfig): SessionState {
  if (prev.state === "done") return prev;
  // A transcript read is not something the session did, so lastEventAt and the state stay as they are.
  // Its count only ever raises the session's. Its last write replaces lastActiveAt: that corrects a
  // session first seen without one, such as a presence replayed from a log written before presence
  // carried a last-active time, which would otherwise date the session from when it was noticed.
  if (e.kind === "history") return { ...prev, prompts: Math.max(prev.prompts, e.prompts), lastActiveAt: e.lastActiveAt };
  let s: SessionState = { ...prev, lastEventAt: now, ...(ACTIVE.has(e.kind) ? { lastActiveAt: Math.max(prev.lastActiveAt, now) } : {}) };
  switch (e.kind) {
    case "session.start":
      return s;
    case "session.end":
      return rest(transition(s, "done", now, cfg));
    case "presence":
      return e.alive ? s : rest(transition(s, "done", now, cfg));
    case "prompt":
      return settle(transition(endWait({ ...s, prompts: s.prompts + 1 }), "working", now, cfg));
    case "tool.start": {
      if (e.agentId) {
        s = resting(s) ? transition(s, "working", now, cfg) : s;
        return { ...s, activity: activityOf(s, true) };
      }
      const others = s.inFlight.filter((t) => t.toolUseId !== e.toolUseId);
      s = { ...s, inFlight: [...others, { toolUseId: e.toolUseId, tool: e.tool, category: e.category }] };
      s = resting(s) ? transition(s, "working", now, cfg) : s;
      return { ...s, activity: activityOf(s) };
    }
    case "tool.end": {
      if (!e.agentId) s = { ...s, inFlight: s.inFlight.filter((t) => t.toolUseId !== e.toolUseId) };
      // A wait with no resolved id ends when a tool from the same origin finishes: the parent's
      // own tool for the parent's request, the subagent's tool for a request raised inside it.
      const sameOrigin = (e.agentId ?? null) === s.waitingAgent;
      if (s.state === "waiting" && ((s.waitingOn === null && sameOrigin) || s.waitingOn === e.toolUseId)) {
        s = transition(endWait(s), "working", now, cfg);
      }
      return settle(s, Boolean(e.agentId));
    }
    case "permission.request": {
      if (s.state === "waiting") return s;
      // Subagent calls are not tracked, so a request raised inside one has nothing to match against.
      if (e.agentId) return transition({ ...s, waitingOn: e.toolUseId ?? null, waitingAgent: e.agentId }, "waiting", now, cfg);
      // PermissionRequest carries no tool_use_id, so match the newest in-flight call of the same
      // tool, else the newest call of any tool, else wait with no id at all.
      let sameTool: InFlightTool | undefined;
      for (let i = s.inFlight.length - 1; i >= 0 && !sameTool; i--) if (s.inFlight[i]?.tool === e.tool) sameTool = s.inFlight[i];
      const waitingOn = e.toolUseId ?? sameTool?.toolUseId ?? s.inFlight.at(-1)?.toolUseId ?? null;
      return transition({ ...s, waitingOn, waitingAgent: null }, "waiting", now, cfg);
    }
    case "permission.denied": {
      if (s.state !== "waiting") return s;
      // The denied call will not run, so it is no longer in flight.
      s = { ...s, inFlight: s.inFlight.filter((t) => t.toolUseId !== s.waitingOn) };
      return settle(transition(endWait(s), "working", now, cfg));
    }
    case "stop": {
      // Claude Code's own background_tasks is authoritative: zero means no subagent is live,
      // whatever we tracked (a lost SubagentStop must not wedge the parent on spawn).
      s = { ...s, backgroundTasks: e.backgroundTasks, subagents: e.backgroundTasks === 0 ? [] : s.subagents, inFlight: [] };
      if (s.state !== "working" && s.state !== "waiting") return s;
      if (busy(s)) return settle(transition(endWait(s), "working", now, cfg));
      return rest(transition(s, "idle", now, cfg));
    }
    case "subagent.start": {
      const subagents = s.subagents.includes(e.agentId) ? s.subagents : [...s.subagents, e.agentId];
      return settle({ ...s, subagents });
    }
    case "subagent.stop":
      // The stop's count is reconciled one subagent at a time, so the last one to finish clears it.
      return settle({ ...s, subagents: s.subagents.filter((id) => id !== e.agentId), backgroundTasks: Math.max(0, s.backgroundTasks - 1) });
    case "status":
      return e.contextPct === undefined ? s : { ...s, contextPct: e.contextPct };
    default:
      e satisfies never;
      return s;
  }
}

/** Pure: applies the passage of time. Called by the host on an interval. */
export function tickSession(s: SessionState, now: number, cfg: StateConfig): SessionState {
  if (s.state === "idle" && now - s.since >= cfg.asleepAfterMs) return transition(s, "asleep", now, cfg);
  // A Stop that never came (an interrupt, a lost hook): a long-quiet working session is not working.
  if (s.state === "working" && now - s.lastEventAt >= cfg.staleWorkingMs) return { ...rest(transition(s, "idle", now, cfg)), inFlight: [] };
  return s;
}
