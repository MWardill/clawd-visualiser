import { join } from "node:path";

/**
 * taskkill by its full path. Run by name, Windows would search the working directory and then PATH,
 * and whatever it found first would be handed a process id to end.
 */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32", "taskkill.exe");
}
