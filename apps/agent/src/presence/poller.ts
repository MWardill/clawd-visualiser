import { RedactedEventSchema, isAllowed, paneName } from "@clawd/core";
import { exec } from "node:child_process";
import { z } from "zod";
import type { FleetHost } from "../host/host";
import type { Logger } from "../log";
import { listedIds, reconcile } from "./reconcile";
import type { TranscriptStats } from "./transcripts";

export type ExecResult = { ok: true; stdout: string } | { ok: false };
export type Exec = (command: string, opts: { timeoutMs: number; maxBuffer: number }) => Promise<ExecResult>;

/**
 * Runs a constant command through the shell (on Windows `claude` is a .cmd shim). stdout is
 * captured and stderr discarded, never inherited, and the error itself is never looked at.
 */
export const nodeExec: Exec = (command, opts) =>
  new Promise((resolve) => {
    exec(command, { timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer, windowsHide: true, encoding: "utf8" }, (err, stdout) => {
      resolve(err ? { ok: false } : { ok: true, stdout });
    });
  });

export type FocusTarget = { pid: number; cwd: string };
export type PresenceHost = Pick<FleetHost, "ingest" | "sessions" | "endedIds" | "forgetEnded" | "settleRestored">;
export type PresencePoller = {
  /** One poll; concurrent callers share it. Resolves false when the poll said nothing. */
  pollOnce(): Promise<boolean>;
  /** pid and directory of a listed, allowlisted session from the latest poll. Memory only. */
  lookup(sessionId: string): FocusTarget | null;
  /** Directories of the latest poll's sessions, for the sinks' privacy check. */
  liveDirectories(): readonly string[];
  start(): void;
  stop(): void;
};

export const PRESENCE_GRACE_MS = 15_000;
const POLL_TIMEOUT_MS = 15_000;
const POLL_MAX_BUFFER = 4 * 1024 * 1024;

const ListedSchema = z.object({ sessionId: z.string().min(1), cwd: z.string().min(1) });
const TargetSchema = ListedSchema.extend({ pid: z.number().int().positive() });

function parseArray(stdout: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(stdout);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function createPresencePoller(deps: {
  host: PresenceHost;
  exec: Exec;
  command: string;
  allowlist: readonly string[];
  intervalMs: number;
  now: () => number;
  log: Logger;
  graceMs?: number;
  /** A session's transcript figures: its last write and its typed prompt count. Read once per session per run. */
  readTranscript?: (sessionId: string) => Promise<TranscriptStats | null>;
  /** Put each listed session's directory name on the presence and history events it builds. */
  paneNames?: boolean;
}): PresencePoller {
  const graceMs = deps.graceMs ?? PRESENCE_GRACE_MS;
  let targets = new Map<string, FocusTarget>();
  const lastListedAt = new Map<string, number>();
  /** Sessions whose transcript has been read in this run and which are still in the fleet. */
  const counted = new Set<string>();
  let inFlight: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;

  /**
   * Transcript figures for the allowlisted, listed sessions not counted in this run and not ended,
   * read one at a time: a first poll after a restart may read every transcript, and some are tens of
   * megabytes. Counted ids that have left the fleet are forgotten first, so a returning session is
   * counted again.
   */
  async function readUncounted(allowed: ReadonlySet<string>): Promise<Map<string, TranscriptStats | null>> {
    const read = new Map<string, TranscriptStats | null>();
    const reader = deps.readTranscript;
    if (!reader) return read;
    const known = deps.host.sessions();
    for (const id of [...counted]) if (!known.has(id)) counted.delete(id);
    const ended = deps.host.endedIds();
    for (const id of allowed) {
      if (counted.has(id) || ended.has(id)) continue;
      read.set(id, await reader(id).catch(() => null));
    }
    return read;
  }

  async function run(): Promise<boolean> {
    const result = await deps.exec(`${deps.command} agents --json`, { timeoutMs: POLL_TIMEOUT_MS, maxBuffer: POLL_MAX_BUFFER });
    if (stopped) return false;
    const entries = result.ok ? parseArray(result.stdout) : null;
    if (entries === null) {
      deps.log("presence.failed");
      return false;
    }
    const now = deps.now();
    const listed = listedIds(entries);
    for (const id of listed) lastListedAt.set(id, now);
    const next = new Map<string, FocusTarget>();
    for (const entry of entries) {
      const target = TargetSchema.safeParse(entry);
      if (target.success && isAllowed(target.data.cwd, deps.allowlist)) next.set(target.data.sessionId, { pid: target.data.pid, cwd: target.data.cwd });
    }
    targets = next;
    const allowed = new Set<string>();
    const cwdOf = new Map<string, string>();
    for (const entry of entries) {
      const listedEntry = ListedSchema.safeParse(entry);
      if (!listedEntry.success || !isAllowed(listedEntry.data.cwd, deps.allowlist)) continue;
      allowed.add(listedEntry.data.sessionId);
      cwdOf.set(listedEntry.data.sessionId, listedEntry.data.cwd);
    }
    deps.host.settleRestored(allowed);
    const read = await readUncounted(allowed);
    if (stopped) return false;
    const lastWriteAt = new Map<string, number>();
    for (const [id, stats] of read) if (stats) lastWriteAt.set(id, stats.lastWriteAt);
    const sessions = deps.host.sessions();
    for (const e of reconcile({ entries, sessions, lastListedAt, ended: deps.host.endedIds(), now, allowlist: deps.allowlist, graceMs, lastWriteAt, paneNames: deps.paneNames === true })) {
      deps.host.ingest(e);
    }
    // Counts go to sessions now in the fleet, including those reconcile just brought in.
    const fleet = deps.host.sessions();
    for (const [id, stats] of read) {
      const view = fleet.get(id);
      if (!view) continue;
      counted.add(id);
      if (!stats || stats.prompts === 0) continue;
      // The name also labels a restored pane whose log predates pane names.
      const name = deps.paneNames === true ? paneName(cwdOf.get(id) ?? "") : null;
      const history = RedactedEventSchema.safeParse({ v: 1, t: now, sessionId: id, paneKey: view.paneKey, ...(name === null ? {} : { paneName: name }), kind: "history", prompts: stats.prompts, lastActiveAt: Math.floor(stats.lastWriteAt) });
      if (history.success) deps.host.ingest(history.data);
    }
    deps.host.forgetEnded(listed);
    for (const id of [...lastListedAt.keys()]) if (!listed.has(id) && !sessions.has(id)) lastListedAt.delete(id);
    return true;
  }

  const pollOnce = (): Promise<boolean> => {
    inFlight ??= run()
      .catch(() => {
        deps.log("presence.failed");
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    pollOnce,
    lookup: (sessionId) => targets.get(sessionId) ?? null,
    liveDirectories: () => [...new Set([...targets.values()].flatMap((t) => [t.cwd, t.cwd.replace(/\\/g, "/")]))],
    start() {
      if (running) return;
      running = true;
      stopped = false;
      const loop = async (): Promise<void> => {
        await pollOnce();
        if (running) timer = setTimeout(() => void loop(), deps.intervalMs);
      };
      void loop();
    },
    stop() {
      stopped = true;
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
