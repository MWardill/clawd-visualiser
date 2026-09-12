import { DEFAULT_CONFIG, type StateConfig } from "@clawd/core";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { agentPaths, loadOrCreateConfig } from "./config";
import { createFocus, powershellFocus, type RunFocusScript } from "./focus/focus";
import { FleetHost } from "./host/host";
import { createAgentServer, newIngestCounts, type IngestCounts } from "./http/server";
import { createStreamHub } from "./http/sse";
import { isErrno } from "./json-file";
import { createLogger, type Logger } from "./log";
import { createPresencePoller, nodeExec, type Exec } from "./presence/poller";
import { createAliasStore } from "./store/alias-store";
import { createEventLog } from "./store/event-log";

export type AgentOptions = {
  home: string;
  /** Overrides the configured port; 0 picks a free one. */
  port?: number;
  now?: () => number;
  log?: Logger;
  exec?: Exec;
  runFocus?: RunFocusScript;
  platform?: NodeJS.Platform;
  stateConfig?: StateConfig;
  tickMs?: number;
};

export type RunningAgent = { port: number; stop(): Promise<void> };

export const TICK_MS = 500;
const SWEEP_MS = 3_600_000;
const COUNTS_MS = 60_000;

export function reportCounts(counts: IngestCounts, log: Logger): void {
  if (Object.values(counts).every((n) => n === 0)) return;
  log("ingest.counts", { ...counts });
  Object.assign(counts, newIngestCounts());
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/** Wires the agent together (spec §11). Writes config.json with a fresh token when there is none. */
export async function startAgent(opts: AgentOptions): Promise<RunningAgent> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? createLogger();
  const paths = agentPaths(opts.home);
  const config = await loadOrCreateConfig(paths);
  if (config.allowlist.length === 0) log("config.emptyAllowlist");

  const aliasStore = createAliasStore(paths.aliases, { log, now });
  const host = new FleetHost({ now, config: opts.stateConfig ?? DEFAULT_CONFIG, aliases: await aliasStore.load(), log });
  const poller = createPresencePoller({ host, exec: opts.exec ?? nodeExec, command: config.claudeCommand, allowlist: config.allowlist, intervalMs: config.pollIntervalMs, now, log });
  const sensitive = (): readonly string[] => poller.liveDirectories();
  const eventLog = createEventLog(paths.logs, { now, retentionDays: config.logRetentionDays, log, sensitive });
  const stream = createStreamHub({ current: () => host.snapshot(), log, sensitive, now });
  host.on({
    event: (e) => eventLog.append(e),
    ticker: (m) => stream.ticker(m),
    snapshot: (s) => stream.snapshot(s),
    aliases: (map) => aliasStore.save(map),
  });
  const focus = createFocus({ poller, run: opts.runFocus ?? powershellFocus, platform: opts.platform ?? process.platform, log });
  const counts = newIngestCounts();
  const server = createAgentServer({
    host,
    config,
    stream,
    focus: (sessionId) => {
      focus(sessionId).catch(() => log("focus.failed"));
    },
    now,
    log,
    counts,
    sensitive,
  });

  let port: number;
  try {
    port = await listen(server, opts.port ?? config.port);
  } catch (err) {
    if (isErrno(err, "EADDRINUSE")) log("server.portInUse");
    throw err;
  }

  const tick = setInterval(() => host.tick(), opts.tickMs ?? TICK_MS);
  const sweep = setInterval(() => void eventLog.sweep(), SWEEP_MS);
  const report = setInterval(() => reportCounts(counts, log), COUNTS_MS);
  void eventLog.sweep();
  poller.start();
  log("agent.started", { port });

  return {
    port,
    async stop() {
      clearInterval(tick);
      clearInterval(sweep);
      clearInterval(report);
      poller.stop();
      stream.closeAll();
      await closeServer(server);
      reportCounts(counts, log);
      await aliasStore.flush();
      await eventLog.flush();
      log("agent.stopped");
    },
  };
}
