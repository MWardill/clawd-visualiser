// The agent host: runs the agent inside the main process and keeps it running. It owns the agent
// when the port is free, attaches to one already serving it (the CLI's, say) and takes over when
// that one stops answering, restarts after faults with a backoff, and gives up after too many.
// Electron-free, so every transition is tested.
import { ConfigError, PortInUseError, type LogFields, type Logger, type RunningAgent } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import { countsOf, type Counts, type Probe } from "./agent-client";
import { settleWithin } from "./quit";

export type HostMode = "starting" | "own" | "attached" | "restarting" | "failed";

export type HostState = {
  mode: HostMode;
  /** The port of the agent in use, the app's own or the one attached to; null until one is known. */
  port: number | null;
  sessions: number;
  waiting: number;
  /** Why the agent is no use, when it is not: a ConfigError's message, which names a field and never a value, or REFUSED_MESSAGE while attached to an agent that refuses this app's page. Shown, never logged. */
  error: string | null;
};

export type AgentHostDeps = {
  /** Starts an agent in this process. Main passes startAgent with the home and the logger. */
  start(onSnapshot: (s: Snapshot) => void): Promise<RunningAgent>;
  /** What answers on the port, asked as the app's page would ask. Never rejects. */
  probe(port: number): Promise<Probe>;
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
  /** Resolves once the first start has settled as own, attached, restarting or failed, or the host was stopped. By then this home's config.json exists, unless it could not be written. */
  settled(): Promise<void>;
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
/** Shown as the agent's reason while attached to an agent started before it knew this app's origin. */
export const REFUSED_MESSAGE = "the agent on this port refuses this app's page; stop it and this app will start its own";
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

  let markSettled: () => void = () => {};
  const firstSettled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });

  const set = (patch: Partial<HostState>): void => {
    state = { ...state, ...patch };
    if (state.mode !== "starting") markSettled();
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
        const found = await deps.probe(err.port);
        if (found === "none") return faulted({ portInUse: true });
        if (stopped()) return;
        // An agent that refuses the page is still an agent holding the port: attach, so the takeover
        // happens when it stops, and say why the page stays simulated until then.
        deps.log(found === "refused" ? "desktop.attachedRefused" : "desktop.attached", { port: err.port });
        set({ mode: "attached", port: err.port, error: found === "refused" ? REFUSED_MESSAGE : null });
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
    const found = await deps.probe(port);
    if (stopped()) return;
    if (found !== "none") {
      // The agent on the port may have been replaced by a newer one since the last look.
      const error = found === "refused" ? REFUSED_MESSAGE : null;
      if (error !== state.error) set({ error });
      return refresh(port);
    }
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
    settled: () => firstSettled,
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
        begun = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        faults = [];
        await release();
        return attempt();
      });
    },
    stop() {
      stopping ??= (async () => {
        markSettled();
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
  if (state.mode === "attached") parts.push(state.error === null ? "agent attached" : "agent attached, refuses this app");
  if (state.mode === "failed") parts.push("agent failed");
  return parts.join(" · ");
}
