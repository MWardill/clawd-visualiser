import { emptyAliasMap, type AliasMap } from "@clawd/core";
import { rename } from "node:fs/promises";
import { z } from "zod";
import { readJsonFile, writeJsonAtomic } from "../json-file";
import type { Logger } from "../log";
import { fileStamp } from "../stamp";

const EntrySchema = z.object({ alias: z.string().min(1), label: z.string().min(1) }).strict();
const AliasMapSchema = z
  .object({
    sessions: z.record(z.string(), EntrySchema),
    panes: z.record(z.string(), EntrySchema),
    nextSession: z.number().int().min(1),
    nextPane: z.number().int().min(1),
  })
  .strict();

export type AliasStore = {
  load(): Promise<AliasMap>;
  /** Remember the latest map; it is written after the debounce, or on flush. */
  save(map: AliasMap): void;
  flush(): Promise<void>;
};

export function createAliasStore(path: string, deps: { log: Logger; now: () => number; debounceMs?: number }): AliasStore {
  const debounceMs = deps.debounceMs ?? 1_000;
  let pending: AliasMap | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const writeNow = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const map = pending;
    pending = null;
    if (map === null) return chain;
    chain = chain.then(() => writeJsonAtomic(path, map)).catch(() => deps.log("store.aliasesSaveFailed"));
    return chain;
  };

  return {
    async load() {
      const file = await readJsonFile(path);
      if (!file.found) return emptyAliasMap();
      const parsed = file.ok ? AliasMapSchema.safeParse(file.value) : null;
      if (parsed?.success) return parsed.data;
      // Never crash on a damaged file, and never silently destroy it either.
      await rename(path, `${path}.bad-${fileStamp(deps.now())}`);
      deps.log("store.aliasesRecovered");
      return emptyAliasMap();
    },
    save(map) {
      pending = map;
      timer ??= setTimeout(() => {
        timer = null;
        void writeNow();
      }, debounceMs);
    },
    flush: writeNow,
  };
}
