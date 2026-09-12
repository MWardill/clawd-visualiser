export type StateConfig = {
  /** idle becomes asleep after this long. PRD default 10 minutes. */
  asleepAfterMs: number;
  /** A state is shown for at least this long before the next one replaces it. */
  minDisplayMs: number;
  /** Done sessions and empty panes are kept this long so the view can play the exit. */
  doneLingerMs: number;
};

export const DEFAULT_CONFIG: StateConfig = {
  asleepAfterMs: 10 * 60_000,
  minDisplayMs: 1_500,
  doneLingerMs: 4_000,
};
