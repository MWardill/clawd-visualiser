import { DEFAULT_CONFIG, HealthSchema, SnapshotSchema, StreamTickerMessageSchema, TickerEventSchema, parseFixture } from "@clawd/core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startAgent, type RunningAgent } from "./agent";
import { agentPaths, defaultConfig, saveConfig } from "./config";
import { createLogger } from "./log";
import type { Exec } from "./presence/poller";
import { openStream, parseSse, send, waitFor } from "./testing/http";
import { ALLOWED_ROOT, CANARY, LOCAL_ONLY, OUTSIDE_CWD, SESSION_CWD, rawAgentEntry, rawHook, rawSessionScript, rawStatus } from "./testing/raw";
import { useTempDirs } from "./testing/tmp";

describe("agent end to end", () => {
  const tempDir = useTempDirs();
  let agent: RunningAgent | null = null;

  afterEach(async () => {
    await agent?.stop();
    agent = null;
  });

  it.each(["none", "hints", "paths"] as const)("serves the contract, focuses a session, and lets no canary reach any sink at level %s", async (level) => {
    const home = await tempDir();
    const config = { ...defaultConfig(), allowlist: [ALLOWED_ROOT], pollIntervalMs: 1_000, detail: level };
    await saveConfig(agentPaths(home), config);
    const logged: string[] = [];
    let listed: unknown[] = [];
    let polls = 0;
    const exec: Exec = async () => {
      polls += 1;
      return { ok: true, stdout: JSON.stringify(listed) };
    };
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

    // A session with no status line: its name can only come from the agents list, so it must be listed before its first hook.
    const sessionCount = async () => HealthSchema.parse(JSON.parse((await send(port, { path: "/api/health" })).body)).sessions;
    const before = await sessionCount();
    listed = [rawAgentEntry("e2e-two"), rawAgentEntry("e2e-three", { name: "LOCALONLY listed name" })];
    await waitFor(async () => (await sessionCount()) === before + 1, 5_000);
    await post("/ingest/hook", rawHook("UserPromptSubmit", "e2e-three"));
    await stream.waitFor((text) => text.includes('"alias":"agent-3"'));

    // Hook first, no status line: the session is known before any poll lists it, so only a presence for a known session can bring its listed name.
    await post("/ingest/hook", rawHook("UserPromptSubmit", "e2e-four"));
    await stream.waitFor((text) => text.includes('"alias":"agent-4"'));
    const updatedAtOfFour = async () => SnapshotSchema.parse(JSON.parse((await send(port, { path: "/api/snapshot" })).body)).sessions.find((s) => s.alias === "agent-4")?.updatedAt;
    const hookedAt = await updatedAtOfFour();
    expect(hookedAt).toBeDefined();
    listed = [rawAgentEntry("e2e-two"), rawAgentEntry("e2e-three", { name: "LOCALONLY listed name" }), rawAgentEntry("e2e-four", { name: "LOCALONLY hook-first name" })];
    // The poll that starts next after the change is the first that can only read the new list; it has finished once the one after it starts.
    const pollsAtChange = polls;
    await waitFor(() => polls >= pollsAtChange + 2, 5_000);
    expect(await updatedAtOfFour(), "a presence moved the hook-first session's updatedAt").toBe(hookedAt);

    const bodies: string[] = [];
    const snapshot = await send(port, { path: "/api/snapshot" });
    expect(SnapshotSchema.parse(JSON.parse(snapshot.body)).sessions.map((s) => s.alias)).toEqual(["agent-1", "agent-2", "agent-3", "agent-4"]);
    expect(SnapshotSchema.parse(JSON.parse(snapshot.body)).panes.map((p) => p.label)).toEqual(["repo"]);
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
    expect(events.filter((e) => e.sessionId === "e2e-four" && e.kind === "presence"), "presence lines for the hook-first session").toHaveLength(level === "paths" ? 1 : 0);

    const sinks: [string, string][] = [
      ["stream and responses", bodies.join("\n")],
      ["event log", logFiles.join("\n")],
      ["aliases.json", await readFile(join(home, "aliases.json"), "utf8")],
      ["config.json", await readFile(join(home, "config.json"), "utf8")],
      ["stdout", logged.join("")],
    ];
    for (const [sink, text] of sinks) expect(text.includes(CANARY), `canary found in ${sink}`).toBe(false);
    for (const [sink, text] of sinks.slice(1)) expect(text.includes(LOCAL_ONLY), `local-only string found in ${sink}`).toBe(false);
    const responses = sinks[0]![1];
    expect(responses.includes(LOCAL_ONLY), "local-only strings in responses").toBe(level === "paths");
    expect(responses.includes('"detail":{'), "detail objects in responses").toBe(level !== "none");
    if (level === "none") expect(responses.includes('"detail'), "no detail text in responses at level none").toBe(false);
    expect(responses.includes("LOCALONLY listed name"), "agents-list name in responses").toBe(level === "paths");
    expect(responses.includes("LOCALONLY hook-first name"), "hook-first session's agents-list name in responses").toBe(level === "paths");
    const parsed = SnapshotSchema.parse(JSON.parse(snapshot.body));
    if (level === "paths") {
      expect(parsed.sessions[3]?.detail).toMatchObject({ name: "LOCALONLY hook-first name", dir: SESSION_CWD });
      expect(parsed.sessions[2]?.detail).toMatchObject({ name: "LOCALONLY listed name", dir: SESSION_CWD });
      expect(parsed.sessions[1]?.detail).toMatchObject({ name: "LOCALONLY session name", dir: SESSION_CWD, permissionMode: "default" });
      expect(parsed.sessions[0]?.detail?.subject).toEqual({ kind: "file", text: "src/LOCALONLY-secret.ts" });
      expect(parsed.panes[0]?.detail).toEqual({ dir: SESSION_CWD });
    }
    if (level === "hints") expect(parsed.sessions[0]?.detail).toEqual({ permissionMode: "default", shells: 1, subject: { kind: "file", text: "ts" } });
  }, 20_000);
});
