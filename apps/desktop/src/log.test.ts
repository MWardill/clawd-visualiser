import { agentPaths, defaultConfig, saveConfig } from "@clawd/agent";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_DAYS, createFileSink, logFileName, readRetentionDays } from "./log";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawd-desktop-"));
  made.push(dir);
  return dir;
}

const DAY_MS = 86_400_000;
const T = Date.UTC(2026, 8, 14, 10, 0, 0);
const sevenDays = async (): Promise<number> => 7;

describe("createFileSink", () => {
  it("appends lines in order to the UTC day's file, making the directory", async () => {
    const dir = join(await tempDir(), "logs");
    const sink = createFileSink(dir, { now: () => T, retentionDays: sevenDays });
    sink.write("a\n");
    sink.write("b\n");
    await sink.flush();
    expect(logFileName(T)).toBe("desktop-2026-09-14.log");
    expect(await readFile(join(dir, "desktop-2026-09-14.log"), "utf8")).toBe("a\nb\n");
  });

  it("starts a new file when the day changes", async () => {
    const dir = await tempDir();
    let now = T;
    const sink = createFileSink(dir, { now: () => now, retentionDays: sevenDays });
    sink.write("today\n");
    now = T + DAY_MS;
    sink.write("tomorrow\n");
    await sink.flush();
    expect((await readdir(dir)).sort()).toEqual(["desktop-2026-09-14.log", "desktop-2026-09-15.log"]);
  });

  it("removes its own day files older than the retention when it opens a day, and nothing else", async () => {
    const dir = await tempDir();
    for (const name of ["desktop-2026-09-01.log", "desktop-2026-09-13.log", "events-2026-09-01.jsonl", "notes.txt"]) {
      await writeFile(join(dir, name), "x\n");
    }
    const sink = createFileSink(dir, { now: () => T, retentionDays: sevenDays });
    sink.write("a\n");
    await sink.flush();
    expect((await readdir(dir)).sort()).toEqual(["desktop-2026-09-13.log", "desktop-2026-09-14.log", "events-2026-09-01.jsonl", "notes.txt"]);
  });

  it("never rejects, even when it cannot write", async () => {
    const inTheWay = join(await tempDir(), "a-file");
    await writeFile(inTheWay, "");
    const sink = createFileSink(join(inTheWay, "logs"), { now: () => T, retentionDays: sevenDays });
    sink.write("a\n");
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});

describe("readRetentionDays", () => {
  it("reads logRetentionDays from the agent's config, and falls back to seven days when it is missing or unusable", async () => {
    const home = await tempDir();
    expect(await readRetentionDays(home)).toBe(DEFAULT_RETENTION_DAYS);
    await saveConfig(agentPaths(home), { ...defaultConfig(), logRetentionDays: 3 });
    expect(await readRetentionDays(home)).toBe(3);
    await writeFile(agentPaths(home).config, "{ not json");
    expect(await readRetentionDays(home)).toBe(7);
  });
});
