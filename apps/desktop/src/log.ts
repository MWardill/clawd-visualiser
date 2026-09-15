// Where the app's log lines go: one file per UTC day under ~/.clawd/logs, beside the agent's event
// log. The lines themselves come from the agent's createLogger, so they hold codes and numbers only.
import { agentPaths, readConfig } from "@clawd/agent";
import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const DAY_MS = 86_400_000;
const FILE = /^desktop-(\d{4}-\d{2}-\d{2})\.log$/;

/** The agent's default, used when its config is missing or cannot be read. */
export const DEFAULT_RETENTION_DAYS = 7;

export function logFileName(ms: number): string {
  return `desktop-${new Date(ms).toISOString().slice(0, 10)}.log`;
}

export type FileSink = {
  write(line: string): void;
  /** Resolves once every line written so far is on disk, or has failed. Never rejects. */
  flush(): Promise<void>;
};

/**
 * Appends each line to the day's file, in order. Opening a day's file first removes this sink's
 * own files older than the retention. A write that fails is dropped: there is nowhere to log it.
 */
export function createFileSink(dir: string, deps: { now: () => number; retentionDays: () => Promise<number> }): FileSink {
  let chain: Promise<void> = Promise.resolve();
  let opened: string | null = null;
  return {
    write(line) {
      const name = logFileName(deps.now());
      chain = chain
        .then(async () => {
          if (name !== opened) {
            opened = name;
            await mkdir(dir, { recursive: true });
            try {
              await sweep(dir, deps.now(), await deps.retentionDays());
            } catch {
              // Retention is housekeeping; the line still goes in.
            }
          }
          await appendFile(join(dir, name), line);
        })
        .catch(() => {});
    },
    flush: () => chain,
  };
}

async function sweep(dir: string, now: number, retentionDays: number): Promise<void> {
  const cutoff = now - retentionDays * DAY_MS;
  for (const name of await readdir(dir)) {
    const day = FILE.exec(name)?.[1];
    if (day === undefined) continue;
    if (Date.parse(`${day}T00:00:00.000Z`) + DAY_MS > cutoff) continue;
    await rm(join(dir, name), { force: true });
  }
}

/** `logRetentionDays` from the agent's config; the default when there is no usable config yet. */
export async function readRetentionDays(home: string): Promise<number> {
  try {
    return (await readConfig(agentPaths(home)))?.logRetentionDays ?? DEFAULT_RETENTION_DAYS;
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}
