import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { USAGE, runCli, type CliEnv } from "./cli";
import { agentPaths, readConfig } from "./config";
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
    const settings = JSON.parse(await readFile(custom, "utf8"));
    const sessionStartCommand = settings.hooks.SessionStart[0].hooks.find((h: { type: string }) => h.type === "command").command as string;
    expect(sessionStartCommand.startsWith('"')).toBe(true);
    expect(sessionStartCommand).toContain(t.e.node.replace(/\\/g, "/"));
    expect(await runCli(["uninstall", "--settings", custom], t.e)).toBe(0);
  });

  it("reports an invalid config and exits 1", async () => {
    const t = await env();
    await mkdir(t.e.home, { recursive: true });
    await writeFile(join(t.e.home, "config.json"), '{"version":2}');
    expect(await runCli(["install", "--allow", "work"], t.e)).toBe(1);
    expect(t.err.join("\n")).toContain("invalid");
  });

  it("sets the detail level in the config and refuses an unknown one", async () => {
    const t = await env();
    expect(await runCli(["detail", "paths"], t.e)).toBe(0);
    expect((await readConfig(agentPaths(t.e.home)))?.detail).toBe("paths");
    expect(t.out.at(-1)).toContain("restart the agent");
    expect(await runCli(["detail", "content"], t.e)).toBe(2);
    expect(await runCli(["detail"], t.e)).toBe(2);
    expect(await runCli(["detail", "hints", "extra"], t.e)).toBe(2);
  });
});
