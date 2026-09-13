import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USAGE } from "./cli";

const AGENT_DIR = fileURLToPath(new URL("..", import.meta.url));

describe("main entry point", () => {
  it("prints the whole usage text to stderr before exiting 2", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts", "no-such-command"], { cwd: AGENT_DIR, encoding: "utf8", windowsHide: true });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(`${USAGE}\n`);
  }, 30_000);
});
