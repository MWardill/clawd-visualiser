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
};

export const DEFAULT_CONFIG: StateConfig = {
  asleepAfterMs: 10 * 60_000,
  minDisplayMs: 1_500,
  doneLingerMs: 4_000,
  staleWorkingMs: 15 * 60_000,
};
