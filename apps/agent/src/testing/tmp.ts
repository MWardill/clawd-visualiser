import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** Call at describe level. Returns a function that makes a fresh temp directory, removed after each test. */
export function useTempDirs(): () => Promise<string> {
  const made: string[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawd-agent-"));
    made.push(dir);
    return dir;
  };
}
