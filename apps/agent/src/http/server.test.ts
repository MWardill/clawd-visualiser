import { DEFAULT_CONFIG, HealthSchema, SnapshotSchema, emptyAliasMap, type Snapshot } from "@clawd/core";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetHost } from "../host/host";
import { silentLogger } from "../log";
import { T0 } from "../testing/events";
import { openStream, send, waitFor } from "../testing/http";
import { ALLOWED_ROOT, CANARY, LOCAL_ONLY, SESSION_CWD, rawHook, rawStatus } from "../testing/raw";
import { AGENT_VERSION } from "../version";
import { createAgentServer, newIngestCounts, type ServerDeps, type ServerHost } from "./server";
import { createStreamHub, type StreamHub } from "./sse";

const TOKEN = "a".repeat(64);
const WEB = "http://localhost:3000";
const running: { server: Server; stream: StreamHub }[] = [];

afterEach(async () => {
  for (const { server, stream } of running.splice(0)) {
    stream.closeAll();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function start(over: Partial<ServerDeps> = {}) {
  const clock = { now: T0 };
  const host = new FleetHost({ now: () => clock.now, config: DEFAULT_CONFIG, aliases: emptyAliasMap(), log: silentLogger });
  const stream = createStreamHub({ current: () => host.snapshot(), log: silentLogger });
  host.on({ snapshot: (s) => stream.snapshot(s), ticker: (m) => stream.ticker(m) });
  const focus = vi.fn();
  const log = vi.fn();
  const counts = newIngestCounts();
  const server = createAgentServer({
    host,
    config: { allowlist: [ALLOWED_ROOT], token: TOKEN, corsOrigins: [WEB] },
    stream,
    focus,
    now: () => clock.now,
    log,
    counts,
    sensitive: () => [],
    ...over,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running.push({ server, stream });
  return { port: (server.address() as AddressInfo).port, host, focus, log, counts };
}

const json = { "content-type": "application/json" };
const hook = (port: number, body: unknown, headers: Record<string, string> = {}) =>
  send(port, { method: "POST", path: "/ingest/hook", headers: { ...json, "x-clawd-token": TOKEN, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("ingest routes", () => {
  it("answers a hook with 200 {} and feeds the redacted event to the host", async () => {
    const { port, host, counts } = await start();
    const reply = await hook(port, rawHook("UserPromptSubmit", "s1"));
    expect(reply.status).toBe(200);
    expect(reply.body).toBe("{}");
    expect(reply.headers["content-type"]).toContain("application/json");
    expect(reply.body).not.toContain(CANARY);
    await waitFor(() => host.sessionCount() === 1);
    expect(counts.accepted).toBe(1);
  });

  it("feeds a status line payload through the status route", async () => {
    const { port, host } = await start();
    const reply = await send(port, { method: "POST", path: "/ingest/status", headers: { ...json, "x-clawd-token": TOKEN }, body: JSON.stringify(rawStatus("s1")) });
    expect(reply.status).toBe(200);
    await waitFor(() => host.sessionCount() === 1);
  });

  it("refuses a wrong or missing token with 401 {} and counts it", async () => {
    const { port, host, counts } = await start();
    expect((await hook(port, rawHook("UserPromptSubmit", "s1"), { "x-clawd-token": "b".repeat(64) })).status).toBe(401);
    const missing = await send(port, { method: "POST", path: "/ingest/hook", headers: json, body: JSON.stringify(rawHook("UserPromptSubmit", "s1")) });
    expect(missing.status).toBe(401);
    expect(missing.body).toBe("{}");
    expect(counts.unauthorised).toBe(2);
    expect(host.sessionCount()).toBe(0);
  });

  it("refuses any request with an Origin, any method but POST, and unknown ingest paths", async () => {
    const { port } = await start();
    expect((await hook(port, rawHook("UserPromptSubmit", "s1"), { origin: WEB })).status).toBe(403);
    expect((await send(port, { path: "/ingest/hook", headers: { "x-clawd-token": TOKEN } })).status).toBe(405);
    expect((await send(port, { method: "POST", path: "/ingest/other", headers: { "x-clawd-token": TOKEN }, body: "{}" })).status).toBe(404);
  });

  it("counts bad JSON and over-limit bodies but still answers 200", async () => {
    const { port, host, counts } = await start({ limits: { hook: 1_024 } });
    expect((await hook(port, "{ not json")).status).toBe(200);
    expect((await hook(port, rawHook("UserPromptSubmit", "s1", { prompt: "x".repeat(2_000) }))).status).toBe(200);
    await waitFor(() => counts.badJson === 1 && counts.tooLarge === 1);
    expect(host.sessionCount()).toBe(0);
  });

  it("counts payloads redaction drops", async () => {
    const { port, counts } = await start();
    await hook(port, rawHook("MessageDisplay", "s1", { delta: "CANARY" }));
    await waitFor(() => counts.dropped === 1);
  });
});

describe("guards", () => {
  it("refuses a forged Host header", async () => {
    const { port } = await start();
    expect((await send(port, { path: "/api/health", headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await send(port, { path: "/api/health", headers: { host: `localhost:${port}` } })).status).toBe(200);
  });

  it("gives an allowed origin CORS headers and refuses any other origin outright", async () => {
    const { port } = await start();
    const allowed = await send(port, { path: "/api/health", headers: { origin: WEB } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(WEB);
    expect(allowed.headers.vary).toBe("Origin");
    expect((await send(port, { path: "/api/health", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await send(port, { path: "/api/stream", headers: { origin: "https://evil.example" } })).status).toBe(403);
    const none = await send(port, { path: "/api/health" });
    expect(none.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers an allowed preflight, including private network access", async () => {
    const { port } = await start();
    const reply = await send(port, {
      method: "OPTIONS",
      path: "/api/command",
      headers: { origin: WEB, "access-control-request-method": "POST", "access-control-request-private-network": "true" },
    });
    expect(reply.status).toBe(204);
    expect(reply.headers).toMatchObject({
      "access-control-allow-origin": WEB,
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": "content-type",
      "access-control-allow-private-network": "true",
    });
    expect((await send(port, { method: "OPTIONS", path: "/api/command", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });
});

describe("api routes", () => {
  it("serves the snapshot", async () => {
    const { port } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    const reply = await send(port, { path: "/api/snapshot" });
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(SnapshotSchema.parse(JSON.parse(reply.body)).sessions).toHaveLength(1);
    expect(reply.body).not.toContain(CANARY);
    expect(reply.body).not.toContain(LOCAL_ONLY);
  });

  it("serves health", async () => {
    const { port } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    const reply = await send(port, { path: "/api/health" });
    expect(HealthSchema.parse(JSON.parse(reply.body))).toEqual({ ok: true, version: AGENT_VERSION, sessions: 1 });
  });

  it("serves a session's ticker backfill and 404 for an unknown alias", async () => {
    const { port, host } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    await waitFor(() => host.sessionCount() === 1);
    const reply = await send(port, { path: "/api/ticker/agent-1" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual([{ t: new Date(T0).toISOString(), kind: "prompt" }]);
    expect((await send(port, { path: "/api/ticker/agent-9" })).status).toBe(404);
    expect((await send(port, { path: "/api/ticker/%E0%A4%A" })).status).toBe(404);
  });

  it("streams the snapshot on connect and ticker lines as they happen", async () => {
    const { port } = await start();
    const stream = await openStream(port);
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    await stream.waitFor((text) => text.includes("event: snapshot"));
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    await stream.waitFor((text) => text.includes("event: ticker"));
    expect(stream.text()).not.toContain(CANARY);
    expect(stream.text()).not.toContain(LOCAL_ONLY);
    stream.close();
  });

  it("accepts a ping and a focus for a known alias with 202 and runs the focus after answering", async () => {
    const { port, host, focus } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    await waitFor(() => host.sessionCount() === 1);
    const ping = await send(port, { method: "POST", path: "/api/command", headers: json, body: '{"type":"ping"}' });
    expect(ping.status).toBe(202);
    expect(ping.body).toBe("");
    const reply = await send(port, { method: "POST", path: "/api/command", headers: json, body: '{"type":"focus","alias":"agent-1"}' });
    expect(reply.status).toBe(202);
    expect(focus).toHaveBeenCalledWith("s1");
  });

  it("refuses bad commands", async () => {
    const { port, focus } = await start();
    const post = (body: string, headers: Record<string, string> = json) => send(port, { method: "POST", path: "/api/command", headers, body });
    expect((await post('{"type":"ping"}', {})).status).toBe(415);
    expect((await post('{"type":"ping"}', { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("{")).status).toBe(400);
    expect((await post('{"type":"reboot"}')).status).toBe(400);
    expect((await post('{"type":"focus","alias":"agent-404"}')).status).toBe(404);
    expect((await post(JSON.stringify({ type: "ping", pad: "x".repeat(5_000) }))).status).toBe(413);
    expect((await send(port, { path: "/api/command" })).status).toBe(405);
    expect(focus).not.toHaveBeenCalled();
  });

  it("answers 404 for unknown paths and 405 for the wrong method", async () => {
    const { port } = await start();
    expect((await send(port, { path: "/nope" })).status).toBe(404);
    expect((await send(port, { path: "/api/nope" })).status).toBe(404);
    expect((await send(port, { method: "POST", path: "/api/snapshot", headers: json, body: "{}" })).status).toBe(405);
  });

  it("refuses to send a body that carries a forbidden key or a live directory", async () => {
    const base: Snapshot = { version: 1, generatedAt: new Date(T0).toISOString(), panes: [], sessions: [] };
    const stub = (snapshot: Snapshot): ServerHost => ({ ingest: vi.fn(), snapshot: () => snapshot, tickerFor: () => null, sessionIdFor: () => null, sessionCount: () => 0 });
    const a = await start({ host: stub({ ...base, ext: { prompt: "x" } }) });
    expect((await send(a.port, { path: "/api/snapshot" })).status).toBe(500);
    expect(a.log).toHaveBeenCalledWith("privacy.blocked");
    const b = await start({ host: stub({ ...base, panes: [{ pane: "pane-1", label: "C:/work/CANARY-repo" }] }), sensitive: () => ["C:/work/CANARY-repo"] });
    const reply = await send(b.port, { path: "/api/snapshot" });
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain(CANARY);
  });

  it("checks error bodies too, not only successful ones", async () => {
    const { port, log } = await start({ sensitive: () => ["origin not allowed"] });
    const reply = await send(port, { path: "/api/health", headers: { origin: "https://evil.example" } });
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain("origin not allowed");
    expect(log).toHaveBeenCalledWith("privacy.blocked");
  });

  it("still acknowledges hooks with {} when a live directory is configured", async () => {
    const { port } = await start({ sensitive: () => ["C:/work/CANARY-repo"] });
    const reply = await hook(port, rawHook("UserPromptSubmit", "s1"));
    expect(reply.status).toBe(200);
    expect(reply.body).toBe("{}");
  });
});

describe("detail level", () => {
  it("reports the level in health and lets detail through the sink check", async () => {
    const { port } = await start({ config: { allowlist: [ALLOWED_ROOT], token: TOKEN, corsOrigins: [WEB], detail: "paths" }, sensitive: () => [SESSION_CWD] });
    expect(HealthSchema.parse(JSON.parse((await send(port, { path: "/api/health" })).body)).detailLevel).toBe("paths");
    await hook(port, rawHook("PreToolUse", "s1", { tool_name: "Write", tool_use_id: "t1" }));
    await waitFor(async () => (await send(port, { path: "/api/snapshot" })).body.includes(LOCAL_ONLY));
    const snapshot = SnapshotSchema.parse(JSON.parse((await send(port, { path: "/api/snapshot" })).body));
    expect(snapshot.sessions[0]?.detail).toMatchObject({ dir: SESSION_CWD, subject: { kind: "file", text: "src/LOCALONLY-secret.ts" } });
    expect(snapshot.panes[0]?.detail).toEqual({ dir: SESSION_CWD });
  });

  it("defaults to none: no detail key and no local string in any response", async () => {
    const { port } = await start({ sensitive: () => [SESSION_CWD] });
    const health = await send(port, { path: "/api/health" });
    expect(HealthSchema.parse(JSON.parse(health.body))).not.toHaveProperty("detailLevel");
    expect(health.body).not.toContain("detail");
    await hook(port, rawHook("PreToolUse", "s1", { tool_name: "Write", tool_use_id: "t1" }));
    await waitFor(async () => (await send(port, { path: "/api/snapshot" })).body.includes("agent-1"));
    const body = (await send(port, { path: "/api/snapshot" })).body;
    expect(body).not.toContain("detail");
    expect(body).not.toContain(LOCAL_ONLY);
  });
});
