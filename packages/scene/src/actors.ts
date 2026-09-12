// The world the scene draws: panes with seats, and actors that walk in, sit, wave and walk out.
// reconcile() brings the world in line with a snapshot; tick() advances tweens and phases. Both
// mutate the world they are given and return it; both are deterministic for a given clock, so the
// tests drive them with fixed times. No canvas here.
import type { Activity, SessionPhase, Snapshot } from "@clawd/core";
import { easeInOut, easeOut, lerp } from "./engine";
import { MINI_HOME, doorOrigin, miniSlot, seatOrigin, type XY } from "./layout";

export type Ease = "out" | "inout";
export type Move = { from: XY; to: XY; t0: number; dur: number; ease: Ease };
export type Mini = { k: number; pos: XY; move: Move | null; leaving: boolean };
export type ActorPhase = "entering" | "seated" | "waving" | "leaving" | "gone";

export type Actor = {
  alias: string;
  label: string;
  pane: string;
  seat: number;
  state: SessionPhase;
  activity: Activity | null;
  subagents: number;
  contextPct: number | null;
  /** Epoch ms the current state began, from the snapshot. */
  since: number;
  phase: ActorPhase;
  phaseAt: number;
  /** Pane-relative origin of the actor's seat-sized box; the sprite sits at pos + (SPRITE_DX, SPRITE_DY). */
  pos: XY;
  move: Move | null;
  blinkAt: number;
  sparkleUntil: number;
  glanceUntil: number;
  /** Minis are positioned relative to the actor's pos, so they travel with it. */
  subs: Mini[];
};

export type ScenePane = { alias: string; label: string; collision: boolean; seats: (string | null)[]; closing: boolean };
export type World = { panes: ScenePane[]; actors: Actor[] };

/** Milliseconds. */
export const TIMING = { enter: 2000, leave: 2600, wave: 1600, miniOut: 1200, miniBack: 1500, sparkle: 600, glance: 1600, blink: 140 } as const;
export const MAX_MINIS = 3;

export function emptyWorld(): World {
  return { panes: [], actors: [] };
}

/** Highest occupied seat index plus one: what the pane's height is computed from. */
export function seatsUsed(p: ScenePane): number {
  let n = p.seats.length;
  while (n > 0 && p.seats[n - 1] === null) n--;
  return n;
}

function firstFreeSeat(seats: (string | null)[]): number {
  const i = seats.indexOf(null);
  return i === -1 ? seats.length : i;
}

export function moveProgress(m: Move, now: number): number {
  return Math.min(1, Math.max(0, (now - m.t0) / m.dur));
}

function positionAt(m: Move, now: number): XY {
  const p = moveProgress(m, now);
  const e = m.ease === "out" ? easeOut(p) : easeInOut(p);
  return { x: lerp(m.from.x, m.to.x, e), y: lerp(m.from.y, m.to.y, e) };
}

/** A deterministic gap of 3 to 7 s until the next blink, from the clock and the alias. */
export function nextBlink(alias: string, now: number): number {
  let h = 0;
  for (const ch of alias) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return now + 3000 + ((h + now) % 4000);
}

/** Marks a mini as leaving and moves it to the end of `subs`, so leaving minis land in the order they started leaving. */
function sendMiniHome(subs: Mini[], m: Mini, now: number): void {
  if (m.leaving) return;
  m.leaving = true;
  m.move = { from: { ...m.pos }, to: { ...MINI_HOME }, t0: now, dur: TIMING.miniBack, ease: "inout" };
  const idx = subs.indexOf(m);
  if (idx !== -1) {
    subs.splice(idx, 1);
    subs.push(m);
  }
}

function startLeaving(a: Actor, pane: ScenePane | undefined, now: number): void {
  a.phase = "leaving";
  a.phaseAt = now;
  const to = doorOrigin(a.seat, pane ? seatsUsed(pane) : a.seat + 1);
  a.move = { from: { ...a.pos }, to, t0: now, dur: TIMING.leave, ease: "inout" };
  for (const m of [...a.subs]) sendMiniHome(a.subs, m, now);
}

/** Grows or shrinks the visible minis toward `count`, capped at MAX_MINIS; the newest goes home first. */
function syncMinis(a: Actor, count: number, now: number): void {
  const wanted = Math.min(MAX_MINIS, Math.max(0, count));
  const active = a.subs.filter((m) => !m.leaving);
  while (active.length < wanted) {
    const departing = a.subs.find((m) => m.leaving);
    if (departing) {
      departing.leaving = false;
      departing.move = { from: { ...departing.pos }, to: miniSlot(departing.k), t0: now, dur: TIMING.miniOut, ease: "out" };
      active.push(departing);
    } else {
      const used = new Set(a.subs.map((m) => m.k));
      let k = 0;
      while (used.has(k)) k++;
      const m: Mini = { k, pos: { ...MINI_HOME }, move: { from: { ...MINI_HOME }, to: miniSlot(k), t0: now, dur: TIMING.miniOut, ease: "out" }, leaving: false };
      a.subs.push(m);
      active.push(m);
    }
    a.sparkleUntil = now + TIMING.sparkle;
    a.glanceUntil = now + TIMING.glance;
  }
  while (active.length > wanted) {
    const newest = active.reduce((best, m) => (m.k > best.k ? m : best));
    sendMiniHome(a.subs, newest, now);
    active.splice(active.indexOf(newest), 1);
  }
}

/**
 * Brings the world in line with a snapshot: new panes are appended, new sessions take the lowest
 * free seat in their pane and walk in from the door, known sessions are updated in place, done
 * sessions wave, vanished sessions leave without the wave.
 */
export function reconcile(world: World, s: Snapshot, now: number): World {
  const livePanes = new Set<string>();
  for (const ps of s.panes) {
    livePanes.add(ps.pane);
    const p = world.panes.find((x) => x.alias === ps.pane);
    if (p) {
      p.label = ps.label;
      p.collision = ps.collision ?? false;
      p.closing = false;
    } else {
      world.panes.push({ alias: ps.pane, label: ps.label, collision: ps.collision ?? false, seats: [], closing: false });
    }
  }
  for (const p of world.panes) if (!livePanes.has(p.alias)) p.closing = true;

  const seen = new Set<string>();
  for (const ss of s.sessions) {
    seen.add(ss.alias);
    let pane = world.panes.find((p) => p.alias === ss.pane);
    if (!pane) {
      // A session whose pane the snapshot did not list: keep it visible rather than lose it.
      pane = { alias: ss.pane, label: ss.pane, collision: false, seats: [], closing: false };
      world.panes.push(pane);
    }
    let a = world.actors.find((x) => x.alias === ss.alias);
    if (!a) {
      const seat = firstFreeSeat(pane.seats);
      pane.seats[seat] = ss.alias;
      const from = doorOrigin(seat, seatsUsed(pane));
      a = {
        alias: ss.alias,
        label: ss.label,
        pane: ss.pane,
        seat,
        state: ss.state,
        activity: ss.activity,
        subagents: 0,
        contextPct: ss.contextPct,
        since: Date.parse(ss.since),
        phase: "entering",
        phaseAt: now,
        pos: { ...from },
        move: { from, to: seatOrigin(seat), t0: now, dur: TIMING.enter, ease: "out" },
        blinkAt: nextBlink(ss.alias, now),
        sparkleUntil: 0,
        glanceUntil: 0,
        subs: [],
      };
      world.actors.push(a);
    }
    a.label = ss.label;
    a.activity = ss.activity;
    a.contextPct = ss.contextPct;
    a.since = Date.parse(ss.since);
    if (ss.state === "done" && (a.phase === "entering" || a.phase === "seated")) {
      a.phase = "waving";
      a.phaseAt = now;
      a.move = null;
    }
    a.state = ss.state;
    syncMinis(a, ss.subagents, now);
    a.subagents = ss.subagents;
  }
  for (const a of world.actors) {
    if (!seen.has(a.alias) && (a.phase === "entering" || a.phase === "seated")) {
      startLeaving(a, world.panes.find((p) => p.alias === a.pane), now);
    }
  }
  return world;
}

/** Advances every tween and phase to `now`, frees the seats of the gone, drops them and any empty closing pane. */
export function tick(world: World, now: number): World {
  for (const a of world.actors) {
    if (a.move) {
      a.pos = positionAt(a.move, now);
      if (moveProgress(a.move, now) >= 1) {
        a.move = null;
        if (a.phase === "entering") a.phase = "seated";
        else if (a.phase === "leaving") a.phase = "gone";
      }
    }
    if (a.phase === "waving" && now - a.phaseAt >= TIMING.wave) {
      startLeaving(a, world.panes.find((p) => p.alias === a.pane), now);
    }
    if (now >= a.blinkAt + TIMING.blink) a.blinkAt = nextBlink(a.alias, now);
    for (const m of a.subs) {
      if (!m.move) continue;
      m.pos = positionAt(m.move, now);
      if (moveProgress(m.move, now) >= 1) m.move = null;
    }
    a.subs = a.subs.filter((m) => !(m.leaving && m.move === null));
  }
  for (const a of world.actors) {
    if (a.phase !== "gone") continue;
    const pane = world.panes.find((p) => p.alias === a.pane);
    if (pane && pane.seats[a.seat] === a.alias) pane.seats[a.seat] = null;
  }
  world.actors = world.actors.filter((a) => a.phase !== "gone");
  world.panes = world.panes.filter((p) => !(p.closing && !world.actors.some((a) => a.pane === p.alias)));
  return world;
}
