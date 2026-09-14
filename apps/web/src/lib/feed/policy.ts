// Which feed to run, as a pure reducer with effects, so the fallback rules are testable without
// timers. The hook runs the effects: probes, feed starts, and the two timers. The grace timer
// starts once, when the stream first drops -- either it never opens after a successful probe, or
// it goes from connected to disconnected -- and is not restarted by the reconnect errors a
// browser keeps firing every few seconds while it stays down.
//
//   probing --probe ok--> live --stream down for GRACE_MS--> simulated (lost-agent)
//      +--probe fails--> simulated (no-agent) --re-probe every REPROBE_MS, ok--> live
import type { DetailLevel } from "@clawd/core";
import type { FeedStatus, SimulatedReason } from "./types";

export type SourceMode = "auto" | "simulated" | "live";
export type PolicyPhase = "probing" | "live" | "simulated";

export type PolicyState = {
  mode: SourceMode;
  phase: PolicyPhase;
  connected: boolean;
  rejected: number;
  reason: SimulatedReason | null;
  /** The agent's detail level from the last successful probe; none until one answers. */
  detail: DetailLevel;
};

export type PolicyEvent =
  | { type: "start" }
  | { type: "probe"; ok: boolean; detail?: DetailLevel }
  | { type: "connection"; connected: boolean; rejected: number }
  | { type: "grace-elapsed" }
  | { type: "reprobe-due" };

export type Effect = "probe" | "start-live" | "start-simulated" | "schedule-reprobe" | "schedule-grace" | "cancel-grace";

/** How often simulated mode looks for an agent. */
export const REPROBE_MS = 10_000;
/** How long a live stream may stay down before the app falls back. */
export const GRACE_MS = 10_000;

/** `?source=simulated` forces the simulation with no probing; `?source=live` disables the fallback. */
export function parseSourceMode(search: string): SourceMode {
  const value = new URLSearchParams(search).get("source");
  return value === "simulated" || value === "live" ? value : "auto";
}

export function initialPolicy(mode: SourceMode): PolicyState {
  return { mode, phase: "probing", connected: false, rejected: 0, reason: null, detail: "none" };
}

const none: Effect[] = [];

export function reducePolicy(s: PolicyState, e: PolicyEvent): { state: PolicyState; effects: Effect[] } {
  switch (e.type) {
    case "start":
      if (s.mode === "simulated") return { state: { ...s, phase: "simulated", reason: "forced" }, effects: ["start-simulated"] };
      if (s.mode === "live") return { state: { ...s, phase: "live", connected: false }, effects: ["start-live"] };
      return { state: { ...s, phase: "probing" }, effects: ["probe"] };
    case "probe":
      if (s.mode !== "auto" || s.phase === "live") return { state: s, effects: none };
      if (e.ok) return { state: { ...s, phase: "live", connected: false, rejected: 0, reason: null, detail: e.detail ?? "none" }, effects: ["start-live", "schedule-grace"] };
      if (s.phase === "probing") return { state: { ...s, phase: "simulated", reason: "no-agent" }, effects: ["start-simulated", "schedule-reprobe"] };
      return { state: s, effects: ["schedule-reprobe"] };
    case "reprobe-due":
      return s.mode === "auto" && s.phase === "simulated" ? { state: s, effects: ["probe"] } : { state: s, effects: none };
    case "connection":
      if (s.phase !== "live") return { state: s, effects: none };
      if (e.connected) return { state: { ...s, connected: true, rejected: e.rejected }, effects: ["cancel-grace"] };
      return { state: { ...s, connected: false, rejected: e.rejected }, effects: s.mode === "auto" && s.connected ? ["schedule-grace"] : none };
    case "grace-elapsed":
      if (s.mode !== "auto" || s.phase !== "live" || s.connected) return { state: s, effects: none };
      return { state: { ...s, phase: "simulated", reason: "lost-agent", connected: false }, effects: ["start-simulated", "schedule-reprobe"] };
    default:
      e satisfies never;
      return { state: s, effects: none };
  }
}

export function toFeedStatus(s: PolicyState, agentUrl: string): FeedStatus {
  switch (s.phase) {
    case "probing":
      return { mode: "probing" };
    case "live":
      return { mode: "live", agentUrl, connected: s.connected, rejected: s.rejected, detail: s.detail };
    case "simulated":
      return { mode: "simulated", reason: s.reason ?? "no-agent" };
    default:
      s.phase satisfies never;
      return { mode: "probing" };
  }
}
