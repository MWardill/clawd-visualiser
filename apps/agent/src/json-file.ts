import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type JsonRead = { found: false } | { found: true; ok: false } | { found: true; ok: true; value: unknown };

export function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/** Read and parse a JSON file. A missing file and a file that is not JSON are results, not throws. */
export async function readJsonFile(path: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return { found: false };
    throw err;
  }
  try {
    return { found: true, ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { found: true, ok: false };
  }
}

/**
 * Write two-space JSON with a trailing newline to a temp file beside the target, then rename it
 * into place, so a crash or a full disk never leaves half a file. Windows briefly refuses a rename
 * while another process (an editor, a virus scanner) has the target open, so that is retried.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (err) {
      const busy = isErrno(err, "EPERM") || isErrno(err, "EBUSY") || isErrno(err, "EACCES");
      if (busy && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      await rm(tmp, { force: true });
      throw err;
    }
  }
}
