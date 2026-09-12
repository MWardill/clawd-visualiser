import { describe, expect, it, vi } from "vitest";
import type { RedactedEvent } from "../schema/events";
import { createReplaySource } from "./replay";

const T0 = 1_757_671_200_000;
const ev = (t: number, kind: "prompt" | "stop"): RedactedEvent =>
  kind === "prompt" ? { v: 1, t, sessionId: "s1", paneKey: "k1", kind } : { v: 1, t, sessionId: "s1", paneKey: "k1", kind, backgroundTasks: 0 };
const fixture = { name: "x", events: [ev(T0, "prompt"), ev(T0 + 1000, "stop"), ev(T0 + 4000, "prompt")] };

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
      createReplaySource({ name: "y", events: [ev(T0 + 5, "prompt"), ev(T0, "stop")] }).start((e) => got.push(e.t));
      expect(got).toEqual([T0 + 5]);
      vi.advanceTimersByTime(0);
      expect(got).toEqual([T0 + 5, T0]);
    } finally {
      vi.useRealTimers();
    }
  });
});
