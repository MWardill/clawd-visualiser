// The quit sequence. Electron fires `will-quit` once every window has closed; preventDefault()
// there keeps the process alive while the agent stops, and app.exit() then ends it without firing
// the quit events again. Electron-free, so it is tested with fakes.
import type { Logger } from "@clawd/agent";

/** How long quitting waits for the agent to stop before exiting anyway. */
export const QUIT_CAP_MS = 5_000;
const FLUSH_CAP_MS = 1_000;

/** Resolves true when the work settles (either way) within the time, false when the time runs out first. */
export function settleWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void work
      .then(
        () => {},
        () => {},
      )
      .then(() => {
        clearTimeout(timer);
        resolve(true);
      });
  });
}

export type QuitDeps = {
  /** Called once, when the first `will-quit` arrives: every window has closed, so the quit is certain. Main takes the tray icon away here, not in `before-quit`, which a page's `beforeunload` could still cancel, leaving the agent running with no icon. */
  begin?(): void;
  /** Stops the agent host. */
  stop(): Promise<void>;
  /** Writes out the log lines still queued. */
  flush(): Promise<void>;
  /** app.exit: ends the process now. */
  exit(code: number): void;
  log: Logger;
};

/** The `will-quit` listener: hold the quit, stop once, flush, exit. Later calls only hold. */
export function createQuitHandler(deps: QuitDeps): (event: { preventDefault(): void }) => void {
  let quitting = false;
  return (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    try {
      deps.begin?.();
    } catch {
      // Tidying up must not stop the quit.
    }
    void (async () => {
      // Promise.resolve().then() turns a stop that throws synchronously into a rejection.
      if (!(await settleWithin(Promise.resolve().then(deps.stop), QUIT_CAP_MS))) deps.log("desktop.stopTimedOut");
      await settleWithin(deps.flush(), FLUSH_CAP_MS);
      deps.exit(0);
    })();
  };
}
