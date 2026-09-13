import type { Snapshot, TickerEvent } from "@clawd/core";

export type SimulatedReason = "no-agent" | "lost-agent" | "forced";

export type FeedStatus =
  | { mode: "probing" }
  /** `rejected` counts stream messages that failed schema validation and were dropped. */
  | { mode: "live"; agentUrl: string; connected: boolean; rejected: number }
  | { mode: "simulated"; reason: SimulatedReason };

export type FeedListener = {
  onSnapshot(s: Snapshot): void;
  onTicker(alias: string, e: TickerEvent): void;
  /** Connection facts only; the policy turns them into a FeedStatus. */
  onConnection?(connected: boolean, rejected: number): void;
};

/** One source of snapshots and ticker lines: the agent's stream, or the simulation in the browser. */
export type Feed = {
  start(listener: FeedListener): () => void;
  backfill(alias: string): Promise<TickerEvent[]>;
  /** Resolves false when this feed cannot focus a window (the simulation). */
  focus(alias: string): Promise<boolean>;
};
