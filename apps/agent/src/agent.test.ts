import { SnapshotSchema, paneKey, parseFixture } from "@clawd/core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PortInUseError, startAgent } from "./agent";
import { agentPaths, defaultConfig, saveConfig } from "./config";
import { silentLogger } from "./log";
import type { Exec } from "./presence/poller";
import { createEventLog } from "./store/event-log";
import { ev } from "./testing/events";
import { send, waitFor } from "./testing/http";
import { ALLOWED_ROOT, SESSION_CWD, rawAgentEntry, rawHook } from "./testing/raw";
import { useTempDirs } from "./testing/tmp";

describe("startAgent", () => {
  const tempDir = useTempDirs();

  it("names panes after their folder by default, and keeps every folder name out when the config asks for generated names", async () => {
    for (const [paneLabels, label] of [["folder", "repo"], ["generated", "Oak"]] as const) {
      const home = await tempDir();
      const paths = agentPaths(home);
      const config = { ...defaultConfig(), allowlist: [ALLOWED_ROOT], paneLabels };
      await saveConfig(paths, config);
      const agent = await startAgent({ home, port: 0, exec: async () => ({ ok: true, stdout: "[]" }), log: silentLogger, platform: "linux", transcriptsDir: await tempDir() });
      try {
        await send(agent.port, { method: "POST", path: "/ingest/hook", headers: { "content-type": "application/json", "x-clawd-token": config.token }, body: JSON.stringify(rawHook("UserPromptSubmit", "s1")) });
        const snapshot = SnapshotSchema.parse(JSON.parse((await send(agent.port, { path: "/api/snapshot" })).body));
        expect(snapshot.panes.map((p) => p.label)).toEqual([label]);
      } finally {
        await agent.stop();
      }
      let logged = "";
      for (const name of await readdir(paths.logs)) logged += await readFile(join(paths.logs, name), "utf8");
      expect(logged.includes('"paneName":"repo"')).toBe(paneLabels === "folder");
    }
  });

  it("comes back from a restart showing what its sessions were doing, without the ones that ended meanwhile", async () => {
    const home = await tempDir();
    const paths = agentPaths(home);
    await saveConfig(paths, { ...defaultConfig(), allowlist: [ALLOWED_ROOT] });
    const now = Date.now();
    const key = paneKey(SESSION_CWD);
    const previousRun = createEventLog(paths.logs, { now: () => now, retentionDays: 7, log: silentLogger });
    previousRun.append(ev("prompt", now - 60_000, {}, "busy", key));
    previousRun.append(ev("tool.start", now - 50_000, { tool: "Bash", category: "run", toolUseId: "u1" }, "busy", key));
    previousRun.append(ev("prompt", now - 60_000, {}, "closed", key));
    await previousRun.flush();

    let polls = 0;
    const exec: Exec = async () => {
      polls++;
      return { ok: true, stdout: JSON.stringify([rawAgentEntry("busy")]) };
    };
    const agent = await startAgent({ home, port: 0, exec, log: silentLogger, platform: "linux", transcriptsDir: await tempDir() });
    try {
      const sessions = async () => SnapshotSchema.parse(JSON.parse((await send(agent.port, { path: "/api/snapshot" })).body)).sessions;
      await waitFor(() => polls > 0);
      await waitFor(async () => (await sessions()).length === 1);
      expect((await sessions())[0]).toMatchObject({ state: "working", activity: "run" });
    } finally {
      await agent.stop();
    }
    const logged: unknown[] = [];
    for (const name of await readdir(paths.logs)) logged.push(...parseFixture(await readFile(join(paths.logs, name), "utf8")).events);
    expect(logged).toHaveLength(3);
  });

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
