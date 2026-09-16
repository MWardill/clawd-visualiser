// Many changes in a row should cost one rebuild, not one each. The timer starts on the first ask and
// ignores the rest, so it fires a fixed delay after the burst begins, not once it stops: waiting for
// the stream to stop would freeze the page for as long as sessions change, which is when it's watched.
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
