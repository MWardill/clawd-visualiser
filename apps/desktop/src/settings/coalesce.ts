// Many changes in a row should cost one rebuild, not one each. The waiting call runs after the burst
// stops, on the trailing edge, so the page always ends up with the newest state. Pure, so the timing
// is tested with a fake clock.
export type Coalescer = {
  /** Ask for a run. A run already waiting is reused, so a burst costs one. */
  ask(): void;
  /** Cancel a waiting run, for shutdown. */
  cancel(): void;
};

export function createCoalescer(delayMs: number, run: () => void): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    ask() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
