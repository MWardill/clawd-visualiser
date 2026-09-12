import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startAgent, type RunningAgent } from "./agent";
import { agentPaths, defaultConfig, saveConfig } from "./config";
import { createLogger } from "./log";
import { openStream, send } from "./testing/http";
import { useTempDirs } from "./testing/tmp";

/**
 * Local only. Point CLAWD_SPIKE_DIR at the directory holding the raw spike recordings
 * (tools/hook-spike/*.jsonl, never committed). Every recorded body is posted to a real agent and
 * every sink is searched for every recorded path, prompt and tool payload string. Failures name the
 * field and the sink, never the value.
 */
const SPIKE_DIR = process.env.CLAWD_SPIKE_DIR;

const SECRET_KEYS = new Set([
  "cwd", "transcript_path", "agent_transcript_path", "prompt", "last_assistant_message", "session_name",
  "current_dir", "project_dir", "tool_input", "tool_response", "delta", "message", "description", "command", "error",
]);

type Recorded = { route: "/ingest/hook" | "/ingest/status"; body: unknown };

function recordedPayloads(text: string): Recorded[] {
  const out: Recorded[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let record: { url?: unknown; body?: unknown };
    try {
      record = JSON.parse(line) as { url?: unknown; body?: unknown };
    } catch {
      continue;
    }
    if (typeof record.url !== "string") continue;
    if (record.url.startsWith("/command-hook/")) {
      const payload = (record.body as { payload?: unknown } | undefined)?.payload;
      if (payload !== undefined) out.push({ route: record.url === "/command-hook/statusline" ? "/ingest/status" : "/ingest/hook", body: payload });
    } else {
      out.push({ route: "/ingest/hook", body: record.body });
    }
  }
  return out;
}

function secrets(value: unknown, field: string | null = null, out: { field: string; value: string }[] = []): { field: string; value: string }[] {
  if (typeof value === "string") {
    if (field !== null && value.length >= 8) out.push({ field, value });
  } else if (Array.isArray(value)) {
    for (const v of value) secrets(v, field, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) secrets(v, field ?? (SECRET_KEYS.has(k) ? k : null), out);
  }
  return out;
}

describe.runIf(Boolean(SPIKE_DIR))("raw spike recordings (local only)", () => {
  const tempDir = useTempDirs();
  let agent: RunningAgent | null = null;

  afterEach(async () => {
    await agent?.stop();
    agent = null;
  });

  it("leaks nothing recorded into any sink", async () => {
    const dir = SPIKE_DIR as string;
    const payloads: Recorded[] = [];
    for (const name of (await readdir(dir)).filter((n) => n.endsWith(".jsonl"))) payloads.push(...recordedPayloads(await readFile(join(dir, name), "utf8")));
    expect(payloads.length).toBeGreaterThan(0);
    const found = payloads.flatMap((p) => secrets(p.body));
    const cwds = [...new Set(payloads.map((p) => (p.body as { cwd?: unknown } | null)?.cwd).filter((c): c is string => typeof c === "string"))];
    expect(cwds.length).toBeGreaterThan(0);

    const home = await tempDir();
    const config = { ...defaultConfig(), allowlist: cwds };
    await saveConfig(agentPaths(home), config);
    const logged: string[] = [];
    agent = await startAgent({ home, port: 0, log: createLogger((l) => logged.push(l)), exec: async () => ({ ok: true, stdout: "[]" }), platform: "linux" });
    const { port } = agent;
    const stream = await openStream(port);
    for (const p of payloads) {
      await send(port, { method: "POST", path: p.route, headers: { "content-type": "application/json", "x-clawd-token": config.token }, body: JSON.stringify(p.body) });
    }
    const bodies = [(await send(port, { path: "/api/snapshot" })).body, (await send(port, { path: "/api/health" })).body];
    const aliasesText = await readFile(join(home, "aliases.json"), "utf8").catch(() => "{}");
    await agent.stop();
    agent = null;
    const aliasesAfter = await readFile(join(home, "aliases.json"), "utf8");
    const aliasNames = Object.values((JSON.parse(aliasesAfter) as { sessions: Record<string, { alias: string }> }).sessions).map((e) => e.alias);
    expect(aliasNames.length).toBeGreaterThan(0);
    bodies.push(stream.text());
    stream.close();
    const logs: string[] = [];
    for (const name of await readdir(join(home, "logs"))) logs.push(await readFile(join(home, "logs", name), "utf8"));

    const sinks: Record<string, string> = { stream: bodies.join("\n"), logs: logs.join("\n"), aliases: aliasesText + aliasesAfter, stdout: logged.join("") };
    const leaks = new Set<string>();
    for (const [sink, text] of Object.entries(sinks)) {
      for (const s of found) if (text.includes(s.value) || text.includes(JSON.stringify(s.value).slice(1, -1))) leaks.add(`${s.field} in ${sink}`);
    }
    expect([...leaks]).toEqual([]);
  }, 60_000);
});
