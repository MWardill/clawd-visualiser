"use client";

// Runs the connection policy and whichever feed it picks. Components get the latest snapshot,
// a status for the badge, a generation counter that changes when the feed changes (so the scene
// can clear), and the ticker subscription the detail sheet needs.
import type { Snapshot, TickerEvent } from "@clawd/core";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { agentUrl, probeHealth } from "@/lib/feed/agent";
import { createLiveFeed } from "@/lib/feed/live";
import { GRACE_MS, REPROBE_MS, initialPolicy, parseSourceMode, reducePolicy, toFeedStatus, type Effect, type PolicyEvent, type PolicyState } from "@/lib/feed/policy";
import { createSimulatedFeed } from "@/lib/feed/simulated";
import type { Feed, FeedStatus } from "@/lib/feed/types";

export type TickerSubscriber = (e: TickerEvent) => void;

export type FeedApi = {
  snapshot: Snapshot | null;
  status: FeedStatus;
  /** Increments each time a different feed starts; the scene clears on it. */
  generation: number;
  canFocus: boolean;
  subscribeTicker: (alias: string, fn: TickerSubscriber) => () => void;
  backfill: (alias: string) => Promise<TickerEvent[]>;
  focus: (alias: string) => Promise<boolean>;
};

const subscribeToNothing = (): (() => void) => () => {};
const readSearch = (): string => window.location.search;
const readServerSearch = (): string => "";

export function useFeed(): FeedApi {
  const search = useSyncExternalStore(subscribeToNothing, readSearch, readServerSearch);
  const mode = parseSourceMode(search);
  const base = useMemo(() => agentUrl(), []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<FeedStatus>({ mode: "probing" });
  const [generation, setGeneration] = useState(0);
  const feedRef = useRef<Feed | null>(null);
  const subscribersRef = useRef<Map<string, Set<TickerSubscriber>>>(new Map());

  useEffect(() => {
    let state: PolicyState = initialPolicy(mode);
    let stopFeed: (() => void) | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;
    let reprobe: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const startFeed = (feed: Feed): void => {
      stopFeed?.();
      feedRef.current = feed;
      setSnapshot(null);
      setGeneration((g) => g + 1);
      stopFeed = feed.start({
        onSnapshot: (s) => setSnapshot(s),
        onTicker: (alias, e) => {
          for (const fn of subscribersRef.current.get(alias) ?? []) fn(e);
        },
        onConnection: (connected, rejected) => dispatch({ type: "connection", connected, rejected }),
      });
    };

    const run = (effect: Effect): void => {
      switch (effect) {
        case "probe":
          void probeHealth(base).then((health) => dispatch({ type: "probe", ok: health !== null, ...(health?.detail === undefined ? {} : { detail: health.detail }) }));
          break;
        case "start-live":
          startFeed(createLiveFeed(base));
          break;
        case "start-simulated":
          startFeed(createSimulatedFeed());
          break;
        case "schedule-reprobe":
          if (reprobe) clearTimeout(reprobe);
          reprobe = setTimeout(() => dispatch({ type: "reprobe-due" }), REPROBE_MS);
          break;
        case "schedule-grace":
          if (grace) clearTimeout(grace);
          grace = setTimeout(() => dispatch({ type: "grace-elapsed" }), GRACE_MS);
          break;
        case "cancel-grace":
          if (grace) clearTimeout(grace);
          grace = null;
          break;
        default:
          effect satisfies never;
      }
    };

    function dispatch(e: PolicyEvent): void {
      if (disposed) return;
      const r = reducePolicy(state, e);
      state = r.state;
      setStatus(toFeedStatus(state, base));
      for (const effect of r.effects) run(effect);
    }

    // Deferred so no state setter runs synchronously inside the effect body.
    queueMicrotask(() => dispatch({ type: "start" }));

    return () => {
      disposed = true;
      stopFeed?.();
      feedRef.current = null;
      if (grace) clearTimeout(grace);
      if (reprobe) clearTimeout(reprobe);
    };
  }, [mode, base]);

  const subscribeTicker = useCallback((alias: string, fn: TickerSubscriber) => {
    const map = subscribersRef.current;
    const set = map.get(alias) ?? new Set<TickerSubscriber>();
    map.set(alias, set);
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) map.delete(alias);
    };
  }, []);
  const backfill = useCallback((alias: string) => feedRef.current?.backfill(alias) ?? Promise.resolve([]), []);
  const focus = useCallback((alias: string) => feedRef.current?.focus(alias) ?? Promise.resolve(false), []);

  return { snapshot, status, generation, canFocus: status.mode === "live" && status.connected, subscribeTicker, backfill, focus };
}
