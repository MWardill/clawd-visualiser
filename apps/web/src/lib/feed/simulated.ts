// The browser's stand-in for the agent: the core simulated source through the same reducers the
// agent runs, a snapshot at most every SNAPSHOT_MIN_INTERVAL_MS, and a ring of ticker lines per
// alias for the detail pane's backfill. Session ids and pane keys never leave this module.
import {
  SIMULATED_CONFIG,
  SNAPSHOT_MIN_INTERVAL_MS,
  TICKER_BACKFILL,
  applyEvent,
  createSimulatedSource,
  deriveSnapshot,
  emptyAliasMap,
  emptyFleet,
  ensureSessionAlias,
  tickFleet,
  type AliasMap,
  type Fleet,
  type RedactedEvent,
  type SimulatedSourceOptions,
  type TickerEvent,
} from "@clawd/core";
import type { Feed, FeedListener } from "./types";

export type SimulatedFeedOptions = {
  seed?: number;
  sessions?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** How often the fleet's timers are applied and a snapshot derived. Default SNAPSHOT_MIN_INTERVAL_MS. */
  tickMs?: number;
};

export function createSimulatedFeed(opts: SimulatedFeedOptions = {}): Feed {
  const now = opts.now ?? (() => Date.now());
  const setI = opts.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearI = opts.clearInterval ?? ((h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>));
  const rings = new Map<string, TickerEvent[]>();

  return {
    start(listener: FeedListener) {
      let fleet: Fleet = emptyFleet();
      let aliases: AliasMap = emptyAliasMap();
      let lastKey = "";

      const publish = (t: number): void => {
        const r = deriveSnapshot(fleet, aliases, t);
        aliases = r.aliases;
        const key = JSON.stringify([r.snapshot.panes, r.snapshot.sessions]);
        if (key === lastKey) return;
        lastKey = key;
        listener.onSnapshot(r.snapshot);
      };

      const sink = (e: RedactedEvent): void => {
        const r = applyEvent(fleet, e, e.t, SIMULATED_CONFIG);
        fleet = r.fleet;
        if (r.ticker.length === 0) return;
        const ar = ensureSessionAlias(aliases, e.sessionId);
        aliases = ar.map;
        const ring = rings.get(ar.alias) ?? [];
        rings.set(ar.alias, ring);
        for (const line of r.ticker) {
          ring.push(line);
          if (ring.length > TICKER_BACKFILL) ring.shift();
          listener.onTicker(ar.alias, line);
        }
      };

      const sourceOpts: SimulatedSourceOptions = { now, setInterval: setI, clearInterval: clearI };
      if (opts.seed !== undefined) sourceOpts.seed = opts.seed;
      if (opts.sessions !== undefined) sourceOpts.sessions = opts.sessions;
      // Publish the empty snapshot before the source's first synchronous pump (which can emit the
      // first session's events immediately, at t === now): the "at once" snapshot must be empty.
      publish(now());
      const stopSource = createSimulatedSource(sourceOpts).start(sink);
      const handle = setI(() => {
        const t = now();
        fleet = tickFleet(fleet, t, SIMULATED_CONFIG);
        publish(t);
      }, opts.tickMs ?? SNAPSHOT_MIN_INTERVAL_MS);
      listener.onConnection?.(true, 0);

      return () => {
        stopSource();
        clearI(handle);
      };
    },
    backfill(alias) {
      return Promise.resolve([...(rings.get(alias) ?? [])]);
    },
    focus() {
      return Promise.resolve(false);
    },
  };
}
