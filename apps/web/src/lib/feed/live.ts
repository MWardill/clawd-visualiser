// The agent's SSE stream. Every message is validated against the strict wire schemas and dropped
// otherwise, so nothing outside the contract can reach a component. EventSource reconnects by
// itself; the policy decides when a long outage means falling back.
import { ENDPOINTS, STREAM_EVENTS, SnapshotSchema, StreamTickerMessageSchema } from "@clawd/core";
import { fetchBackfill, sendCommand, type FetchLike } from "./agent";
import type { Feed } from "./types";

export type EventSourceLike = {
  addEventListener(type: string, listener: (e: MessageEvent) => void): void;
  close(): void;
};

export type LiveFeedDeps = {
  EventSource?: new (url: string) => EventSourceLike;
  fetch?: FetchLike;
};

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createLiveFeed(base: string, deps: LiveFeedDeps = {}): Feed {
  const Source = deps.EventSource ?? (EventSource as unknown as new (url: string) => EventSourceLike);
  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));

  return {
    start(listener) {
      let rejected = 0;
      const source = new Source(`${base}${ENDPOINTS.stream}`);
      const report = (connected: boolean): void => listener.onConnection?.(connected, rejected);
      source.addEventListener("open", () => report(true));
      source.addEventListener("error", () => report(false));
      source.addEventListener(STREAM_EVENTS.snapshot, (e) => {
        const parsed = SnapshotSchema.safeParse(parseJson(e.data));
        if (parsed.success) {
          listener.onSnapshot(parsed.data);
        } else {
          rejected++;
          report(true);
        }
      });
      source.addEventListener(STREAM_EVENTS.ticker, (e) => {
        const parsed = StreamTickerMessageSchema.safeParse(parseJson(e.data));
        if (parsed.success) {
          listener.onTicker(parsed.data.alias, parsed.data.event);
        } else {
          rejected++;
          report(true);
        }
      });
      return () => source.close();
    },
    backfill(alias) {
      return fetchBackfill(base, alias, fetchFn);
    },
    focus(alias) {
      return sendCommand(base, { type: "focus", alias }, fetchFn);
    },
  };
}
