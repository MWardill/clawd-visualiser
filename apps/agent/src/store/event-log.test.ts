import { parseFixture, type RedactedEvent } from "@clawd/core";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useTempDirs } from "../testing/tmp";
import { createEventLog, logFileName } from "./event-log";

const DAY1 = Date.UTC(2026, 8, 12, 23, 59, 0);
const DAY2 = Date.UTC(2026, 8, 13, 0, 1, 0);
const prompt = (t: number, sessionId = "s1"): RedactedEvent => ({ v: 1, t, sessionId, paneKey: "0123456789abcdef", kind: "prompt" });

describe("event log", () => {
  const tempDir = useTempDirs();

  it("names files by UTC day", () => {
    expect(logFileName(DAY1)).toBe("events-2026-09-12.jsonl");
    expect(logFileName(DAY2)).toBe("events-2026-09-13.jsonl");
  });

  it("writes one fixture-format file per day that parseFixture reads back", async () => {
    const dir = await tempDir();
    const log = createEventLog(dir, { now: () => DAY2, retentionDays: 7, log: vi.fn() });
    log.append(prompt(DAY1));
    log.append(prompt(DAY1 + 1, "s2"));
    log.append(prompt(DAY2));
    await log.flush();
    expect((await readdir(dir)).sort()).toEqual(["events-2026-09-12.jsonl", "events-2026-09-13.jsonl"]);
    const first = parseFixture(await readFile(join(dir, "events-2026-09-12.jsonl"), "utf8"));
    expect(first.name).toBe("events-2026-09-12");
    expect(first.events).toEqual([prompt(DAY1), prompt(DAY1 + 1, "s2")]);
    expect(parseFixture(await readFile(join(dir, "events-2026-09-13.jsonl"), "utf8")).events).toEqual([prompt(DAY2)]);
  });

  it("appends to a file from an earlier run without a second header", async () => {
    const dir = await tempDir();
    const a = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: vi.fn() });
    a.append(prompt(DAY1));
    await a.flush();
    const b = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: vi.fn() });
    b.append(prompt(DAY1 + 5));
    await b.flush();
    expect(parseFixture(await readFile(join(dir, logFileName(DAY1)), "utf8")).events).toHaveLength(2);
  });

  it("refuses an event that is not a valid redacted event, such as one carrying a cwd", async () => {
    const dir = await tempDir();
    const logger = vi.fn();
    const log = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: logger });
    log.append({ ...prompt(DAY1), cwd: "C:/work/CANARY" } as unknown as RedactedEvent);
    await log.flush();
    expect(await readdir(dir).catch(() => [])).toEqual([]);
    expect(logger).toHaveBeenCalledWith("privacy.blocked");
  });

  it("refuses an event that contains a live working directory", async () => {
    const dir = await tempDir();
    const logger = vi.fn();
    const log = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: logger, sensitive: () => ["C:/work/CANARY-repo"] });
    log.append({ v: 1, t: DAY1, sessionId: "s1", paneKey: "0123456789abcdef", kind: "status", model: "C:/work/CANARY-repo" });
    log.append(prompt(DAY1));
    await log.flush();
    const text = await readFile(join(dir, logFileName(DAY1)), "utf8");
    expect(text).not.toContain("CANARY");
    expect(parseFixture(text).events).toEqual([prompt(DAY1)]);
    expect(logger).toHaveBeenCalledWith("privacy.blocked");
  });

  it("deletes day files older than the retention and nothing else", async () => {
    const dir = await tempDir();
    const now = Date.UTC(2026, 8, 12, 12, 0, 0);
    for (const name of ["events-2026-09-01.jsonl", "events-2026-09-04.jsonl", "events-2026-09-05.jsonl", "events-2026-09-12.jsonl", "notes.txt"]) {
      await writeFile(join(dir, name), "x");
    }
    await createEventLog(dir, { now: () => now, retentionDays: 7, log: vi.fn() }).sweep();
    expect((await readdir(dir)).sort()).toEqual(["events-2026-09-05.jsonl", "events-2026-09-12.jsonl", "notes.txt"]);
  });

  it("sweeps a missing directory without failing", async () => {
    await createEventLog(join(await tempDir(), "absent"), { now: () => DAY1, retentionDays: 7, log: vi.fn() }).sweep();
  });

  it("reads back yesterday's and today's events in order, skipping older days and damaged lines", async () => {
    const dir = await tempDir();
    const writer = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: vi.fn() });
    writer.append(prompt(DAY1 - 2 * 86_400_000, "older"));
    writer.append(prompt(DAY1, "s1"));
    writer.append(prompt(DAY2, "s2"));
    await writer.flush();
    // A line cut short by a crash, and one that is JSON but not an event.
    await appendFile(join(dir, logFileName(DAY2)), '{"v":1,"t":5,"kind":"pro\n{"v":1,"kind":"prompt"}\n');
    const reader = createEventLog(dir, { now: () => DAY2 + 3_600_000, retentionDays: 7, log: vi.fn() });
    expect(await reader.readRecent()).toEqual([prompt(DAY1, "s1"), prompt(DAY2, "s2")]);
  });

  it("reads nothing back from a missing directory", async () => {
    expect(await createEventLog(join(await tempDir(), "absent"), { now: () => DAY1, retentionDays: 7, log: vi.fn() }).readRecent()).toEqual([]);
  });

  it("strips detail before writing and refuses a stored line that carries one", async () => {
    const dir = await tempDir();
    const logger = vi.fn();
    const log = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: logger, sensitive: () => ["C:/work/repo"] });
    log.append({ ...prompt(DAY1), detail: { dir: "C:/work/repo", name: "Fix login" } });
    await log.flush();
    const text = await readFile(join(dir, logFileName(DAY1)), "utf8");
    expect(text).not.toContain("detail");
    expect(text).not.toContain("C:/work/repo");
    expect(parseFixture(text).events).toEqual([prompt(DAY1)]);
    expect(logger).not.toHaveBeenCalled();
    await appendFile(join(dir, logFileName(DAY1)), JSON.stringify({ ...prompt(DAY1 + 1), detail: { dir: "C:/work/repo" } }) + "\n");
    expect(await log.readRecent()).toEqual([prompt(DAY1)]);
    expect(logger).toHaveBeenCalledWith("privacy.blocked");
  });
});
