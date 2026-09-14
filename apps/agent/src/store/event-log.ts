import { RedactedEventSchema, containsDetail, containsForbidden, stripDetail, type RedactedEvent } from "@clawd/core";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isErrno } from "../json-file";
import type { Logger } from "../log";

const DAY_MS = 86_400_000;
const FILE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export type EventLog = {
  append(e: RedactedEvent): void;
  /** Delete day files whose whole day is older than the retention. */
  sweep(): Promise<void>;
  /** Resolves once every append so far has been written. */
  flush(): Promise<void>;
  /**
   * Yesterday's and today's events, in the order they were written, for restoring state at startup.
   * Two files, because a session busy across UTC midnight began in yesterday's. Lines that are not
   * valid events (the header, a line cut short by a crash) are skipped.
   */
  readRecent(): Promise<RedactedEvent[]>;
};

export function logFileName(ms: number): string {
  return `events-${new Date(ms).toISOString().slice(0, 10)}.jsonl`;
}

/**
 * The redacted event log: one file per UTC day in core's fixture format, so parseFixture() and
 * createReplaySource() read a day unchanged. Every line is revalidated before it is written.
 */
export function createEventLog(
  dir: string,
  deps: { now: () => number; retentionDays: number; log: Logger; sensitive?: () => readonly string[] },
): EventLog {
  let chain: Promise<void> = Promise.resolve();
  const headed = new Set<string>();

  return {
    append(e) {
      // The log is level none whatever the agent's setting: detail never touches the disk.
      const parsed = RedactedEventSchema.safeParse(stripDetail(e));
      if (!parsed.success || containsForbidden(parsed.data, deps.sensitive?.() ?? []) !== null) {
        deps.log("privacy.blocked");
        return;
      }
      const name = logFileName(parsed.data.t);
      const line = JSON.stringify(parsed.data) + "\n";
      chain = chain
        .then(async () => {
          const path = join(dir, name);
          if (!headed.has(name)) {
            await mkdir(dir, { recursive: true });
            try {
              // "wx" writes the header only when the file is new; a file from an earlier run has one.
              await writeFile(path, JSON.stringify({ fixture: 1, name: name.replace(/\.jsonl$/, "") }) + "\n", { flag: "wx" });
            } catch (err) {
              if (!isErrno(err, "EEXIST")) throw err;
            }
            headed.add(name);
          }
          await appendFile(path, line);
        })
        .catch(() => deps.log("store.logWriteFailed"));
    },
    async sweep() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      const cutoff = deps.now() - deps.retentionDays * DAY_MS;
      for (const name of names) {
        const day = FILE.exec(name)?.[1];
        if (day === undefined) continue;
        if (Date.parse(`${day}T00:00:00.000Z`) + DAY_MS > cutoff) continue;
        await rm(join(dir, name), { force: true }).catch(() => deps.log("store.retentionFailed"));
        headed.delete(name);
      }
    },
    flush: () => chain,
    async readRecent() {
      await chain;
      const today = deps.now();
      const events: RedactedEvent[] = [];
      for (const name of [logFileName(today - DAY_MS), logFileName(today)]) {
        let text: string;
        try {
          text = await readFile(join(dir, name), "utf8");
        } catch (err) {
          if (!isErrno(err, "ENOENT")) deps.log("store.logReadFailed");
          continue;
        }
        for (const line of text.split(/\r?\n/)) {
          if (line.trim() === "") continue;
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          const parsed = RedactedEventSchema.safeParse(value);
          if (!parsed.success) continue;
          // A line with detail did not come from this log; it is not replayed.
          if (containsDetail(parsed.data)) {
            deps.log("privacy.blocked");
            continue;
          }
          events.push(parsed.data);
        }
      }
      return events;
    },
  };
}
