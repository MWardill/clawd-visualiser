import type { Fixture } from "../fixtures/load";
import type { Sink, Source } from "./source";

export type ReplayOptions = {
  /** 1 = recorded pace, 2 = twice as fast, Infinity = all at once. Default 1. Must be positive. */
  speed?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

/** The longest delay a JavaScript timer holds; anything longer fires at once, the opposite of slow. */
const MAX_TIMER_MS = 2_147_483_647;

/** Plays a fixture back with its recorded gaps scaled by `speed`. */
export function createReplaySource(fixture: Fixture, opts: ReplayOptions = {}): Source {
  const speed = opts.speed ?? 1;
  if (!(speed > 0)) throw new RangeError(`replay speed must be a positive number, got ${speed}`);
  const setT = opts.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
  return {
    start(sink: Sink) {
      const events = fixture.events;
      if (!Number.isFinite(speed)) {
        for (const e of events) sink(e);
        return () => {};
      }
      let i = 0;
      let handle: unknown = null;
      let stopped = false;
      const emitNext = (): void => {
        if (stopped) return;
        const e = events[i];
        if (!e) return;
        sink(e);
        i++;
        // The sink may have stopped the replay from inside; scheduling on regardless would leak a timer.
        if (stopped) return;
        const next = events[i];
        if (!next) return;
        handle = setT(emitNext, Math.min(MAX_TIMER_MS, Math.max(0, (next.t - e.t) / speed)));
      };
      emitNext();
      return () => {
        stopped = true;
        if (handle !== null) clearT(handle);
      };
    },
  };
}
