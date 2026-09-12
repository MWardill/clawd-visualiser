import type { RedactedEvent, ToolCategory } from "../schema/events";
import { DEFAULT_CONFIG, type StateConfig } from "../state/config";
import type { Sink, Source } from "./source";

/** The defaults with a short asleep timer, so a demo shows sleeping and departures within a minute or two. */
export const SIMULATED_CONFIG: StateConfig = { ...DEFAULT_CONFIG, asleepAfterMs: 20_000 };

/** mulberry32: small, seedable, good enough for a demo. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Omit that distributes over a union, so each event variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<RedactedEvent, "v" | "t" | "sessionId" | "paneKey">;

type Phase = "unborn" | "working" | "tooling" | "waiting" | "subagent" | "idle" | "gone";
type Sim = {
  id: string;
  paneKey: string;
  phase: Phase;
  nextAt: number;
  toolUseId: string;
  toolName: string;
  toolStartedAt: number;
  toolCategory: ToolCategory;
  agentId: string;
  idleSince: number;
  serial: number;
};

const TOOLS: [string, ToolCategory][] = [["Read", "read"], ["Grep", "read"], ["Edit", "edit"], ["Write", "edit"], ["Bash", "run"], ["WebFetch", "web"]];
const PANES = ["5a1e0000000000a1", "5a1e0000000000b2", "5a1e0000000000c3"];

export type SimulatedFleetOptions = { seed?: number; sessions?: number };

/**
 * A deterministic fleet that emits redacted events, so simulated mode runs the same reducers as
 * live mode. Call `next(now)` with a non-decreasing clock; it returns the events due by then.
 */
export function createSimulatedFleet(opts: SimulatedFleetOptions = {}): { next(now: number): RedactedEvent[] } {
  const random = rng(opts.seed ?? 1);
  const count = opts.sessions ?? 6;
  const between = (lo: number, hi: number): number => lo + random() * (hi - lo);
  let serial = 0;
  const sims: Sim[] = [];
  const fresh = (slot: number, bornAt: number): Sim => ({
    id: `sim-${slot}-${++serial}`,
    paneKey: PANES[slot % PANES.length]!,
    phase: "unborn",
    nextAt: bornAt,
    toolUseId: "",
    toolName: "",
    toolStartedAt: 0,
    toolCategory: "read",
    agentId: "",
    idleSince: 0,
    serial: 0,
  });
  let started = false;

  function emit(s: Sim, now: number, body: EventBody): RedactedEvent {
    return { v: 1, t: now, sessionId: s.id, paneKey: s.paneKey, ...body } as RedactedEvent;
  }

  function step(s: Sim, now: number, out: RedactedEvent[]): void {
    const r = random();
    switch (s.phase) {
      case "unborn":
        out.push(emit(s, now, { kind: "session.start", source: "startup" }), emit(s, now, { kind: "prompt" }));
        s.phase = "working";
        s.nextAt = now + between(800, 2500);
        return;
      case "working": {
        if (r < 0.5) {
          const [tool, category] = TOOLS[Math.floor(random() * TOOLS.length)]!;
          s.toolUseId = `sim-tool-${++s.serial}`;
          s.toolName = tool;
          s.toolStartedAt = now;
          s.toolCategory = category;
          out.push(emit(s, now, { kind: "tool.start", tool, category, toolUseId: s.toolUseId }));
          s.phase = "tooling";
          s.nextAt = now + between(300, 2500);
        } else if (r < 0.62) {
          s.toolUseId = `sim-tool-${++s.serial}`;
          s.toolName = "Write";
          s.toolCategory = "edit";
          out.push(
            emit(s, now, { kind: "tool.start", tool: "Write", category: "edit", toolUseId: s.toolUseId }),
            emit(s, now, { kind: "permission.request", tool: "Write", category: "edit" }),
          );
          s.phase = "waiting";
          s.nextAt = now + between(4000, 9000);
        } else if (r < 0.72) {
          s.agentId = `sim-agent-${++s.serial}`;
          out.push(emit(s, now, { kind: "subagent.start", agentId: s.agentId, agentType: "general-purpose" }));
          s.phase = "subagent";
          s.nextAt = now + between(4000, 8000);
        } else {
          out.push(emit(s, now, { kind: "stop", backgroundTasks: 0 }));
          s.phase = "idle";
          s.idleSince = now;
          s.nextAt = now + between(3000, 8000);
        }
        return;
      }
      case "tooling":
        out.push(emit(s, now, { kind: "tool.end", tool: s.toolName, category: s.toolCategory, toolUseId: s.toolUseId, durationMs: now - s.toolStartedAt }));
        s.phase = "working";
        s.nextAt = now + between(300, 1500);
        return;
      case "waiting":
        out.push(emit(s, now, { kind: "tool.end", tool: "Write", category: "edit", toolUseId: s.toolUseId, durationMs: 40 }));
        s.phase = "working";
        s.nextAt = now + between(500, 1500);
        return;
      case "subagent":
        out.push(emit(s, now, { kind: "subagent.stop", agentId: s.agentId, agentType: "general-purpose" }), emit(s, now, { kind: "prompt" }));
        s.agentId = "";
        s.phase = "working";
        s.nextAt = now + between(500, 1500);
        return;
      case "idle":
        if (r < 0.1) {
          out.push(emit(s, now, { kind: "session.end", reason: "prompt_input_exit" }));
          s.phase = "gone";
          s.nextAt = now + between(10000, 20000);
        } else if (r < 0.4 || now - s.idleSince > SIMULATED_CONFIG.asleepAfterMs + between(5000, 15000)) {
          out.push(emit(s, now, { kind: "prompt" }));
          s.phase = "working";
          s.nextAt = now + between(800, 2500);
        } else {
          s.nextAt = now + between(3000, 8000);
        }
        return;
      case "gone": {
        const slot = sims.indexOf(s);
        sims[slot] = fresh(slot, now);
        return;
      }
      default:
        s.phase satisfies never;
        return;
    }
  }

  return {
    next(now: number): RedactedEvent[] {
      if (!started) {
        started = true;
        for (let i = 0; i < count; i++) sims.push(fresh(i, now + i * between(2500, 5000)));
      }
      const out: RedactedEvent[] = [];
      for (let i = 0; i < sims.length; i++) {
        let guard = 0;
        while (sims[i]!.nextAt <= now && guard++ < 10) step(sims[i]!, now, out);
      }
      return out;
    },
  };
}

export type SimulatedSourceOptions = SimulatedFleetOptions & {
  /** Multiplier on the fleet's pace. Default 1. */
  speed?: number;
  now?: () => number;
  tickMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

/** Wraps the fleet in a timer so it behaves like any other Source. */
export function createSimulatedSource(opts: SimulatedSourceOptions = {}): Source {
  const now = opts.now ?? (() => Date.now());
  const tickMs = opts.tickMs ?? 250;
  const speed = opts.speed ?? 1;
  const setI = opts.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearI = opts.clearInterval ?? ((h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>));
  return {
    start(sink: Sink) {
      const fleet = createSimulatedFleet(opts);
      const origin = now();
      const clock = (): number => origin + (now() - origin) * speed;
      for (const e of fleet.next(clock())) sink(e);
      const handle = setI(() => {
        for (const e of fleet.next(clock())) sink(e);
      }, tickMs);
      return () => clearI(handle);
    },
  };
}
