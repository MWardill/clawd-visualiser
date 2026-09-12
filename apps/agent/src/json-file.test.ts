import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isErrno, readJsonFile, writeJsonAtomic } from "./json-file";
import { useTempDirs } from "./testing/tmp";

describe("json files", () => {
  const tempDir = useTempDirs();

  it("reports a missing file", async () => {
    expect(await readJsonFile(join(await tempDir(), "nope.json"))).toEqual({ found: false });
  });

  it("reports a file that is not JSON without throwing", async () => {
    const path = join(await tempDir(), "bad.json");
    await writeFile(path, "{ not json");
    expect(await readJsonFile(path)).toEqual({ found: true, ok: false });
  });

  it("writes two-space JSON with a trailing newline, creating directories, and reads it back", async () => {
    const path = join(await tempDir(), "deep", "dir", "value.json");
    await writeJsonAtomic(path, { a: 1, b: [true] });
    expect(await readFile(path, "utf8")).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}\n');
    expect(await readJsonFile(path)).toEqual({ found: true, ok: true, value: { a: 1, b: [true] } });
  });

  it("replaces an existing file and leaves no temp files behind", async () => {
    const dir = await tempDir();
    const path = join(dir, "value.json");
    await writeJsonAtomic(path, { n: 1 });
    await writeJsonAtomic(path, { n: 2 });
    expect(await readJsonFile(path)).toEqual({ found: true, ok: true, value: { n: 2 } });
    expect(await readdir(dir)).toEqual(["value.json"]);
  });

  it("recognises errno codes", () => {
    expect(isErrno(Object.assign(new Error("x"), { code: "ENOENT" }), "ENOENT")).toBe(true);
    expect(isErrno(new Error("x"), "ENOENT")).toBe(false);
    expect(isErrno("ENOENT", "ENOENT")).toBe(false);
  });
});
