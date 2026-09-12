// What a Clawd looks like this frame, from its actor and the clock. Pure; the renderer only draws
// what a Pose says. Follows the PRD's state table: mood is eyes, accessories and particles.
import type { Activity } from "@clawd/core";
import { TIMING, moveProgress, type Actor } from "./actors";
import { PALETTE, type EyeVariant } from "./engine";
import { SCENE_COLOURS } from "./sprites";

export type Pose = {
  eyes: EyeVariant;
  /** Vertical offset in cells; negative is up. */
  bounce: number;
  /** The walking step frame. */
  step: boolean;
  alpha: number;
  moving: boolean;
  exclaim: boolean;
  sweat: boolean;
  zzz: boolean;
  sparkle: boolean;
  wave: "left" | "right" | null;
  /** A particle to emit this frame: offset from the sprite origin and colour. */
  particle: { dx: number; dy: number; col: string } | null;
  heart: boolean;
};

/** Keystroke colours by activity. */
export const ACTIVITY_COLOURS: Record<Activity, string> = {
  read: PALETTE.state.blue,
  edit: PALETTE.state.green,
  run: PALETTE.state.amber,
  web: SCENE_COLOURS.web,
  spawn: PALETTE.clawd.body,
  think: PALETTE.night.starMid,
  other: PALETTE.night.starMid,
};

const HOP_PERIOD_MS = 1500;
const HOP_PART = 0.35;
const SWEAT_AFTER_MS = 10_000;

/** A one-cell lift for the rising part of a slow sine, so the body visibly breathes on a pixel grid. */
const breathe = (frame: number, speed: number): number => (Math.sin(frame * speed) > 0.3 ? -1 : 0);

function restingPose(): Pose {
  return { eyes: "forward", bounce: 0, step: false, alpha: 1, moving: false, exclaim: false, sweat: false, zzz: false, sparkle: false, wave: null, particle: null, heart: false };
}

export function poseFor(a: Actor, now: number, frame: number): Pose {
  const pose = restingPose();
  const m = a.move;
  if (m && (a.phase === "entering" || a.phase === "leaving")) {
    pose.moving = true;
    pose.eyes = m.to.x > m.from.x ? "look_right" : m.to.x < m.from.x ? "look_left" : m.to.y > m.from.y ? "look_down" : "forward";
    pose.step = Math.floor(frame / 4) % 2 === 0;
    pose.bounce = Math.round(Math.sin(frame * 0.8)) === 1 ? -1 : 0;
    if (a.phase === "leaving") pose.alpha = Math.max(0.1, 1 - moveProgress(m, now) * 0.9);
    return pose;
  }
  if (a.phase === "waving") {
    pose.wave = Math.floor(frame / 8) % 2 === 0 ? "right" : "left";
    // a heart-coloured keystroke every 5 frames: denser than the working trickle, so the farewell reads as celebration
    if (frame % 5 === 0) pose.particle = { dx: 4 + (frame % 7), dy: -1, col: PALETTE.state.pink };
    pose.heart = frame % 20 === 0;
    return pose;
  }
  const blinking = now >= a.blinkAt && now < a.blinkAt + TIMING.blink;
  switch (a.state) {
    case "working":
      pose.eyes = blinking ? "blink" : "look_down";
      pose.bounce = breathe(frame, 0.12);
      if (frame % 9 === 0) pose.particle = { dx: frame % 18 === 0 ? 1 : 12, dy: 2, col: a.activity ? ACTIVITY_COLOURS[a.activity] : PALETTE.night.starMid };
      break;
    case "waiting": {
      const elapsed = Math.max(0, now - a.since);
      const hp = (elapsed % HOP_PERIOD_MS) / HOP_PERIOD_MS;
      if (hp < HOP_PART) pose.bounce = -Math.round(Math.sin((hp / HOP_PART) * Math.PI) * 2);
      pose.exclaim = Math.floor(frame / 12) % 3 !== 2;
      pose.sweat = elapsed > SWEAT_AFTER_MS;
      break;
    }
    case "idle":
      pose.eyes = blinking ? "blink" : "forward";
      pose.bounce = breathe(frame, 0.09);
      break;
    case "asleep":
      pose.eyes = "blink";
      pose.alpha = 0.82;
      pose.bounce = breathe(frame, 0.05);
      pose.zzz = true;
      break;
    case "done":
      // unreachable today: reconcile() moves a done actor to "waving" in the same call; kept so the switch stays exhaustive
      break;
    default:
      a.state satisfies never;
  }
  if (now < a.sparkleUntil) pose.sparkle = true;
  else if (now < a.glanceUntil && a.state !== "asleep") pose.eyes = "look_right";
  return pose;
}
