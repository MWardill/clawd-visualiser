import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { T0 } from "../testing/events";
import { useTempDirs } from "../testing/tmp";
import { createTranscriptReader } from "./transcripts";

const line = (entry: Record<string, unknown>): string => JSON.stringify(entry);
const typed = (text: string): string => line({ type: "user", promptSource: "sdk", origin: { kind: "human" }, message: { role: "user", content: [{ type: "text", text }] } });

describe("transcript reader", () => {
  const tempDir = useTempDirs();

  async function transcript(root: string, project: string, name: string, mtimeMs: number, lines: string[] = []): Promise<void> {
    await mkdir(join(root, project), { recursive: true });
    const path = join(root, project, name);
    await writeFile(path, lines.map((l) => `${l}\n`).join(""));
    await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
  }

  it("finds a session's transcript by id in whichever project folder holds it", async () => {
    const root = await tempDir();
    await transcript(root, "c--work-one", "s1.jsonl", T0 - 60_000);
    await transcript(root, "c--work-two", "s2.jsonl", T0);
    const read = createTranscriptReader(root);
    expect(await read("s1")).toEqual({ lastWriteAt: T0 - 60_000, prompts: 0 });
    expect(await read("s2")).toEqual({ lastWriteAt: T0, prompts: 0 });
  });

  it("reads the newest when more than one project folder holds the id", async () => {
    const root = await tempDir();
    await transcript(root, "a", "s1.jsonl", T0 - 60_000, [typed("old")]);
    await transcript(root, "b", "s1.jsonl", T0, [typed("one"), typed("two")]);
    expect(await createTranscriptReader(root)("s1")).toEqual({ lastWriteAt: T0, prompts: 2 });
  });

  it("counts only prompts a person typed", async () => {
    const root = await tempDir();
    await transcript(root, "p", "s1.jsonl", T0, [
      line({ type: "summary", summary: "CANARY" }),
      typed("CANARY first prompt"),
      line({ type: "assistant", message: { content: [{ type: "text", text: "CANARY reply" }] } }),
      line({ type: "user", toolUseResult: {}, message: { content: [{ type: "tool_result", content: "CANARY output" }] } }),
      line({ type: "user", promptSource: "sdk", origin: { kind: "task-notification" }, message: { content: "<task-notification>" } }),
      line({ type: "user", isMeta: true, promptSource: "sdk", origin: { kind: "human" }, message: { content: "CANARY caveat" } }),
      line({ type: "user", isSidechain: true, promptSource: "sdk", origin: { kind: "human" }, message: { content: "CANARY subagent" } }),
      line({ type: "user", message: { content: "<local-command-stdout>CANARY</local-command-stdout>" } }),
      "not json, cut short by a crash {",
      typed("CANARY second prompt"),
    ]);
    expect(await createTranscriptReader(root)("s1")).toEqual({ lastWriteAt: T0, prompts: 2 });
  });

  it("answers null for an unknown id, a missing root, a folder named like a transcript, and an id that is not a plain name", async () => {
    const root = await tempDir();
    await transcript(root, "p", "s1.jsonl", T0);
    await mkdir(join(root, "p", "dir.jsonl"));
    await writeFile(join(root, "escape.jsonl"), "{}\n");
    const read = createTranscriptReader(root);
    expect(await read("unknown")).toBeNull();
    expect(await read("dir")).toBeNull();
    expect(await read("../escape")).toBeNull();
    expect(await read("..")).toBeNull();
    expect(await read("")).toBeNull();
    expect(await createTranscriptReader(join(root, "absent"))("s1")).toBeNull();
  });
});
