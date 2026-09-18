import type { DetailLevel } from "@clawd/core";
import { agentPaths, defaultConfig, readConfig, saveConfig } from "./config";
import type { Print } from "./install/installer";

/** Writes the detail level to config.json, creating the file with defaults when there is none. */
export async function saveDetail(req: { home: string; level: DetailLevel }): Promise<void> {
  const paths = agentPaths(req.home);
  const base = (await readConfig(paths)) ?? defaultConfig();
  await saveConfig(paths, { ...base, detail: req.level });
}

/** The CLI's detail command: saves, then says so. */
export async function setDetail(req: { home: string; level: DetailLevel; print: Print }): Promise<number> {
  await saveDetail(req);
  req.print(`detail level set to ${req.level}; restart the agent for it to take effect`);
  return 0;
}
