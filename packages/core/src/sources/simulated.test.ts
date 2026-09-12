import { describe, expect, it, vi } from "vitest";
import { RedactedEventSchema, type RedactedEvent } from "../schema/events";
import { DEFAULT_CONFIG, emptyFleet, reduceFleet, tickFleet } from "../state";
import { T0 } from "../testing/events";
import { SIMULATED_CONFIG, createSimulatedFleet, createSimulatedSource } from "./simulated";


function drive(seed: number, steps: number, stepMs = 500): RedactedEvent[] {
  const sim = createSimulatedFleet({ seed, sessions: 6 });
  const out: RedactedEvent[] = [];
  for (let i = 0; i <= steps; i++) out.push(...sim.next(T0 + i * stepMs));
  return out;
}

describe("simulated fleet", () => {
  it("is deterministic for a seed and different across seeds", () => {
    expect(drive(7, 400)).toEqual(drive(7, 400));
    expect(drive(7, 400)).not.toEqual(drive(8, 400));
  });

  it("emits only valid redacted events, in time order, with sessions spread across three panes", () => {
    const events = drive(3, 400);
    expect(events.length).toBeGreaterThan(50);
    for (const e of events) expect(() => RedactedEventSchema.parse(e)).not.toThrow();
    for (let i = 1; i < events.length; i++) expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
    expect(new Set(events.map((e) => e.paneKey)).size).toBe(3);
  });

  it("never leaves the reducer in an impossible state and visits every phase", () => {
    const sim = createSimulatedFleet({ seed: 11, sessions: 6 });
    let fleet = emptyFleet();
    const seen = new Set<string>();
    for (let i = 0; i <= 2000; i++) {
      const now = T0 + i * 500;
      for (const e of sim.next(now)) fleet = reduceFleet(fleet, e, now, SIMULATED_CONFIG);
      fleet = tickFleet(fleet, now, SIMULATED_CONFIG);
      for (const s of Object.values(fleet.sessions)) {
        seen.add(s.state);
        if (s.state === "waiting") expect(s.waitingOn).not.toBeNull();
        if (s.state === "idle" || s.state === "asleep") expect(s.activity).toBeNull();
      }
    }
    expect([...seen].sort()).toEqual(["asleep", "done", "idle", "waiting", "working"]);
    expect(SIMULATED_CONFIG.asleepAfterMs).toBeLessThan(DEFAULT_CONFIG.asleepAfterMs);
  });

  it("drives a sink on a timer and stops cleanly", () => {
    vi.useFakeTimers();
    try {
      let now = T0;
      const got: RedactedEvent[] = [];
      const stop = createSimulatedSource({ seed: 1, sessions: 3, now: () => now }).start((e) => got.push(e));
      for (let i = 0; i < 40; i++) {
        now += 250;
        vi.advanceTimersByTime(250);
      }
      expect(got.length).toBeGreaterThan(0);
      const count = got.length;
      stop();
      for (let i = 0; i < 40; i++) {
        now += 250;
        vi.advanceTimersByTime(250);
      }
      expect(got.length).toBe(count);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stamps integer times at a fractional speed on a jittery clock", () => {
    vi.useFakeTimers();
    try {
      let now = T0;
      const got: RedactedEvent[] = [];
      const stop = createSimulatedSource({ seed: 5, sessions: 3, speed: 0.7, now: () => now }).start((e) => got.push(e));
      for (let i = 0; i < 80; i++) {
        now += 250 + (i % 3);
        vi.advanceTimersByTime(250);
      }
      stop();
      expect(got.length).toBeGreaterThan(0);
      for (const e of got) expect(() => RedactedEventSchema.parse(e)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers nothing more once the sink stops it, even within a batch", () => {
    vi.useFakeTimers();
    try {
      let now = T0;
      const got: RedactedEvent[] = [];
      let stop: () => void = () => {};
      // A birth is a two-event batch from a timer tick: stopping on the second session's first
      // event must drop its second, and everything after.
      stop = createSimulatedSource({ seed: 1, sessions: 3, now: () => now }).start((e) => {
        got.push(e);
        if (e.kind === "session.start" && e.sessionId !== got[0]?.sessionId) stop();
      });
      for (let i = 0; i < 80; i++) {
        now += 250;
        vi.advanceTimersByTime(250);
      }
      const last = got.at(-1)!;
      expect(last.kind).toBe("session.start");
      expect(got.filter((e) => e.sessionId === last.sessionId)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
