import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** When a session's transcript was last written, or null when none is found. */
export type TranscriptClock = (sessionId: string) => Promise<number | null>;

/** A session id as the agents list prints it. Anything else could name a path outside the folders. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Claude Code appends to `<projects>/<folder>/<sessionId>.jsonl` whenever a session does anything,
 * so the file's modified time is when the session was last active. The folder name is derived from
 * the working directory in ways that vary (drive-letter case, for one), so the id is looked for in
 * every folder instead. Only the modified time is read: no file is opened, and no path or error
 * leaves this function.
 */
export function createTranscriptClock(projectsDir: string): TranscriptClock {
  return async (sessionId) => {
    if (!PLAIN_ID.test(sessionId)) return null;
    let folders: string[];
    try {
      folders = (await readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return null;
    }
    const times = await Promise.all(
      folders.map((folder) =>
        stat(join(projectsDir, folder, `${sessionId}.jsonl`)).then(
          (s) => (s.isFile() ? s.mtimeMs : null),
          () => null,
        ),
      ),
    );
    const found = times.filter((t): t is number => t !== null);
    return found.length > 0 ? Math.max(...found) : null;
  };
}
