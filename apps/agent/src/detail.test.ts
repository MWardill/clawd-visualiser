import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentPaths, readConfig } from "./config";
import { saveDetail, setDetail } from "./detail";
import { useTempDirs } from "./testing/tmp";

describe("saveDetail", () => {
  const tempDir = useTempDirs();

  it("writes the level, creating the config with defaults when there is none, and keeps the rest", async () => {
    const home = join(await tempDir(), "clawd");
    await saveDetail({ home, level: "paths" });
    const created = await readConfig(agentPaths(home));
    expect(created?.detail).toBe("paths");
    expect(created?.token).toMatch(/^[0-9a-f]{64}$/);
    await saveDetail({ home, level: "none" });
    const again = await readConfig(agentPaths(home));
    expect(again?.detail).toBe("none");
    expect(again?.token).toBe(created?.token);
  });

  it("the CLI's setDetail saves and says so", async () => {
    const home = join(await tempDir(), "clawd");
    const lines: string[] = [];
    expect(await setDetail({ home, level: "hints", print: (line) => lines.push(line) })).toBe(0);
    expect((await readConfig(agentPaths(home)))?.detail).toBe("hints");
    expect(lines.join("\n")).toContain("hints");
  });
});
