import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentConfigSchema,
  ConfigError,
  DEFAULT_PORT,
  agentPaths,
  defaultConfig,
  defaultHome,
  defaultSettingsPath,
  defaultTranscriptsDir,
  loadOrCreateConfig,
  readConfig,
  saveConfig,
} from "./config";
import { useTempDirs } from "./testing/tmp";

describe("paths", () => {
  it("lays out the home directory", () => {
    expect(agentPaths("/h")).toEqual({
      home: "/h",
      config: join("/h", "config.json"),
      aliases: join("/h", "aliases.json"),
      logs: join("/h", "logs"),
      bin: join("/h", "bin"),
    });
  });

  it("uses CLAWD_HOME when set, else ~/.clawd", () => {
    expect(defaultHome({ CLAWD_HOME: "/custom" })).toBe("/custom");
    expect(defaultHome({ CLAWD_HOME: "  " })).toBe(join(homedir(), ".clawd"));
    expect(defaultHome({})).toBe(join(homedir(), ".clawd"));
  });

  it("finds Claude Code's user settings, honouring CLAUDE_CONFIG_DIR", () => {
    expect(defaultSettingsPath({ CLAUDE_CONFIG_DIR: "/cc" })).toBe(join("/cc", "settings.json"));
    expect(defaultSettingsPath({})).toBe(join(homedir(), ".claude", "settings.json"));
  });

  it("finds Claude Code's transcripts folder, honouring CLAUDE_CONFIG_DIR", () => {
    expect(defaultTranscriptsDir({ CLAUDE_CONFIG_DIR: "/cc" })).toBe(join("/cc", "projects"));
    expect(defaultTranscriptsDir({})).toBe(join(homedir(), ".claude", "projects"));
  });
});

describe("config", () => {
  const tempDir = useTempDirs();

  it("defaults to port 4750, an empty allowlist, local web origins and a fresh 64-hex token", () => {
    const a = defaultConfig();
    expect(a).toMatchObject({ version: 1, port: DEFAULT_PORT, allowlist: [], corsOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"], pollIntervalMs: 10_000, claudeCommand: "claude", logRetentionDays: 7 });
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(defaultConfig().token).not.toBe(a.token);
    expect(AgentConfigSchema.parse(a)).toEqual(a);
  });

  it("reads null when there is no file", async () => {
    expect(await readConfig(agentPaths(await tempDir()))).toBeNull();
  });

  it("creates the file on first load and returns the same token afterwards", async () => {
    const paths = agentPaths(await tempDir());
    const first = await loadOrCreateConfig(paths);
    const onDisk: unknown = JSON.parse(await readFile(paths.config, "utf8"));
    expect(onDisk).toEqual(first);
    expect((await loadOrCreateConfig(paths)).token).toBe(first.token);
  });

  it("round-trips a wrapped status line with fields it does not know", async () => {
    const paths = agentPaths(await tempDir());
    const config = { ...defaultConfig(), wrappedStatusLine: { type: "command", command: "~/.claude/statusline.sh", padding: 2, somethingNew: true } };
    await saveConfig(paths, config);
    expect(await readConfig(paths)).toEqual(config);
  });

  it("names the invalid fields but never their values", async () => {
    const paths = agentPaths(await tempDir());
    await writeFile(paths.config, JSON.stringify({ ...defaultConfig(), token: "SECRET-TOKEN-VALUE", port: "SECRET-PORT", allowList: ["x"] }));
    const err = await readConfig(paths).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const message = (err as Error).message;
    expect(message).toContain("token");
    expect(message).toContain("port");
    expect(message).toContain("allowList");
    expect(message).not.toContain("SECRET");
  });

  it("rejects a file that is not JSON", async () => {
    const paths = agentPaths(await tempDir());
    await writeFile(paths.config, "{");
    await expect(readConfig(paths)).rejects.toBeInstanceOf(ConfigError);
  });

  it("refuses to save an invalid config", async () => {
    const paths = agentPaths(await tempDir());
    await expect(saveConfig(paths, { ...defaultConfig(), port: 0 })).rejects.toThrow();
  });
});
