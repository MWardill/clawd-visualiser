import { describe, expect, it, vi } from "vitest";
import type { RedactedEvent } from "../schema/events";
import { T0, event } from "../testing/events";
import { createReplaySource } from "./replay";

const fixture = { name: "x", events: [event("prompt", T0), event("stop", T0 + 1000, { backgroundTasks: 0 }), event("prompt", T0 + 4000)] };

describe("createReplaySource", () => {
  it("emits everything at once when speed is Infinity", () => {
    const got: RedactedEvent[] = [];
    const stop = createReplaySource(fixture, { speed: Infinity }).start((e) => got.push(e));
    expect(got.map((e) => e.kind)).toEqual(["prompt", "stop", "prompt"]);
    stop();
  });

  it("preserves the recorded gaps scaled by speed, and stop cancels the rest", () => {
    vi.useFakeTimers();
    try {
      const got: number[] = [];
      const stop = createReplaySource(fixture, { speed: 2 }).start((e) => got.push(e.t));
      expect(got).toEqual([T0]);
      vi.advanceTimersByTime(500);
      expect(got).toEqual([T0, T0 + 1000]);
      stop();
      vi.advanceTimersByTime(5000);
      expect(got).toEqual([T0, T0 + 1000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a backwards gap as zero", () => {
    vi.useFakeTimers();
    try {
      const got: number[] = [];
      createReplaySource({ name: "y", events: [event("prompt", T0 + 5), event("stop", T0, { backgroundTasks: 0 })] }).start((e) => got.push(e.t));
      expect(got).toEqual([T0 + 5]);
      vi.advanceTimersByTime(0);
      expect(got).toEqual([T0 + 5, T0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedules nothing further when the sink stops it mid-run", () => {
    vi.useFakeTimers();
    try {
      const got: number[] = [];
      let stop: () => void = () => {};
      stop = createReplaySource(fixture).start((e) => {
        got.push(e.t);
        if (got.length === 2) stop();
      });
      vi.advanceTimersByTime(1000);
      expect(got).toEqual([T0, T0 + 1000]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a speed that is zero, negative or not a number", () => {
    for (const speed of [0, -1, Number.NaN]) expect(() => createReplaySource(fixture, { speed })).toThrow(RangeError);
  });

  it("clamps a scaled gap to the longest delay a timer can hold", () => {
    const delays: number[] = [];
    createReplaySource(fixture, { speed: 1e-9, setTimeout: (_fn, ms) => delays.push(ms), clearTimeout: () => {} }).start(() => {});
    expect(delays).toEqual([2_147_483_647]);
  });
});
