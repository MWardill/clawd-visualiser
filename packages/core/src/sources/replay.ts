import type { Fixture } from "../fixtures/load";
import type { Sink, Source } from "./source";

export type ReplayOptions = {
  /** 1 = recorded pace, 2 = twice as fast, Infinity = all at once. Default 1. */
  speed?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

/** Plays a fixture back with its recorded gaps scaled by `speed`. */
export function createReplaySource(fixture: Fixture, opts: ReplayOptions = {}): Source {
  const speed = opts.speed ?? 1;
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
        const next = events[i];
        if (!next) return;
        handle = setT(emitNext, Math.max(0, (next.t - e.t) / speed));
      };
      emitNext();
      return () => {
        stopped = true;
        if (handle !== null) clearT(handle);
      };
    },
  };
}
