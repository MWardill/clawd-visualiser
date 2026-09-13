import { DEFAULT_CONFIG, emptyAliasMap } from "@clawd/core";
import { describe, expect, it, vi } from "vitest";
import { FleetHost } from "../host/host";
import { silentLogger } from "../log";
import { T0, ev } from "../testing/events";
import { ALLOWED_ROOT, CANARY_CWD, OUTSIDE_CWD, rawAgentEntry } from "../testing/raw";
import { createPresencePoller, type Exec, type ExecResult } from "./poller";

function setup() {
  const clock = { now: T0 };
  const host = new FleetHost({ now: () => clock.now, config: DEFAULT_CONFIG, aliases: emptyAliasMap(), log: silentLogger });
  let reply: ExecResult = { ok: true, stdout: "[]" };
  const exec = vi.fn<Exec>(async () => reply);
  const log = vi.fn();
  const poller = createPresencePoller({ host, exec, command: "claude", allowlist: [ALLOWED_ROOT], intervalMs: 10_000, now: () => clock.now, log });
  return {
    host,
    clock,
    exec,
    log,
    poller,
    list: (...entries: unknown[]) => {
      reply = { ok: true, stdout: JSON.stringify(entries) };
    },
    reply: (r: ExecResult) => {
      reply = r;
    },
  };
}

describe("presence poller", () => {
  it("runs the agents list and brings listed, allowlisted sessions in as idle", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"), rawAgentEntry("s2", { cwd: OUTSIDE_CWD, pid: 7 }));
    expect(await t.poller.pollOnce()).toBe(true);
    expect(t.exec).toHaveBeenCalledWith("claude agents --json", { timeoutMs: 15_000, maxBuffer: 4 * 1024 * 1024 });
    expect([...t.host.sessions().keys()]).toEqual(["s1"]);
    expect(t.host.sessions().get("s1")?.state).toBe("idle");
  });

  it("keeps pid and directory for focus, only for allowlisted sessions, and exposes the live directories", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"), rawAgentEntry("s2", { cwd: OUTSIDE_CWD, pid: 7 }), rawAgentEntry("s3", { pid: "not a number" }));
    await t.poller.pollOnce();
    expect(t.poller.lookup("s1")).toEqual({ pid: 4242, cwd: CANARY_CWD });
    expect(t.poller.lookup("s2")).toBeNull();
    expect(t.poller.lookup("s3")).toBeNull();
    expect(t.poller.liveDirectories()).toEqual([CANARY_CWD]);
  });

  it.each([
    ["the command fails", { ok: false } as ExecResult],
    ["the output is not JSON", { ok: true, stdout: "Usage: claude" } as ExecResult],
    ["the output is not an array", { ok: true, stdout: "{}" } as ExecResult],
  ])("marks nothing dead when %s", async (_label, result) => {
    const t = setup();
    t.host.ingest(ev("prompt", T0, {}));
    t.clock.now = T0 + 60_000;
    t.reply(result);
    expect(await t.poller.pollOnce()).toBe(false);
    expect(t.host.sessions().get("s1")?.state).toBe("working");
    expect(t.log).toHaveBeenCalledWith("presence.failed");
  });

  it("marks nothing dead when the command throws", async () => {
    const t = setup();
    t.exec.mockRejectedValueOnce(new Error("spawn failed"));
    expect(await t.poller.pollOnce()).toBe(false);
    expect(t.log).toHaveBeenCalledWith("presence.failed");
  });

  it("marks a session done once it has been missing from the list for the grace", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"));
    await t.poller.pollOnce();
    t.clock.now = T0 + 5_000;
    t.list();
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("idle");
    t.clock.now = T0 + 16_000;
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("done");
  });

  it("treats a recent hook as proof of life for a session the list does not show", async () => {
    const t = setup();
    t.host.ingest(ev("prompt", T0, {}));
    t.clock.now = T0 + 20_000;
    t.host.ingest(ev("tool.start", t.clock.now, { tool: "Read", category: "read", toolUseId: "u1" }));
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("working");
    t.clock.now = T0 + 36_000;
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("done");
  });

  it("does not resurrect a session that ended while still listed, and forgets it once unlisted", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"));
    await t.poller.pollOnce();
    t.host.ingest(ev("session.end", t.clock.now, { reason: "prompt_input_exit" }));
    t.clock.now += DEFAULT_CONFIG.doneLingerMs;
    t.host.tick();
    await t.poller.pollOnce();
    expect(t.host.sessionCount()).toBe(0);
    expect(t.host.endedIds().has("s1")).toBe(true);
    t.list();
    await t.poller.pollOnce();
    expect(t.host.endedIds().has("s1")).toBe(false);
  });

  it("shares one run between callers that poll at the same time", async () => {
    const t = setup();
    let release: (r: ExecResult) => void = () => {};
    t.exec.mockImplementationOnce(() => new Promise<ExecResult>((resolve) => { release = resolve; }));
    const a = t.poller.pollOnce();
    const b = t.poller.pollOnce();
    expect(t.exec).toHaveBeenCalledTimes(1);
    release({ ok: true, stdout: "[]" });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
  });

  it("discards a poll that finishes after stop, so nothing reaches the host", async () => {
    const t = setup();
    let release: (r: ExecResult) => void = () => {};
    t.exec.mockImplementationOnce(() => new Promise<ExecResult>((resolve) => { release = resolve; }));
    const pending = t.poller.pollOnce();
    t.poller.stop();
    release({ ok: true, stdout: JSON.stringify([rawAgentEntry("s1")]) });
    expect(await pending).toBe(false);
    expect(t.host.sessionCount()).toBe(0);
    expect(t.poller.lookup("s1")).toBeNull();
    expect(t.log).not.toHaveBeenCalledWith("presence.failed");
  });

  it("polls on its interval until stopped", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.exec).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.exec).toHaveBeenCalledTimes(2);
      t.poller.stop();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(t.exec).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
