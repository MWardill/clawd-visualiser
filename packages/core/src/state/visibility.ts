import type { StateConfig } from "./config";
import type { SessionState } from "./session";

/**
 * Whether a session belongs in the snapshot. A working or waiting session always does, and one
 * nobody has prompted never does. A quiet session stays longer the more it has been used: one prompt
 * keeps it `oneShotHideMs` past its last activity, up to `fewPrompts` keep it `fewPromptsHideMs`, and
 * more keep it for good. A hidden session stays in the fleet, so its next prompt brings it back.
 */
export function isShown(s: SessionState, now: number, cfg: StateConfig): boolean {
  if (s.state === "working" || s.state === "waiting") return true;
  if (s.prompts === 0) return false;
  if (s.prompts > cfg.fewPrompts) return true;
  return now - s.lastActiveAt < (s.prompts === 1 ? cfg.oneShotHideMs : cfg.fewPromptsHideMs);
}
