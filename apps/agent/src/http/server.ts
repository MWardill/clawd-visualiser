import { CommandSchema, ENDPOINTS, HealthSchema, containsForbidden, stripDetail, type RedactedEvent, type Snapshot, type TickerEvent } from "@clawd/core";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { detailLevel, usesFolderPaneLabels, type AgentConfig } from "../config";
import { readBody } from "../ingest/body";
import { ingestHook, ingestStatus, parseJson } from "../ingest/ingest";
import type { Logger } from "../log";
import { AGENT_VERSION } from "../version";
import { checkOrigin, hostAllowed, tokenMatches } from "./guards";
import type { StreamHub } from "./sse";

export const HOOK_BODY_LIMIT = 8 * 1024 * 1024;
export const STATUS_BODY_LIMIT = 1024 * 1024;
export const COMMAND_BODY_LIMIT = 4 * 1024;

export type IngestCounts = { accepted: number; dropped: number; tooLarge: number; badJson: number; unauthorised: number };

export function newIngestCounts(): IngestCounts {
  return { accepted: 0, dropped: 0, tooLarge: 0, badJson: 0, unauthorised: 0 };
}

export type ServerHost = {
  ingest(e: RedactedEvent): void;
  snapshot(): Snapshot;
  tickerFor(alias: string): TickerEvent[] | null;
  sessionIdFor(alias: string): string | null;
  sessionCount(): number;
};

export type ServerDeps = {
  host: ServerHost;
  config: Pick<AgentConfig, "allowlist" | "token" | "corsOrigins" | "paneLabels" | "detail">;
  stream: Pick<StreamHub, "connect">;
  /** Runs after the 202 has been sent. */
  focus(sessionId: string): void;
  now: () => number;
  log: Logger;
  counts: IngestCounts;
  /** Strings no response body may contain: the live working directories. */
  sensitive: () => readonly string[];
  limits?: { hook?: number; status?: number; command?: number };
};

type Headers = Record<string, string>;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Headers = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": String(Buffer.byteLength(text)) });
  res.end(text);
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function createAgentServer(deps: ServerDeps): Server {
  const limits = { hook: deps.limits?.hook ?? HOOK_BODY_LIMIT, status: deps.limits?.status ?? STATUS_BODY_LIMIT, command: deps.limits?.command ?? COMMAND_BODY_LIMIT };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      deps.log("server.error");
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else if (!res.writableEnded) res.end();
    });
  });

  const port = (): number => (server.address() as AddressInfo | null)?.port ?? 0;

  /** Every JSON body is checked for forbidden keys and live directories before it is written. Detail is the one place a directory may live. */
  function send(res: ServerResponse, status: number, body: unknown, headers: Headers = {}): void {
    if (containsForbidden(stripDetail(body), deps.sensitive()) !== null) {
      deps.log("privacy.blocked");
      sendJson(res, 500, { error: "blocked" }, headers);
      return;
    }
    sendJson(res, status, body, headers);
  }

  /** Answer without reading the body; resume() lets any body drain so the socket stays usable. */
  function refuse(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, headers: Headers = {}): void {
    req.resume();
    send(res, status, body, headers);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host, port())) return refuse(req, res, 403, {});
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path.startsWith("/ingest/")) return handleIngest(req, res, path);
    if (path.startsWith("/api/")) return handleApi(req, res, path);
    return refuse(req, res, 404, { error: "not found" });
  }

  async function handleIngest(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (req.headers.origin !== undefined) return refuse(req, res, 403, {});
    const route = path === "/ingest/hook" ? "hook" : path === "/ingest/status" ? "status" : null;
    if (route === null) return refuse(req, res, 404, {});
    if (req.method !== "POST") return refuse(req, res, 405, {}, { allow: "POST" });
    if (!tokenMatches(req.headers["x-clawd-token"], deps.config.token)) {
      deps.counts.unauthorised++;
      return refuse(req, res, 401, {});
    }
    const body = await readBody(req, route === "hook" ? limits.hook : limits.status);
    // Answer first: {} carries no decision and no context, and nothing below can reach Claude Code.
    send(res, 200, {});
    if (!body.ok) {
      if (body.reason === "tooLarge") deps.counts.tooLarge++;
      return;
    }
    try {
      const parsed = parseJson(body.body);
      if (!parsed.ok) {
        deps.counts.badJson++;
        return;
      }
      const ctx = { now: deps.now(), allowlist: deps.config.allowlist, paneNames: usesFolderPaneLabels(deps.config), detail: detailLevel(deps.config) };
      const event = route === "hook" ? ingestHook(parsed.value, ctx) : ingestStatus(parsed.value, ctx);
      if (event === null) {
        deps.counts.dropped++;
        return;
      }
      deps.counts.accepted++;
      deps.host.ingest(event);
    } catch {
      deps.log("ingest.failed");
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const origin = checkOrigin(req.headers.origin, deps.config.corsOrigins);
    if (origin.kind === "denied") return refuse(req, res, 403, { error: "origin not allowed" });
    const cors: Headers = origin.kind === "allowed" ? { "access-control-allow-origin": origin.origin, vary: "Origin" } : {};

    if (req.method === "OPTIONS") {
      const privateNetwork: Headers = req.headers["access-control-request-private-network"] === "true" ? { "access-control-allow-private-network": "true" } : {};
      req.resume();
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600", ...privateNetwork });
      res.end();
      return;
    }

    const onlyGet = (then: () => void): void => {
      if (req.method !== "GET") return refuse(req, res, 405, { error: "method not allowed" }, { ...cors, allow: "GET" });
      then();
    };

    if (path === ENDPOINTS.snapshot) return onlyGet(() => send(res, 200, deps.host.snapshot(), cors));
    if (path === ENDPOINTS.health) {
      return onlyGet(() => send(res, 200, HealthSchema.parse({ ok: true, version: AGENT_VERSION, sessions: deps.host.sessionCount(), detail: detailLevel(deps.config) }), cors));
    }
    if (path === ENDPOINTS.stream) return onlyGet(() => deps.stream.connect(req, res, cors));
    if (path === ENDPOINTS.command) {
      if (req.method !== "POST") return refuse(req, res, 405, { error: "method not allowed" }, { ...cors, allow: "POST" });
      return handleCommand(req, res, cors);
    }
    const ticker = /^\/api\/ticker\/([^/]+)$/.exec(path)?.[1];
    if (ticker !== undefined) {
      return onlyGet(() => {
        const alias = safeDecode(ticker);
        const lines = alias === null ? null : deps.host.tickerFor(alias);
        if (lines === null) send(res, 404, { error: "unknown alias" }, cors);
        else send(res, 200, lines, cors);
      });
    }
    return refuse(req, res, 404, { error: "not found" }, cors);
  }

  async function handleCommand(req: IncomingMessage, res: ServerResponse, cors: Headers): Promise<void> {
    // A JSON content type forces a CORS preflight, so a page elsewhere cannot send this as a simple request.
    const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return refuse(req, res, 415, { error: "content-type must be application/json" }, cors);
    const body = await readBody(req, limits.command);
    if (!body.ok) {
      if (body.reason === "tooLarge") return send(res, 413, { error: "command too large" }, cors);
      return;
    }
    const parsed = parseJson(body.body);
    const command = parsed.ok ? CommandSchema.safeParse(parsed.value) : null;
    if (!command?.success) return send(res, 400, { error: "invalid command" }, cors);
    if (command.data.type === "focus") {
      const sessionId = deps.host.sessionIdFor(command.data.alias);
      if (sessionId === null) return send(res, 404, { error: "unknown alias" }, cors);
      res.writeHead(202, { ...cors, "cache-control": "no-store" });
      res.end();
      try {
        deps.focus(sessionId);
      } catch {
        deps.log("focus.failed");
      }
      return;
    }
    res.writeHead(202, { ...cors, "cache-control": "no-store" });
    res.end();
  }

  return server;
}
