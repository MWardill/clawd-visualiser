import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { T0 } from "../testing/events";
import { useTempDirs } from "../testing/tmp";
import { createTranscriptClock } from "./transcripts";

describe("transcript clock", () => {
  const tempDir = useTempDirs();

  async function transcript(root: string, project: string, name: string, mtimeMs: number): Promise<void> {
    await mkdir(join(root, project), { recursive: true });
    const path = join(root, project, name);
    await writeFile(path, "{}\n");
    await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
  }

  it("finds a session's transcript by id in whichever project folder holds it", async () => {
    const root = await tempDir();
    await transcript(root, "c--work-one", "s1.jsonl", T0 - 60_000);
    await transcript(root, "c--work-two", "s2.jsonl", T0);
    const lastWrite = createTranscriptClock(root);
    expect(await lastWrite("s1")).toBe(T0 - 60_000);
    expect(await lastWrite("s2")).toBe(T0);
  });

  it("takes the latest write when more than one project folder holds the id", async () => {
    const root = await tempDir();
    await transcript(root, "a", "s1.jsonl", T0 - 60_000);
    await transcript(root, "b", "s1.jsonl", T0);
    expect(await createTranscriptClock(root)("s1")).toBe(T0);
  });

  it("answers null for an unknown id, a missing root, a folder named like a transcript, and an id that is not a plain name", async () => {
    const root = await tempDir();
    await transcript(root, "p", "s1.jsonl", T0);
    await mkdir(join(root, "p", "dir.jsonl"));
    await writeFile(join(root, "escape.jsonl"), "{}\n");
    const lastWrite = createTranscriptClock(root);
    expect(await lastWrite("unknown")).toBeNull();
    expect(await lastWrite("dir")).toBeNull();
    expect(await lastWrite("../escape")).toBeNull();
    expect(await lastWrite("..")).toBeNull();
    expect(await lastWrite("")).toBeNull();
    expect(await createTranscriptClock(join(root, "absent"))("s1")).toBeNull();
  });
});
