import type { SessionSnapshot, Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { MAX_MINIS, TIMING, emptyWorld, reconcile, seatsUsed, tick } from "./actors";
import { MINI_HOME, doorOrigin, miniSlot, seatOrigin } from "./layout";

const T0 = 1_700_000_000_000;
const iso = (t: number): string => new Date(t).toISOString();

function session(over: Partial<SessionSnapshot> & { alias: string }): SessionSnapshot {
  return { label: "Otter", pane: "pane-1", state: "working", activity: "edit", subagents: 0, contextPct: null, since: iso(T0), updatedAt: iso(T0), ...over };
}

function snap(sessions: SessionSnapshot[], panes: Snapshot["panes"] = [{ pane: "pane-1", label: "Oak" }]): Snapshot {
  return { version: 1, generatedAt: iso(T0), panes, sessions };
}

describe("reconcile", () => {
  it("appends a pane and seats a new session at the lowest free seat, walking in from the door", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    expect(w.panes.map((p) => p.alias)).toEqual(["pane-1"]);
    expect(w.panes[0]!.seats).toEqual(["agent-1"]);
    const a = w.actors[0]!;
    expect(a.seat).toBe(0);
    expect(a.phase).toBe("entering");
    expect(a.pos).toEqual(doorOrigin(0, 1));
    expect(a.move).toMatchObject({ to: seatOrigin(0), dur: TIMING.enter, ease: "out" });
    expect(a.since).toBe(T0);
  });

  it("gives the second session seat 1 and reuses a vacated seat before growing", () => {
    let w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" }), session({ alias: "agent-2" })]), T0);
    expect(w.actors.map((a) => a.seat)).toEqual([0, 1]);
    // agent-1 vanishes and walks out; once gone its seat is free
    w = reconcile(w, snap([session({ alias: "agent-2" })]), T0 + 1000);
    expect(w.actors.find((a) => a.alias === "agent-1")!.phase).toBe("leaving");
    expect(w.panes[0]!.seats).toEqual(["agent-1", "agent-2"]);
    tick(w, T0 + 1000 + TIMING.leave + 1);
    expect(w.actors.map((a) => a.alias)).toEqual(["agent-2"]);
    expect(w.panes[0]!.seats).toEqual([null, "agent-2"]);
    w = reconcile(w, snap([session({ alias: "agent-2" }), session({ alias: "agent-3" })]), T0 + 5000);
    expect(w.actors.find((a) => a.alias === "agent-3")!.seat).toBe(0);
    expect(seatsUsed(w.panes[0]!)).toBe(2);
  });

  it("updates a known session in place without moving it", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    tick(w, T0 + TIMING.enter + 1);
    expect(w.actors[0]!.phase).toBe("seated");
    reconcile(w, snap([session({ alias: "agent-1", state: "waiting", activity: null, contextPct: 42, since: iso(T0 + 3000) })]), T0 + 3000);
    const a = w.actors[0]!;
    expect(a.state).toBe("waiting");
    expect(a.contextPct).toBe(42);
    expect(a.since).toBe(T0 + 3000);
    expect(a.seat).toBe(0);
    expect(a.move).toBeNull();
    expect(a.pos).toEqual(seatOrigin(0));
  });

  it("waves on done, then leaves after the wave, then is gone", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    tick(w, T0 + TIMING.enter + 1);
    reconcile(w, snap([session({ alias: "agent-1", state: "done", activity: null })]), T0 + 4000);
    expect(w.actors[0]!.phase).toBe("waving");
    tick(w, T0 + 4000 + TIMING.wave);
    expect(w.actors[0]!.phase).toBe("leaving");
    expect(w.actors[0]!.move).toMatchObject({ to: doorOrigin(0, 1), ease: "inout" });
    tick(w, T0 + 4000 + TIMING.wave + TIMING.leave);
    expect(w.actors).toEqual([]);
  });

  it("leaves at once, without the wave, when a session vanishes", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    reconcile(w, snap([]), T0 + 500);
    expect(w.actors[0]!.phase).toBe("leaving");
  });

  it("keeps a closing pane until its last actor is gone", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    reconcile(w, snap([], []), T0 + 500);
    expect(w.panes[0]!.closing).toBe(true);
    tick(w, T0 + 600);
    expect(w.panes).toHaveLength(1);
    tick(w, T0 + 500 + TIMING.leave);
    expect(w.panes).toEqual([]);
  });

  it("adds minis as the subagent count rises, capped, and sends the newest home as it falls", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1", subagents: 2 })]), T0);
    const a = w.actors[0]!;
    expect(a.subs.map((m) => m.k)).toEqual([0, 1]);
    expect(a.subs[0]!.move).toMatchObject({ from: MINI_HOME, to: miniSlot(0), ease: "out" });
    expect(a.sparkleUntil).toBe(T0 + TIMING.sparkle);
    reconcile(w, snap([session({ alias: "agent-1", subagents: 5 })]), T0 + 100);
    expect(a.subs.filter((m) => !m.leaving)).toHaveLength(MAX_MINIS);
    reconcile(w, snap([session({ alias: "agent-1", subagents: 1 })]), T0 + 200);
    expect(a.subs.filter((m) => m.leaving).map((m) => m.k)).toEqual([2, 1]);
    tick(w, T0 + 200 + TIMING.miniBack);
    expect(a.subs.map((m) => m.k)).toEqual([0]);
  });

  it("never changes an existing seat when the snapshot order changes", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" }), session({ alias: "agent-2" })]), T0);
    reconcile(w, snap([session({ alias: "agent-2" }), session({ alias: "agent-1" })]), T0 + 100);
    expect(w.actors.map((a) => [a.alias, a.seat])).toEqual([["agent-1", 0], ["agent-2", 1]]);
  });

  it("advances the blink clock past a blink window", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1" })]), T0);
    const first = w.actors[0]!.blinkAt;
    expect(first).toBeGreaterThanOrEqual(T0 + 3000);
    expect(first).toBeLessThan(T0 + 7000);
    tick(w, first + TIMING.blink);
    expect(w.actors[0]!.blinkAt).toBeGreaterThan(first);
  });

  it("recalls a departing mini instead of adding a fourth when the count rises again", () => {
    const w = reconcile(emptyWorld(), snap([session({ alias: "agent-1", subagents: 3 })]), T0);
    const a = w.actors[0]!;
    reconcile(w, snap([session({ alias: "agent-1", subagents: 1 })]), T0 + 100);
    expect(a.subs.filter((m) => m.leaving)).toHaveLength(2);
    reconcile(w, snap([session({ alias: "agent-1", subagents: 3 })]), T0 + 200);
    expect(a.subs).toHaveLength(MAX_MINIS);
    expect(a.subs.every((m) => !m.leaving)).toBe(true);
    expect(a.subs.map((m) => m.k).sort()).toEqual([0, 1, 2]);
    for (const m of a.subs) if (m.move) expect(m.move.to).toEqual(miniSlot(m.k));
    tick(w, T0 + 200 + TIMING.miniOut);
    expect(a.subs.every((m) => m.move === null && !m.leaving)).toBe(true);
  });
});
