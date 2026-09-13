import { emptyAliasMap, ensureSessionAlias } from "@clawd/core";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readJsonFile } from "../json-file";
import { useTempDirs } from "../testing/tmp";
import { createAliasStore } from "./alias-store";

const NOW = Date.UTC(2026, 8, 12, 10, 0, 0);

describe("alias store", () => {
  const tempDir = useTempDirs();

  it("loads an empty map when there is no file", async () => {
    const store = createAliasStore(join(await tempDir(), "aliases.json"), { log: vi.fn(), now: () => NOW });
    expect(await store.load()).toEqual(emptyAliasMap());
  });

  it("saves the latest map on flush and loads it back", async () => {
    const path = join(await tempDir(), "aliases.json");
    const store = createAliasStore(path, { log: vi.fn(), now: () => NOW, debounceMs: 60_000 });
    const one = ensureSessionAlias(emptyAliasMap(), "s1").map;
    const two = ensureSessionAlias(one, "s2").map;
    store.save(one);
    store.save(two);
    await store.flush();
    expect(await readJsonFile(path)).toEqual({ found: true, ok: true, value: two });
    expect(await createAliasStore(path, { log: vi.fn(), now: () => NOW }).load()).toEqual(two);
  });

  it("writes on its own after the debounce", async () => {
    const path = join(await tempDir(), "aliases.json");
    const store = createAliasStore(path, { log: vi.fn(), now: () => NOW, debounceMs: 5 });
    store.save(ensureSessionAlias(emptyAliasMap(), "s1").map);
    await vi.waitFor(async () => expect((await readJsonFile(path)).found).toBe(true), { timeout: 2000 });
  });

  it("flushes nothing when nothing is pending", async () => {
    const dir = await tempDir();
    await createAliasStore(join(dir, "aliases.json"), { log: vi.fn(), now: () => NOW }).flush();
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([
    ["not JSON", "{"],
    ["the wrong shape", '{"sessions":3}'],
  ])("sets aside a file that is %s and starts empty", async (_label, text) => {
    const dir = await tempDir();
    const path = join(dir, "aliases.json");
    await writeFile(path, text);
    const log = vi.fn();
    expect(await createAliasStore(path, { log, now: () => NOW }).load()).toEqual(emptyAliasMap());
    expect(await readdir(dir)).toEqual(["aliases.json.bad-20260912100000"]);
    expect(log).toHaveBeenCalledWith("store.aliasesRecovered");
  });
});
