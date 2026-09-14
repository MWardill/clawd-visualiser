// Strings for nameplates and titles, and the one place text is put on the canvas.
import type { Activity, SessionPhase, Subject } from "@clawd/core";
import { PALETTE, type PixelContext } from "./engine";

export const STATE_COLOURS: Record<SessionPhase, string> = {
  working: PALETTE.state.green,
  waiting: PALETTE.state.amber,
  idle: PALETTE.night.text,
  asleep: PALETTE.state.blue,
  done: PALETTE.state.pink,
};

/** `mm:ss` for a duration; negatives read as zero. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export type Nameplate = { name: string; subs: string; status: string; colour: string };

/** Two lines under a Clawd: the name (the session's own when the detail level gives one) with its subagent count, then state, activity and time in state. */
export function nameplate(a: { label: string; name?: string | null; state: SessionPhase; activity: Activity | null; subagents: number; since: number }, now: number): Nameplate {
  const activity = a.state === "working" && a.activity ? `·${a.activity}` : "";
  return {
    name: (a.name ?? a.label).toLowerCase(),
    subs: a.subagents > 0 ? ` ×${a.subagents}` : "",
    status: `${a.state}${activity} ${mmss(now - a.since)}`,
    colour: STATE_COLOURS[a.state],
  };
}

/** The caption under a working Clawd: a file's last two segments, anything else as it is, cut with an ellipsis to `max` characters. */
export function caption(subject: Subject, max: number): string {
  const text = subject.kind === "file" ? subject.text.split("/").filter((s) => s.length > 0).slice(-2).join("/") : subject.text;
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/** Longest label a pane title shows; a pane is 52 cells wide and longer names would cross its border. */
export const TITLE_MAX = 24;

/** The pane title: a dash and the lower-case label, cut with an ellipsis when it is too long. */
export function paneTitle(label: string): string {
  const lower = label.toLowerCase();
  const cut = lower.length > TITLE_MAX ? `${lower.slice(0, TITLE_MAX - 1)}…` : lower;
  return `─ ${cut}`;
}

export type TextStyle = { size: number; font: string; bold?: boolean; align?: CanvasTextAlign; baseline?: CanvasTextBaseline };

/** Draws text anchored on a cell boundary. `size` is in canvas pixels, already scaled for the pixel ratio. */
export function drawText(ctx: PixelContext, PX: number, text: string, gx: number, gy: number, col: string, style: TextStyle): void {
  ctx.fillStyle = col;
  ctx.font = `${style.bold ? "bold " : ""}${style.size}px ${style.font}`;
  ctx.textAlign = style.align ?? "left";
  ctx.textBaseline = style.baseline ?? "top";
  ctx.fillText(text, gx * PX, gy * PX);
}
