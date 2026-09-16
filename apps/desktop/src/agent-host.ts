// The agent host: runs the agent inside the main process and keeps it running. It owns the agent
// when the port is free, attaches to one already serving it (the CLI's, say) and takes over when
// that one stops answering, restarts after faults with a backoff, and gives up after too many.
// Electron-free, so every transition is tested.
import { ConfigError, PortInUseError, type LogFields, type Logger, type RunningAgent } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import { countsOf, type Counts } from "./agent-client";
import { settleWithin } from "./quit";

export type HostMode = "starting" | "own" | "attached" | "restarting" | "failed";

export type HostState = {
  mode: HostMode;
  /** The port of the agent in use, the app's own or the one attached to; null until one is known. */
  port: number | null;
  sessions: number;
  waiting: number;
  /** A ConfigError's message, which names a field and never a value. Shown, never logged. */
  error: string | null;
};

export type AgentHostDeps = {
  /** Starts an agent in this process. Main passes startAgent with the home and the logger. */
  start(onSnapshot: (s: Snapshot) => void): Promise<RunningAgent>;
  /** Whether an agent's health endpoint on the port answers in time. Never rejects. */
  probe(port: number): Promise<boolean>;
  /** The session counts of the agent on the port, or null. Never rejects. */
  counts(port: number): Promise<Counts | null>;
  log: Logger;
  onChange?(state: HostState): void;
  now?(): number;
};

export type AgentHost = {
  state(): HostState;
  /** Begins starting. Call once, after `ready`; later calls do nothing. */
  start(): void;
  /** An uncaught error reached main. Restarts the agent when the app owns it. */
  fault(): void;
  /** From failed, starts again with the fault history cleared. */
  retry(): void;
  /** The user changed the config: stop the agent the app owns and start one that reads it. */
  restart(): void;
  /** Stops for good: cancels any wait and stops the agent the app owns. */
  stop(): Promise<void>;
};

export const ATTACHED_POLL_MS = 10_000;
export const FAULT_WINDOW_MS = 300_000;
/** The wait before restarting, by how many faults the window already held. A fault finding all five used fails. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
/** How long a faulted agent gets to stop before the host moves on without it. */
const AGENT_STOP_CAP_MS = 5_000;

export function createAgentHost(deps: AgentHostDeps): AgentHost {
  const now = deps.now ?? (() => Date.now());
  let state: HostState = { mode: "starting", port: null, sessions: 0, waiting: 0, error: null };
  let agent: RunningAgent | null = null;
  let faults: number[] = [];
  /** Which start is current, so snapshots from an agent already replaced are ignored. */
  let run = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let work: Promise<void> = Promise.resolve();
  let begun = false;
  let stopping: Promise<void> | null = null;

  const stopped = (): boolean => stopping !== null;

  const set = (patch: Partial<HostState>): void => {
    state = { ...state, ...patch };
    deps.onChange?.(state);
  };

  /** One transition at a time: each task starts once the one before it has settled. */
  const queue = (task: () => Promise<void>): void => {
    work = work.then(task).catch(() => {});
  };

  const wait = (ms: number, task: () => Promise<void>): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      queue(task);
    }, ms);
  };

  const release = async (): Promise<void> => {
    const current = agent;
    agent = null;
    if (current) await settleWithin(current.stop(), AGENT_STOP_CAP_MS);
  };

  const attempt = async (): Promise<void> => {
    if (stopped()) return;
    set({ mode: "starting", error: null });
    const mine = ++run;
    try {
      const running = await deps.start((s) => {
        if (mine === run && !stopped()) set(countsOf(s));
      });
      if (stopped()) {
        await settleWithin(running.stop(), AGENT_STOP_CAP_MS);
        return;
      }
      agent = running;
      set({ mode: "own", port: running.port });
    } catch (err) {
      if (stopped()) return;
      if (err instanceof ConfigError) {
        deps.log("desktop.agentFailed", { config: true });
        set({ mode: "failed", error: err.message });
        return;
      }
      if (err instanceof PortInUseError) {
        if (!(await deps.probe(err.port))) return faulted({ portInUse: true });
        if (stopped()) return;
        deps.log("desktop.attached", { port: err.port });
        set({ mode: "attached", port: err.port });
        return refresh(err.port);
      }
      return faulted({});
    }
  };

  /** While attached: take the counts now and look again in ten seconds. */
  const refresh = async (port: number): Promise<void> => {
    const counts = await deps.counts(port);
    if (stopped()) return;
    if (counts !== null) set(counts);
    wait(ATTACHED_POLL_MS, () => poll(port));
  };

  const poll = async (port: number): Promise<void> => {
    if (stopped() || state.mode !== "attached") return;
    if (await deps.probe(port)) return refresh(port);
    if (stopped()) return;
    deps.log("desktop.takeover", { port });
    return attempt();
  };

  const faulted = async (fields: LogFields): Promise<void> => {
    const t = now();
    faults = faults.filter((at) => t - at < FAULT_WINDOW_MS);
    if (faults.length >= BACKOFF_MS.length) {
      deps.log("desktop.agentFailed", { faults: faults.length + 1 });
      await release();
      set({ mode: "failed" });
      return;
    }
    const delay = BACKOFF_MS[faults.length] ?? 16_000;
    faults.push(t);
    deps.log("desktop.agentFault", { ...fields, restartMs: delay });
    set({ mode: "restarting" });
    await release();
    wait(delay, attempt);
  };

  return {
    state: () => state,
    start() {
      if (begun) return;
      begun = true;
      queue(attempt);
    },
    fault() {
      queue(async () => {
        if (stopped()) return;
        if (state.mode === "own") return faulted({ uncaught: true });
        deps.log("desktop.agentFault", { uncaught: true });
      });
    },
    retry() {
      queue(async () => {
        if (stopped() || state.mode !== "failed") return;
        faults = [];
        return attempt();
      });
    },
    restart() {
      queue(async () => {
        if (stopped()) return;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        faults = [];
        await release();
        return attempt();
      });
    },
    stop() {
      stopping ??= (async () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        await work;
        await release();
      })();
      return stopping;
    },
  };
}

/** One line for the window title now and the tray tooltip in stage 4. */
export function statusText(state: HostState): string {
  const parts = ["Clawd Visualiser", `${state.sessions} ${state.sessions === 1 ? "session" : "sessions"}`];
  if (state.waiting > 0) parts.push(`${state.waiting} waiting`);
  if (state.mode === "attached") parts.push("agent attached");
  if (state.mode === "failed") parts.push("agent failed");
  return parts.join(" · ");
}
