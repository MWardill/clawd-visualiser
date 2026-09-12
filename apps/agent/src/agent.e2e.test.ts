import { DEFAULT_CONFIG, SnapshotSchema, StreamTickerMessageSchema, TickerEventSchema, parseFixture } from "@clawd/core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startAgent, type RunningAgent } from "./agent";
import { agentPaths, defaultConfig, saveConfig } from "./config";
import { createLogger } from "./log";
import type { Exec } from "./presence/poller";
import { openStream, parseSse, send, waitFor } from "./testing/http";
import { ALLOWED_ROOT, CANARY, OUTSIDE_CWD, rawAgentEntry, rawHook, rawSessionScript, rawStatus } from "./testing/raw";
import { useTempDirs } from "./testing/tmp";

describe("agent end to end", () => {
  const tempDir = useTempDirs();
  let agent: RunningAgent | null = null;

  afterEach(async () => {
    await agent?.stop();
    agent = null;
  });

  it("serves the contract, focuses a session, and lets no canary from any raw payload reach any sink", async () => {
    const home = await tempDir();
    const config = { ...defaultConfig(), allowlist: [ALLOWED_ROOT], pollIntervalMs: 1_000 };
    await saveConfig(agentPaths(home), config);
    const logged: string[] = [];
    let listed: unknown[] = [];
    const exec: Exec = async () => ({ ok: true, stdout: JSON.stringify(listed) });
    const focused: number[] = [];
    agent = await startAgent({
      home,
      port: 0,
      log: createLogger((line) => logged.push(line)),
      exec,
      // A long linger keeps the ended session in the snapshot however slowly the test machine runs.
      stateConfig: { ...DEFAULT_CONFIG, doneLingerMs: 60_000 },
      platform: "win32",
      runFocus: async ({ pid }) => {
        focused.push(pid);
        return "raised";
      },
    });
    const { port } = agent;
    const post = (path: string, body: unknown) =>
      send(port, { method: "POST", path, headers: { "content-type": "application/json", "x-clawd-token": config.token }, body: JSON.stringify(body) });

    const stream = await openStream(port);
    await stream.waitFor((text) => text.includes("event: snapshot"));

    for (const raw of rawSessionScript("e2e-one")) expect((await post("/ingest/hook", raw)).status).toBe(200);
    listed = [rawAgentEntry("e2e-two")];
    await post("/ingest/hook", rawHook("UserPromptSubmit", "e2e-two"));
    await post("/ingest/status", rawStatus("e2e-two"));
    await post("/ingest/hook", rawHook("UserPromptSubmit", "outside", { cwd: OUTSIDE_CWD }));
    await stream.waitFor((text) => text.includes('"contextPct":42'));

    const bodies: string[] = [];
    const snapshot = await send(port, { path: "/api/snapshot" });
    expect(SnapshotSchema.parse(JSON.parse(snapshot.body)).sessions.map((s) => s.alias)).toEqual(["agent-1", "agent-2"]);
    bodies.push(snapshot.body, (await send(port, { path: "/api/health" })).body);
    for (const alias of ["agent-1", "agent-2"]) {
      const reply = await send(port, { path: `/api/ticker/${alias}` });
      expect(reply.status).toBe(200);
      for (const line of JSON.parse(reply.body) as unknown[]) TickerEventSchema.parse(line);
      bodies.push(reply.body);
    }

    const command = await send(port, { method: "POST", path: "/api/command", headers: { "content-type": "application/json" }, body: '{"type":"focus","alias":"agent-2"}' });
    expect(command.status).toBe(202);
    await waitFor(() => focused.length === 1);
    expect(focused).toEqual([4242]);

    const messages = parseSse(stream.text());
    expect(messages.some((m) => m.event === "ticker")).toBe(true);
    for (const message of messages) {
      if (message.event === "snapshot") SnapshotSchema.parse(message.data);
      else if (message.event === "ticker") StreamTickerMessageSchema.parse(message.data);
      else throw new Error(`unexpected stream event ${message.event}`);
    }
    bodies.push(stream.text());
    stream.close();
    await agent.stop();
    agent = null;

    const logFiles: string[] = [];
    for (const name of await readdir(join(home, "logs"))) logFiles.push(await readFile(join(home, "logs", name), "utf8"));
    const events = logFiles.flatMap((text) => parseFixture(text).events);
    expect(events.some((e) => e.sessionId === "e2e-one" && e.kind === "session.end")).toBe(true);
    expect(events.some((e) => e.sessionId === "outside")).toBe(false);

    const sinks: [string, string][] = [
      ["stream and responses", bodies.join("\n")],
      ["event log", logFiles.join("\n")],
      ["aliases.json", await readFile(join(home, "aliases.json"), "utf8")],
      ["config.json", await readFile(join(home, "config.json"), "utf8")],
      ["stdout", logged.join("")],
    ];
    for (const [sink, text] of sinks) expect(text.includes(CANARY), `canary found in ${sink}`).toBe(false);
  }, 20_000);
});
