import { describe, expect, it } from "vitest";
import { T0, event } from "../testing/events";
import { applyEvent } from "./apply";
import { DEFAULT_CONFIG } from "./config";
import { emptyFleet } from "./fleet";


describe("applyEvent", () => {
  it("reduces a first event and returns the before/after pair with its ticker lines", () => {
    const r = applyEvent(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1" }), T0, DEFAULT_CONFIG);
    expect(r.before).toBeNull();
    expect(r.after?.state).toBe("working");
    expect(r.fleet.sessions["s1"]).toBe(r.after);
    // A session's first sight has no previous state to have changed, so only the event's own line.
    expect(r.ticker).toEqual([{ t: new Date(T0).toISOString(), kind: "prompt" }]);
  });

  it("carries the previous session as before on a later event", () => {
    const first = applyEvent(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1" }), T0, DEFAULT_CONFIG);
    const second = applyEvent(first.fleet, event("stop", T0 + 10, { backgroundTasks: 0 }, { sessionId: "s1" }), T0 + 10, DEFAULT_CONFIG);
    expect(second.before).toBe(first.after);
    expect(second.after?.state).toBe("idle");
    expect(second.ticker.map((l) => l.kind)).toEqual(["stop", "state"]);
  });

  it("ignores a dead presence for a session it has never seen", () => {
    const f = emptyFleet();
    const r = applyEvent(f, event("presence", T0, { alive: false }, { sessionId: "ghost" }), T0, DEFAULT_CONFIG);
    expect(r.fleet).toBe(f);
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
    expect(r.ticker).toEqual([]);
  });

  it("emits no ticker lines for an event a done session ignores", () => {
    let r = applyEvent(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1" }), T0, DEFAULT_CONFIG);
    r = applyEvent(r.fleet, event("session.end", T0 + 10, { reason: "other" }, { sessionId: "s1" }), T0 + 10, DEFAULT_CONFIG);
    expect(r.ticker.map((l) => l.kind)).toEqual(["session.end", "state"]);
    r = applyEvent(r.fleet, event("prompt", T0 + 20, {}, { sessionId: "s1" }), T0 + 20, DEFAULT_CONFIG);
    expect(r.after).toBe(r.before);
    expect(r.ticker).toEqual([]);
  });

  it("stamps ticker lines with the host's clock, the same one the reducer used", () => {
    const r = applyEvent(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1" }), T0 + 500, DEFAULT_CONFIG);
    expect(r.after?.since).toBe(T0 + 500);
    expect(r.ticker[0]?.t).toBe(new Date(T0 + 500).toISOString());
  });
});
