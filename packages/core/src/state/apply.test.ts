import { describe, expect, it } from "vitest";
import type { RedactedEvent } from "../schema/events";
import { applyEvent } from "./apply";
import { DEFAULT_CONFIG } from "./config";
import { emptyFleet } from "./fleet";

const T0 = 1_757_671_200_000;
const ev = (sessionId: string, kind: string, t: number, extra: Record<string, unknown> = {}) =>
  ({ v: 1, sessionId, paneKey: "k1", t, kind, ...extra }) as RedactedEvent;

describe("applyEvent", () => {
  it("reduces a first event and returns the before/after pair with its ticker lines", () => {
    const r = applyEvent(emptyFleet(), ev("s1", "prompt", T0), T0, DEFAULT_CONFIG);
    expect(r.before).toBeNull();
    expect(r.after?.state).toBe("working");
    expect(r.fleet.sessions["s1"]).toBe(r.after);
    // A session's first sight has no previous state to have changed, so only the event's own line.
    expect(r.ticker).toEqual([{ t: new Date(T0).toISOString(), kind: "prompt" }]);
  });

  it("carries the previous session as before on a later event", () => {
    const first = applyEvent(emptyFleet(), ev("s1", "prompt", T0), T0, DEFAULT_CONFIG);
    const second = applyEvent(first.fleet, ev("s1", "stop", T0 + 10, { backgroundTasks: 0 }), T0 + 10, DEFAULT_CONFIG);
    expect(second.before).toBe(first.after);
    expect(second.after?.state).toBe("idle");
    expect(second.ticker.map((l) => l.kind)).toEqual(["stop", "state"]);
  });

  it("ignores a dead presence for a session it has never seen", () => {
    const f = emptyFleet();
    const r = applyEvent(f, ev("ghost", "presence", T0, { alive: false }), T0, DEFAULT_CONFIG);
    expect(r.fleet).toBe(f);
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
    expect(r.ticker).toEqual([]);
  });
});
