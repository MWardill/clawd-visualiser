import { describe, expect, it } from "vitest";
import { TIMING, type Actor } from "./actors";
import { PALETTE } from "./engine";
import { seatOrigin } from "./layout";
import { ACTIVITY_COLOURS, poseFor } from "./poses";

const T0 = 1_700_000_000_000;

function actor(over: Partial<Actor> = {}): Actor {
  return {
    alias: "agent-1", label: "Otter", pane: "pane-1", seat: 0, state: "working", activity: "edit", subagents: 0, contextPct: null,
    since: T0, phase: "seated", phaseAt: T0, pos: seatOrigin(0), move: null, blinkAt: T0 + 5000, sparkleUntil: 0, glanceUntil: 0, subs: [],
    ...over,
  };
}

describe("poseFor", () => {
  it("looks down and emits activity-coloured keystrokes while working", () => {
    const p = poseFor(actor(), T0, 9);
    expect(p.eyes).toBe("look_down");
    expect(p.particle).toMatchObject({ col: ACTIVITY_COLOURS.edit });
    expect(poseFor(actor(), T0, 10).particle).toBeNull();
    expect(ACTIVITY_COLOURS.read).toBe(PALETTE.state.blue);
    expect(ACTIVITY_COLOURS.run).toBe(PALETTE.state.amber);
  });

  it("hops, shows the exclamation mark and sweats after ten seconds while waiting", () => {
    const a = actor({ state: "waiting", activity: null });
    const early = poseFor(a, T0 + 200, 0);
    expect(early.eyes).toBe("forward");
    expect(early.bounce).toBeLessThan(0);
    expect(early.exclaim).toBe(true);
    expect(early.sweat).toBe(false);
    const rest = poseFor(a, T0 + 1000, 0);
    expect(rest.bounce).toBe(0);
    expect(poseFor(a, T0 + 1000, 24).exclaim).toBe(false);
    expect(poseFor(a, T0 + 10_001, 0).sweat).toBe(true);
  });

  it("blinks inside the blink window when idle or working, and not outside it", () => {
    const a = actor({ state: "idle", activity: null, blinkAt: T0 + 100 });
    expect(poseFor(a, T0 + 150, 0).eyes).toBe("blink");
    expect(poseFor(a, T0 + 100 + TIMING.blink, 0).eyes).toBe("forward");
    expect(poseFor(actor({ blinkAt: T0 + 100 }), T0 + 150, 1).eyes).toBe("blink");
  });

  it("closes its eyes, dims and shows zZ while asleep", () => {
    const p = poseFor(actor({ state: "asleep", activity: null }), T0, 0);
    expect(p.eyes).toBe("blink");
    expect(p.alpha).toBeCloseTo(0.82);
    expect(p.zzz).toBe(true);
  });

  it("waves alternate claws with hearts while waving", () => {
    const a = actor({ state: "done", activity: null, phase: "waving" });
    expect(poseFor(a, T0, 0).wave).toBe("right");
    expect(poseFor(a, T0, 8).wave).toBe("left");
    expect(poseFor(a, T0, 20).heart).toBe(true);
    expect(poseFor(a, T0, 5).particle).toMatchObject({ col: PALETTE.state.pink });
  });

  it("walks with alternating legs, eyes toward the destination, fading when leaving", () => {
    const from = { x: 2, y: 30 };
    const entering = actor({ phase: "entering", move: { from, to: seatOrigin(0), t0: T0, dur: 2000, ease: "out" } });
    const p = poseFor(entering, T0 + 500, 0);
    expect(p.moving).toBe(true);
    expect(p.step).toBe(true);
    expect(poseFor(entering, T0 + 500, 4).step).toBe(false);
    expect(p.eyes).toBe("forward");
    expect(p.alpha).toBe(1);
    const leaving = actor({ phase: "leaving", move: { from: seatOrigin(0), to: from, t0: T0, dur: 2000, ease: "inout" } });
    const q = poseFor(leaving, T0 + 1000, 0);
    expect(q.eyes).toBe("look_down");
    expect(q.alpha).toBeCloseTo(0.55);
    const sideways = actor({ phase: "entering", move: { from: { x: 0, y: 3 }, to: { x: 26, y: 3 }, t0: T0, dur: 2000, ease: "out" } });
    expect(poseFor(sideways, T0, 0).eyes).toBe("look_right");
  });

  it("sparkles, then glances right, after a subagent spawns", () => {
    const a = actor({ sparkleUntil: T0 + 600, glanceUntil: T0 + 1600 });
    expect(poseFor(a, T0 + 100, 1).sparkle).toBe(true);
    const later = poseFor(a, T0 + 1000, 1);
    expect(later.sparkle).toBe(false);
    expect(later.eyes).toBe("look_right");
    expect(poseFor(a, T0 + 2000, 1).eyes).toBe("look_down");
  });

  it("breathes: the body lifts one cell for part of a slow cycle while working, idle and asleep", () => {
    for (const state of ["working", "idle", "asleep"] as const) {
      const a = actor({ state, activity: state === "working" ? "edit" : null, blinkAt: T0 + 60_000 });
      const bounces = new Set<number>();
      for (let f = 0; f < 200; f++) bounces.add(poseFor(a, T0, f).bounce);
      expect([...bounces].sort(), state).toEqual([-1, 0]);
    }
  });

  it("colours keystrokes star-mid while working with no activity", () => {
    expect(poseFor(actor({ activity: null }), T0, 9).particle).toMatchObject({ col: PALETTE.night.starMid });
  });
});
