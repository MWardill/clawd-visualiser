import {
  SNAPSHOT_MIN_INTERVAL_MS,
  STREAM_EVENTS,
  STREAM_HEARTBEAT_MS,
  SnapshotSchema,
  StreamTickerMessageSchema,
  containsForbidden,
  type Snapshot,
  type StreamTickerMessage,
} from "@clawd/core";
import type { Logger } from "../log";

export interface StreamRequest {
  on(event: "close", listener: () => void): unknown;
}

export interface StreamResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(chunk?: string): unknown;
  readonly writableLength: number;
  readonly writableEnded: boolean;
}

export type StreamHub = {
  connect(req: StreamRequest, res: StreamResponse, headers?: Record<string, string>): void;
  /** Broadcast, throttled to one per interval with a trailing send of the latest. */
  snapshot(s: Snapshot): void;
  ticker(m: StreamTickerMessage): void;
  clientCount(): number;
  closeAll(): void;
};

export function createStreamHub(opts: {
  current: () => Snapshot;
  log: Logger;
  /** Strings no frame may contain, such as the live working directories. */
  sensitive?: () => readonly string[];
  now?: () => number;
  maxClients?: number;
  minIntervalMs?: number;
  heartbeatMs?: number;
  maxBufferedBytes?: number;
}): StreamHub {
  const now = opts.now ?? (() => Date.now());
  const maxClients = opts.maxClients ?? 16;
  const minIntervalMs = opts.minIntervalMs ?? SNAPSHOT_MIN_INTERVAL_MS;
  const heartbeatMs = opts.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  const maxBufferedBytes = opts.maxBufferedBytes ?? 1024 * 1024;
  const clients = new Set<StreamResponse>();
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: Snapshot | null = null;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  function frame(event: string, data: unknown): string | null {
    if (containsForbidden(data, opts.sensitive?.() ?? []) !== null) {
      opts.log("privacy.blocked");
      return null;
    }
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function drop(res: StreamResponse): void {
    if (!clients.delete(res)) return;
    if (!res.writableEnded) res.end();
    if (clients.size === 0 && heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function write(res: StreamResponse, text: string): void {
    if (res.writableLength > maxBufferedBytes) {
      opts.log("stream.slowClient");
      drop(res);
      return;
    }
    res.write(text);
  }

  function broadcast(text: string): void {
    for (const res of [...clients]) write(res, text);
  }

  function sendSnapshot(s: Snapshot): void {
    lastSentAt = now();
    const text = frame(STREAM_EVENTS.snapshot, s);
    if (text !== null) broadcast(text);
  }

  return {
    connect(req, res, headers = {}) {
      if (clients.size >= maxClients) {
        opts.log("stream.clientLimit");
        res.writeHead(503, { ...headers, "content-type": "application/json; charset=utf-8" });
        res.end('{"error":"too many streams"}');
        return;
      }
      res.writeHead(200, { ...headers, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      clients.add(res);
      req.on("close", () => drop(res));
      const current = SnapshotSchema.safeParse(opts.current());
      const text = current.success ? frame(STREAM_EVENTS.snapshot, current.data) : null;
      if (text !== null) write(res, text);
      heartbeat ??= setInterval(() => broadcast(": heartbeat\n\n"), heartbeatMs);
    },
    snapshot(s) {
      const parsed = SnapshotSchema.safeParse(s);
      if (!parsed.success) {
        opts.log("privacy.blocked");
        return;
      }
      const wait = minIntervalMs - (now() - lastSentAt);
      if (wait <= 0 && trailing === null) {
        sendSnapshot(parsed.data);
        return;
      }
      pending = parsed.data;
      trailing ??= setTimeout(() => {
        trailing = null;
        const next = pending;
        pending = null;
        if (next !== null) sendSnapshot(next);
      }, Math.max(0, wait));
    },
    ticker(m) {
      const parsed = StreamTickerMessageSchema.safeParse(m);
      if (!parsed.success) {
        opts.log("privacy.blocked");
        return;
      }
      const text = frame(STREAM_EVENTS.ticker, parsed.data);
      if (text !== null) broadcast(text);
    },
    clientCount: () => clients.size,
    closeAll() {
      if (trailing !== null) clearTimeout(trailing);
      trailing = null;
      pending = null;
      for (const res of [...clients]) drop(res);
      if (heartbeat !== null) clearInterval(heartbeat);
      heartbeat = null;
    },
  };
}
