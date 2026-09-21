import { ConfigError, PortInUseError, type RunningAgent } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Probe } from "./agent-client";
import { ATTACHED_POLL_MS, BACKOFF_MS, FAULT_WINDOW_MS, REFUSED_MESSAGE, createAgentHost, statusText, type AgentHostDeps, type HostState } from "./agent-host";
import { snapshot } from "./testing/snapshot";

/** Runs every queued promise callback. setImmediate is left real by the fake timers below. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flush();
}

type FakeAgent = RunningAgent & { stopped: boolean; emit(s: Snapshot): void };

/** A host over fakes. Each start throws the next error in `fail`, then succeeds on port 4750. */
function harness(opts: { fail?: unknown[]; probe?: AgentHostDeps["probe"]; counts?: AgentHostDeps["counts"] } = {}) {
  const fail = [...(opts.fail ?? [])];
  const codes: string[] = [];
  const agents: FakeAgent[] = [];
  let starts = 0;
  const host = createAgentHost({
    start: async (onSnapshot) => {
      starts++;
      const error = fail.shift();
      if (error !== undefined) throw error;
      const agent: FakeAgent = {
        port: 4750,
        stopped: false,
        emit: onSnapshot,
        async stop() {
          agent.stopped = true;
        },
      };
      agents.push(agent);
      return agent;
    },
    probe: opts.probe ?? (async () => "none"),
    counts: opts.counts ?? (async () => null),
    log: (code) => void codes.push(code),
    now: () => Date.now(),
  });
  return { host, codes, agents, starts: () => starts };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAgentHost", () => {
  it("attaches to an agent that refuses this app's page, says why, and stops saying it once a later probe is let in", async () => {
    let found: Probe = "refused";
    const { host, codes } = harness({ fail: [new PortInUseError(4750)], probe: async () => found });
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "attached", port: 4750, error: REFUSED_MESSAGE });
    expect(codes).toEqual(["desktop.attachedRefused"]);

    found = "ok";
    await advance(ATTACHED_POLL_MS);
    expect(host.state()).toMatchObject({ mode: "attached", error: null });

    found = "none";
    await advance(ATTACHED_POLL_MS);
    expect(host.state()).toMatchObject({ mode: "own", error: null });
  });

  it("says when its first start has settled, however it went, and on stop", async () => {
    const own = harness();
    let settled = false;
    void own.host.settled().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    own.host.start();
    await flush();
    expect(settled).toBe(true);

    const attached = harness({ fail: [new PortInUseError(4750)], probe: async () => "ok" });
    attached.host.start();
    await flush();
    await expect(attached.host.settled()).resolves.toBeUndefined();

    const failed = harness({ fail: [new ConfigError("config.json is invalid at: port")] });
    failed.host.start();
    await flush();
    await expect(failed.host.settled()).resolves.toBeUndefined();

    const never = harness();
    const waiting = never.host.settled();
    await never.host.stop();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("owns the agent it starts and counts sessions from its snapshots", async () => {
    const { host, agents } = harness();
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "own", port: 4750, sessions: 0, waiting: 0 });
    agents[0]?.emit(snapshot(["working", "waiting", "waiting"]));
    expect(host.state()).toMatchObject({ sessions: 3, waiting: 2 });
  });

  it("attaches to an agent already answering on the port, polls it, and takes over when it goes quiet", async () => {
    let answering = true;
    const { host, codes, agents, starts } = harness({ fail: [new PortInUseError(4750)], probe: async () => (answering ? "ok" : "none"), counts: async () => ({ sessions: 2, waiting: 1 }) });
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "attached", port: 4750, sessions: 2, waiting: 1 });
    expect(codes).toEqual(["desktop.attached"]);

    await advance(ATTACHED_POLL_MS);
    expect(host.state().mode).toBe("attached");
    expect(starts()).toBe(1);

    answering = false;
    await advance(ATTACHED_POLL_MS);
    expect(codes).toEqual(["desktop.attached", "desktop.takeover"]);
    expect(host.state()).toMatchObject({ mode: "own", port: 4750 });
    expect(agents).toHaveLength(1);
  });

  it("treats a port held by something that is not an agent as a fault, and tries again after a second", async () => {
    const { host, codes, starts } = harness({ fail: [new PortInUseError(4750)] });
    host.start();
    await flush();
    expect(host.state().mode).toBe("restarting");
    expect(codes).toEqual(["desktop.agentFault"]);
    await advance(999);
    expect(starts()).toBe(1);
    await advance(1);
    expect(starts()).toBe(2);
    expect(host.state().mode).toBe("own");
  });

  it("fails at once on an unusable config, keeping its message to show, and starts again on retry", async () => {
    const { host, codes, starts } = harness({ fail: [new ConfigError("config.json is invalid at: port")] });
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "failed", error: "config.json is invalid at: port" });
    expect(codes).toEqual(["desktop.agentFailed"]);
    await advance(60_000);
    expect(starts()).toBe(1);

    host.retry();
    await flush();
    expect(host.state()).toMatchObject({ mode: "own", error: null });
  });

  it("backs off 1, 2, 4, 8 then 16 seconds between restarts, and fails when a sixth fault comes inside five minutes", async () => {
    const boom = new Error("boom");
    const { host, codes, starts } = harness({ fail: Array.from({ length: 6 }, () => boom) });
    host.start();
    await flush();
    for (const [delay, total] of [
      [1_000, 2],
      [2_000, 3],
      [4_000, 4],
      [8_000, 5],
      [16_000, 6],
    ] as const) {
      await advance(delay - 1);
      expect(starts()).toBe(total - 1);
      await advance(1);
      expect(starts()).toBe(total);
    }
    expect(host.state().mode).toBe("failed");
    expect(codes).toEqual([...Array.from({ length: 5 }, () => "desktop.agentFault"), "desktop.agentFailed"]);
    await advance(FAULT_WINDOW_MS);
    expect(starts()).toBe(6);
  });

  it("forgets faults older than five minutes, so an occasional one restarts after a second", async () => {
    const { host, starts } = harness();
    host.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      host.fault();
      await flush();
      expect(host.state().mode).toBe("restarting");
      await advance(1_000);
      expect(host.state().mode).toBe("own");
      await advance(FAULT_WINDOW_MS);
    }
    expect(starts()).toBe(4);
  });

  it("on an uncaught error while it owns the agent, stops that agent, starts a fresh one and ignores the old one's snapshots", async () => {
    const { host, codes, agents } = harness();
    host.start();
    await flush();
    host.fault();
    await flush();
    expect(agents[0]?.stopped).toBe(true);
    await advance(1_000);
    expect(agents).toHaveLength(2);
    agents[0]?.emit(snapshot(["waiting"]));
    expect(host.state()).toMatchObject({ mode: "own", sessions: 0 });
    agents[1]?.emit(snapshot(["waiting"]));
    expect(host.state()).toMatchObject({ sessions: 1, waiting: 1 });
    expect(codes).toEqual(["desktop.agentFault"]);
  });

  it("logs an uncaught error while attached and changes nothing", async () => {
    const { host, codes, starts } = harness({ fail: [new PortInUseError(4750)], probe: async () => "ok" });
    host.start();
    await flush();
    host.fault();
    await advance(1_000);
    expect(host.state().mode).toBe("attached");
    expect(starts()).toBe(1);
    expect(codes).toEqual(["desktop.attached", "desktop.agentFault"]);
  });

  it("stops the agent it owns, and starts nothing after stop, even with a restart pending", async () => {
    const owning = harness();
    owning.host.start();
    await flush();
    await owning.host.stop();
    expect(owning.agents[0]?.stopped).toBe(true);

    const restarting = harness({ fail: [new Error("boom")] });
    restarting.host.start();
    await flush();
    expect(restarting.host.state().mode).toBe("restarting");
    await restarting.host.stop();
    await advance(60_000);
    expect(restarting.starts()).toBe(1);
  });

  it("stops an agent that finishes starting after stop was called", async () => {
    let resolveStart: (agent: RunningAgent) => void = () => {};
    let stopped = false;
    const host = createAgentHost({
      start: () =>
        new Promise<RunningAgent>((resolve) => {
          resolveStart = resolve;
        }),
      probe: async () => "none",
      counts: async () => null,
      log: () => {},
    });
    host.start();
    await flush();
    const stopping = host.stop();
    resolveStart({
      port: 4750,
      async stop() {
        stopped = true;
      },
    });
    await stopping;
    expect(stopped).toBe(true);
  });

  it("restarts the agent it owns, so a changed config is read again", async () => {
    const { host, agents, codes } = harness();
    host.start();
    await flush();
    host.restart();
    await flush();
    expect(agents[0]?.stopped).toBe(true);
    expect(agents).toHaveLength(2);
    expect(host.state()).toMatchObject({ mode: "own", port: 4750 });
    expect(codes).toEqual([]);
  });

  it("takes over from an attached agent on a restart, and starts nothing after stop", async () => {
    const attached = harness({ fail: [new PortInUseError(4750)], probe: async () => "ok" });
    attached.host.start();
    await flush();
    const codesBeforeRestart = [...attached.codes];
    const startsBeforeRestart = attached.starts();
    attached.host.restart();
    await flush();
    expect(attached.host.state().mode).toBe("own");
    expect(attached.codes).toEqual(codesBeforeRestart);
    expect(attached.starts()).toBe(startsBeforeRestart + 1);

    const afterStop = harness();
    afterStop.host.start();
    await flush();
    await afterStop.host.stop();
    afterStop.host.restart();
    await flush();
    expect(afterStop.starts()).toBe(1);
  });

  it("cancels a pending restart wait, so a backoff cannot start a second agent", async () => {
    const { host, starts } = harness({ fail: [new Error("boom")] });
    host.start();
    await flush();
    expect(host.state().mode).toBe("restarting");
    host.restart();
    await flush();
    expect(starts()).toBe(2);
    await advance(BACKOFF_MS[0] ?? 1_000);
    expect(starts()).toBe(2);
  });

  it("starts again after the host has given up", async () => {
    const boom = new Error("boom");
    const { host, starts } = harness({ fail: Array.from({ length: 6 }, () => boom) });
    host.start();
    await flush();
    for (const delay of BACKOFF_MS) await advance(delay);
    expect(host.state().mode).toBe("failed");
    host.restart();
    await flush();
    expect(host.state().mode).toBe("own");
    expect(starts()).toBe(7);
  });
});

describe("statusText", () => {
  const base: HostState = { mode: "own", port: 4750, sessions: 3, waiting: 1, error: null };

  it("names the sessions and those waiting, and says when the agent is not the app's own", () => {
    expect(statusText(base)).toBe("Clawd Visualiser · 3 sessions · 1 waiting");
    expect(statusText({ ...base, sessions: 1, waiting: 0 })).toBe("Clawd Visualiser · 1 session");
    expect(statusText({ ...base, mode: "attached" })).toBe("Clawd Visualiser · 3 sessions · 1 waiting · agent attached");
    expect(statusText({ ...base, mode: "failed", sessions: 0, waiting: 0 })).toBe("Clawd Visualiser · 0 sessions · agent failed");
    expect(statusText({ ...base, mode: "attached", error: REFUSED_MESSAGE })).toBe("Clawd Visualiser · 3 sessions · 1 waiting · agent attached, refuses this app");
  });
});
