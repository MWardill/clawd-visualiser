import { describe, expect, it } from "vitest";
import { initialPolicy, parseSourceMode, reducePolicy, toFeedStatus, type PolicyEvent, type PolicyState } from "./policy";

function run(mode: "auto" | "simulated" | "live", events: PolicyEvent[]): { state: PolicyState; effects: string[][] } {
  let state = initialPolicy(mode);
  const effects: string[][] = [];
  for (const e of events) {
    const r = reducePolicy(state, e);
    state = r.state;
    effects.push(r.effects);
  }
  return { state, effects };
}

describe("connection policy", () => {
  it("parses the source override from the query string", () => {
    expect(parseSourceMode("")).toBe("auto");
    expect(parseSourceMode("?source=simulated")).toBe("simulated");
    expect(parseSourceMode("?x=1&source=live")).toBe("live");
    expect(parseSourceMode("?source=bogus")).toBe("auto");
  });

  it("probes first, then goes live when the agent answers", () => {
    const r = run("auto", [{ type: "start" }, { type: "probe", ok: true }]);
    expect(r.effects).toEqual([["probe"], ["start-live", "schedule-grace"]]);
    expect(r.state.phase).toBe("live");
    expect(r.state.connected).toBe(false);
  });

  it("falls back to simulated with no-agent when the probe fails, and keeps re-probing", () => {
    const r = run("auto", [{ type: "start" }, { type: "probe", ok: false }, { type: "reprobe-due" }, { type: "probe", ok: false }]);
    expect(r.effects).toEqual([["probe"], ["start-simulated", "schedule-reprobe"], ["probe"], ["schedule-reprobe"]]);
    expect(r.state).toMatchObject({ phase: "simulated", reason: "no-agent" });
  });

  it("switches from simulated to live when a later probe succeeds", () => {
    const r = run("auto", [{ type: "start" }, { type: "probe", ok: false }, { type: "reprobe-due" }, { type: "probe", ok: true }]);
    expect(r.effects.at(-1)).toEqual(["start-live", "schedule-grace"]);
    expect(r.state.phase).toBe("live");
  });

  it("marks the stream connected and cancels the grace timer on open", () => {
    const r = run("auto", [{ type: "start" }, { type: "probe", ok: true }, { type: "connection", connected: true, rejected: 0 }]);
    expect(r.effects.at(-1)).toEqual(["cancel-grace"]);
    expect(r.state.connected).toBe(true);
  });

  it("falls back with lost-agent when the stream stays down past the grace period", () => {
    const r = run("auto", [
      { type: "start" },
      { type: "probe", ok: true },
      { type: "connection", connected: true, rejected: 0 },
      { type: "connection", connected: false, rejected: 0 },
      { type: "grace-elapsed" },
    ]);
    expect(r.effects.slice(-2)).toEqual([["schedule-grace"], ["start-simulated", "schedule-reprobe"]]);
    expect(r.state).toMatchObject({ phase: "simulated", reason: "lost-agent" });
  });

  it("falls back after repeated reconnect errors, without restarting the grace timer each time", () => {
    const r = run("auto", [
      { type: "start" },
      { type: "probe", ok: true },
      { type: "connection", connected: true, rejected: 0 },
      { type: "connection", connected: false, rejected: 0 },
      { type: "connection", connected: false, rejected: 0 },
      { type: "connection", connected: false, rejected: 0 },
      { type: "grace-elapsed" },
    ]);
    expect(r.effects.slice(3)).toEqual([["schedule-grace"], [], [], ["start-simulated", "schedule-reprobe"]]);
    expect(r.state).toMatchObject({ phase: "simulated", reason: "lost-agent" });
  });

  it("ignores a grace timer that fires after the stream came back", () => {
    const r = run("auto", [
      { type: "start" },
      { type: "probe", ok: true },
      { type: "connection", connected: false, rejected: 0 },
      { type: "connection", connected: true, rejected: 0 },
      { type: "grace-elapsed" },
    ]);
    expect(r.effects.at(-1)).toEqual([]);
    expect(r.state.phase).toBe("live");
  });

  it("carries the rejected count into the status", () => {
    const r = run("auto", [{ type: "start" }, { type: "probe", ok: true }, { type: "connection", connected: true, rejected: 2 }]);
    expect(toFeedStatus(r.state, "http://127.0.0.1:4750")).toEqual({ mode: "live", agentUrl: "http://127.0.0.1:4750", connected: true, rejected: 2, detail: "none" });
  });

  it("keeps the agent's detail level from the probe and reports none when it sent none", () => {
    const r = run("auto", [{ type: "start" }, { type: "probe", ok: true, detail: "paths" }]);
    expect(toFeedStatus(r.state, "http://127.0.0.1:4750")).toMatchObject({ mode: "live", detail: "paths" });
    const plain = run("auto", [{ type: "start" }, { type: "probe", ok: true }]);
    expect(toFeedStatus(plain.state, "http://127.0.0.1:4750")).toMatchObject({ mode: "live", detail: "none" });
  });

  it("forced simulated never probes; forced live never falls back", () => {
    const sim = run("simulated", [{ type: "start" }, { type: "reprobe-due" }]);
    expect(sim.effects).toEqual([["start-simulated"], []]);
    expect(toFeedStatus(sim.state, "x")).toEqual({ mode: "simulated", reason: "forced" });
    const live = run("live", [{ type: "start" }, { type: "connection", connected: false, rejected: 0 }, { type: "grace-elapsed" }]);
    expect(live.effects).toEqual([["start-live"], [], []]);
    expect(live.state.phase).toBe("live");
    expect(toFeedStatus(initialPolicy("auto"), "x")).toEqual({ mode: "probing" });
  });
});
