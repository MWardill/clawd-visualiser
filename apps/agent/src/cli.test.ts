import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { USAGE, runCli, type CliEnv } from "./cli";
import { useTempDirs } from "./testing/tmp";

const HOOKS = fileURLToPath(new URL("../hooks/", import.meta.url));

describe("runCli", () => {
  const tempDir = useTempDirs();

  async function env(over: Partial<CliEnv> = {}) {
    const root = await tempDir();
    await mkdir(join(root, "work"));
    const out: string[] = [];
    const err: string[] = [];
    const e: CliEnv = {
      serve: vi.fn(async () => 0),
      home: join(root, "clawd"),
      settingsPath: join(root, "claude", "settings.json"),
      cwd: root,
      node: process.execPath,
      hooksDir: HOOKS,
      now: () => 0,
      print: (l) => out.push(l),
      printError: (l) => err.push(l),
      probe: async () => false,
      ...over,
    };
    return { root, e, out, err };
  }

  it("serves", async () => {
    const t = await env();
    expect(await runCli(["serve"], t.e)).toBe(0);
    expect(t.e.serve).toHaveBeenCalled();
  });

  it.each([[[]], [["nope"]], [["serve", "extra"]], [["install", "--bogus"]], [["install", "--port", "abc"]], [["install", "--port", "70000"]], [["uninstall", "stray"]]])(
    "prints usage and exits 2 for %j",
    async (argv) => {
      const t = await env();
      expect(await runCli(argv, t.e)).toBe(2);
      expect(t.err).toEqual([USAGE]);
    },
  );

  it("installs to the given settings path, resolving --allow against the invoking directory, then uninstalls", async () => {
    const t = await env();
    const custom = join(t.root, "custom", "settings.json");
    expect(await runCli(["install", "--allow", "work", "--port", "4799", "--settings", custom], t.e)).toBe(0);
    expect(existsSync(custom)).toBe(true);
    expect(await runCli(["uninstall", "--settings", custom], t.e)).toBe(0);
  });

  it("reports an invalid config and exits 1", async () => {
    const t = await env();
    await mkdir(t.e.home, { recursive: true });
    await writeFile(join(t.e.home, "config.json"), '{"version":2}');
    expect(await runCli(["install", "--allow", "work"], t.e)).toBe(1);
    expect(t.err.join("\n")).toContain("invalid");
  });
});
