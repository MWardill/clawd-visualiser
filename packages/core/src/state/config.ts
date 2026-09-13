export type StateConfig = {
  /** idle becomes asleep after this long. PRD default 10 minutes. */
  asleepAfterMs: number;
  /** A state is shown for at least this long before the next one replaces it. */
  minDisplayMs: number;
  /** Done sessions and empty panes are kept this long so the view can play the exit. */
  doneLingerMs: number;
  /**
   * A working session with no event for this long is treated as idle: its Stop never came (a user
   * interrupt, a lost hook). Generous, because a single tool call can legitimately run for minutes.
   */
  staleWorkingMs: number;
  /** A quiet session with exactly one prompt leaves the view this long after its last activity. */
  oneShotHideMs: number;
  /** A quiet session with up to `fewPrompts` prompts leaves the view this long after its last activity. */
  fewPromptsHideMs: number;
  /** A session with more prompts than this stays in view however quiet it is. */
  fewPrompts: number;
  /** Label a pane with its directory's last segment when its events carry one; otherwise its generated tree name. */
  folderPaneLabels: boolean;
};

export const DEFAULT_CONFIG: StateConfig = {
  asleepAfterMs: 10 * 60_000,
  minDisplayMs: 1_500,
  doneLingerMs: 4_000,
  staleWorkingMs: 30 * 60_000,
  oneShotHideMs: 3 * 3_600_000,
  fewPromptsHideMs: 24 * 3_600_000,
  fewPrompts: 8,
  folderPaneLabels: true,
};
