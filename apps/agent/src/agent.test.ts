import { describe, expect, it } from "vitest";
import { PortInUseError, startAgent } from "./agent";
import { agentPaths, defaultConfig, saveConfig } from "./config";
import { silentLogger } from "./log";
import type { Exec } from "./presence/poller";
import { useTempDirs } from "./testing/tmp";

describe("startAgent", () => {
  const tempDir = useTempDirs();

  it("rejects with a PortInUseError naming the port when it is already in use", async () => {
    const exec: Exec = async () => ({ ok: true, stdout: "[]" });

    const homeA = await tempDir();
    await saveConfig(agentPaths(homeA), { ...defaultConfig(), allowlist: [] });
    const agentA = await startAgent({ home: homeA, port: 0, exec, log: silentLogger, platform: "linux" });

    try {
      const homeB = await tempDir();
      await saveConfig(agentPaths(homeB), { ...defaultConfig(), allowlist: [] });

      let caught: unknown;
      try {
        await startAgent({ home: homeB, port: agentA.port, exec, log: silentLogger, platform: "linux" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PortInUseError);
      expect((caught as PortInUseError).port).toBe(agentA.port);
    } finally {
      await agentA.stop();
    }
  });
});
