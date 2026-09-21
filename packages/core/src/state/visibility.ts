import type { StateConfig } from "./config";
import type { SessionState } from "./session";

/**
 * Whether a session belongs in the snapshot. A working session always does. A waiting one does until
 * it has waited `waitingHideMs`: a prompt nobody answers is not activity, so past that it is hidden
 * whatever its prompt count. One nobody has prompted never is. A quiet session stays longer the more
 * it has been used: one prompt keeps it `oneShotHideMs` past its last activity, up to `fewPrompts`
 * keep it `fewPromptsHideMs`, and more keep it for good. A hidden session stays in the fleet, so its
 * next prompt, or the answer to its wait, brings it back.
 */
export function isShown(s: SessionState, now: number, cfg: StateConfig): boolean {
  if (s.state === "working") return true;
  if (s.state === "waiting") return now - s.since < cfg.waitingHideMs;
  if (s.prompts === 0) return false;
  if (s.prompts > cfg.fewPrompts) return true;
  return now - s.lastActiveAt < (s.prompts === 1 ? cfg.oneShotHideMs : cfg.fewPromptsHideMs);
}
