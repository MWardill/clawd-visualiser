import { DEFAULT_AGENT_URL, ENDPOINTS } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { agentUrl, fetchBackfill, probeHealth, sendCommand, type FetchLike } from "./agent";

const BASE = "http://127.0.0.1:4750";
const T = "2026-09-12T10:04:31.000Z";

function respond(body: unknown, status = 200): FetchLike {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function recording(status = 202) {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push({ input, init });
    return new Response(null, { status });
  };
  return { calls, fetchFn };
}

describe("agent helpers", () => {
  it("uses the core default URL when no environment override is set", () => {
    expect(agentUrl()).toBe(DEFAULT_AGENT_URL);
  });

  it("probes health and returns the Health body only when it validates", async () => {
    expect(await probeHealth(BASE, respond({ ok: true, version: "0.1.0", sessions: 2 }))).toEqual({ ok: true, version: "0.1.0", sessions: 2 });
    expect(await probeHealth(BASE, respond({ ok: true, version: "0.1.0", sessions: 2, detail: "paths" }))).toMatchObject({ detail: "paths" });
    expect(await probeHealth(BASE, respond({ ok: true, version: "0.1.0", sessions: 2, extra: 1 }))).toBeNull();
    expect(await probeHealth(BASE, respond({ ok: true }, 500))).toBeNull();
    expect(await probeHealth(BASE, async () => { throw new TypeError("refused"); })).toBeNull();
  });

  it("hits the health endpoint of the base it is given", async () => {
    const { calls, fetchFn } = recording(200);
    await probeHealth(BASE, fetchFn);
    expect(calls[0]?.input).toBe(`${BASE}${ENDPOINTS.health}`);
  });

  it("backfills only the ticker events that validate", async () => {
    const good = { t: T, kind: "prompt" };
    const bad = { t: T, kind: "prompt", prompt: "secret" };
    const events = await fetchBackfill(BASE, "agent-1", respond([good, bad, { nonsense: true }]));
    expect(events).toEqual([good]);
    expect(await fetchBackfill(BASE, "agent-1", respond({ not: "an array" }))).toEqual([]);
    expect(await fetchBackfill(BASE, "agent-1", respond([], 404))).toEqual([]);
    const { calls, fetchFn } = recording(200);
    await fetchBackfill(BASE, "agent-1", fetchFn);
    expect(calls[0]?.input).toBe(`${BASE}${ENDPOINTS.ticker("agent-1")}`);
  });

  it("posts a focus command as JSON and reads 202 as accepted", async () => {
    const { calls, fetchFn } = recording(202);
    expect(await sendCommand(BASE, { type: "focus", alias: "agent-1" }, fetchFn)).toBe(true);
    expect(calls[0]?.input).toBe(`${BASE}${ENDPOINTS.command}`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ type: "focus", alias: "agent-1" });
    expect(await sendCommand(BASE, { type: "focus", alias: "agent-1" }, recording(500).fetchFn)).toBe(false);
    expect(await sendCommand(BASE, { type: "focus", alias: "agent-1" }, async () => { throw new TypeError("refused"); })).toBe(false);
  });
});
