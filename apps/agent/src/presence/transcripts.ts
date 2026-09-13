import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** What the agent takes from a transcript: when it was last written, and how many prompts were typed into it. */
export type TranscriptStats = { lastWriteAt: number; prompts: number };
export type TranscriptReader = (sessionId: string) => Promise<TranscriptStats | null>;

/** A session id as the agents list prints it. Anything else could name a path outside the folders. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

/**
 * A prompt a person typed: a user entry Claude Code marks as coming from a human. Tool results,
 * command output and background-task notifications carry no such mark. Only these fields are named,
 * so nothing of an entry's content survives parsing.
 */
const TypedPromptSchema = z.object({
  type: z.literal("user"),
  origin: z.object({ kind: z.literal("human") }),
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
});

function isTypedPrompt(line: string): boolean {
  // Most lines are not typed prompts; only these are worth parsing.
  if (!line.includes('"human"')) return false;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return false;
  }
  const entry = TypedPromptSchema.safeParse(value);
  return entry.success && entry.data.isMeta !== true && entry.data.isSidechain !== true;
}

/**
 * Reads `<projects>/<folder>/<sessionId>.jsonl`. Claude Code appends to it whenever the session does
 * anything, so its modified time is when the session was last active. The folder name is derived
 * from the working directory in ways that vary (drive-letter case, for one), so the id is looked for
 * in every folder and the newest file wins. Content is read only to count typed prompts: the two
 * numbers are all that leave this function, and no path or error does.
 */
export function createTranscriptReader(projectsDir: string): TranscriptReader {
  return async (sessionId) => {
    if (!PLAIN_ID.test(sessionId)) return null;
    let folders: string[];
    try {
      folders = (await readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return null;
    }
    let newest: { path: string; mtimeMs: number } | null = null;
    for (const folder of folders) {
      const path = join(projectsDir, folder, `${sessionId}.jsonl`);
      const found = await stat(path).catch(() => null);
      if (found?.isFile() && (newest === null || found.mtimeMs > newest.mtimeMs)) newest = { path, mtimeMs: found.mtimeMs };
    }
    if (newest === null) return null;
    try {
      const text = await readFile(newest.path, "utf8");
      let prompts = 0;
      for (const line of text.split("\n")) if (isTypedPrompt(line)) prompts++;
      return { lastWriteAt: newest.mtimeMs, prompts };
    } catch {
      return null;
    }
  };
}
