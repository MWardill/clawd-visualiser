import { DetailLevelSchema, type DetailLevel } from "@clawd/core";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonAtomic } from "./json-file";

export const DEFAULT_PORT = 4750;

export type AgentPaths = { home: string; config: string; aliases: string; logs: string; bin: string };

export function agentPaths(home: string): AgentPaths {
  return { home, config: join(home, "config.json"), aliases: join(home, "aliases.json"), logs: join(home, "logs"), bin: join(home, "bin") };
}

/** `CLAWD_HOME` when set, else `~/.clawd`. */
export function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CLAWD_HOME?.trim();
  return fromEnv ? fromEnv : join(homedir(), ".clawd");
}

/** Claude Code's user directory: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`. */
function claudeDir(env: NodeJS.ProcessEnv): string {
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  return dir ? dir : join(homedir(), ".claude");
}

/** Claude Code's user settings file. */
export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeDir(env), "settings.json");
}

/** Where Claude Code keeps session transcripts, one folder per project. */
export function defaultTranscriptsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeDir(env), "projects");
}

/** The user's previous status line, kept verbatim so uninstall can put it back exactly. */
export const WrappedStatusLineSchema = z.looseObject({ command: z.string().min(1) });
export type WrappedStatusLine = z.infer<typeof WrappedStatusLineSchema>;

export const AgentConfigSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(1).max(65_535),
    allowlist: z.array(z.string()),
    token: z.string().regex(/^[0-9a-f]{64}$/),
    corsOrigins: z.array(z.url()),
    pollIntervalMs: z.number().int().min(1_000),
    claudeCommand: z.string().min(1),
    logRetentionDays: z.number().int().min(1),
    wrappedStatusLine: WrappedStatusLineSchema.optional(),
    paneLabels: z.enum(["folder", "generated"]).optional(),
    /** How much of each session's activity the local view may show (detail levels design §2). Absent means none. */
    detail: DetailLevelSchema.optional(),
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Whether panes are named after their directory's last segment: yes, unless `paneLabels` is "generated". */
export function usesFolderPaneLabels(config: Pick<AgentConfig, "paneLabels">): boolean {
  return config.paneLabels !== "generated";
}

/** The configured detail level; none unless set. */
export function detailLevel(config: Pick<AgentConfig, "detail">): DetailLevel {
  return config.detail ?? "none";
}

export function defaultConfig(token: string = randomBytes(32).toString("hex")): AgentConfig {
  return {
    version: 1,
    port: DEFAULT_PORT,
    allowlist: [],
    token,
    // Added to the built-in origins (http/guards.ts), which need no entry here.
    corsOrigins: [],
    pollIntervalMs: 10_000,
    claudeCommand: "claude",
    logRetentionDays: 7,
    paneLabels: "folder",
    detail: "none",
  };
}

/** A config file that exists but cannot be used. The message names fields, never their values. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** The config, or null when the file does not exist yet. */
export async function readConfig(paths: AgentPaths): Promise<AgentConfig | null> {
  const file = await readJsonFile(paths.config);
  if (!file.found) return null;
  if (!file.ok) throw new ConfigError(`${paths.config} is not valid JSON`);
  const parsed = AgentConfigSchema.safeParse(file.value);
  if (parsed.success) return parsed.data;
  const where = parsed.error.issues.map((issue) =>
    issue.code === "unrecognized_keys" ? `unknown ${issue.keys.join(", ")}` : issue.path.map(String).join(".") || "(root)",
  );
  throw new ConfigError(`${paths.config} is invalid at: ${[...new Set(where)].join("; ")}`);
}

/** The config, created with defaults and a fresh token when it does not exist. */
export async function loadOrCreateConfig(paths: AgentPaths): Promise<AgentConfig> {
  const existing = await readConfig(paths);
  if (existing) return existing;
  const config = defaultConfig();
  await saveConfig(paths, config);
  return config;
}

export async function saveConfig(paths: AgentPaths, config: AgentConfig): Promise<void> {
  await writeJsonAtomic(paths.config, AgentConfigSchema.parse(config));
}
