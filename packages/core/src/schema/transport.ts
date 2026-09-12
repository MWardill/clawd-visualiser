import { z } from "zod";
import { TickerEventSchema } from "./ticker";

/** Where the web app looks for a local agent unless NEXT_PUBLIC_AGENT_URL says otherwise. */
export const DEFAULT_AGENT_URL = "http://127.0.0.1:4750";

export const ENDPOINTS = {
  snapshot: "/api/snapshot",
  stream: "/api/stream",
  ticker: (alias: string) => `/api/ticker/${alias}`,
  command: "/api/command",
  health: "/api/health",
} as const;

/** SSE event names on ENDPOINTS.stream. */
export const STREAM_EVENTS = { snapshot: "snapshot", ticker: "ticker" } as const;

/** Payload of a `ticker` stream event. */
export const StreamTickerMessageSchema = z.object({ alias: z.string().min(1), event: TickerEventSchema }).strict();
export type StreamTickerMessage = z.infer<typeof StreamTickerMessageSchema>;

export const HealthSchema = z.object({ ok: z.literal(true), version: z.string(), sessions: z.number().int().nonnegative() }).strict();
export type Health = z.infer<typeof HealthSchema>;

/** The stream sends a full snapshot at most this often. */
export const SNAPSHOT_MIN_INTERVAL_MS = 250;
/** Heartbeat comment interval on the stream. */
export const STREAM_HEARTBEAT_MS = 15_000;
/** How many ticker events the agent keeps per session for backfill. */
export const TICKER_BACKFILL = 200;
