import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { countsOf, fetchCounts, probeHealth } from "./agent-client";
import { snapshot } from "./testing/snapshot";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** A server on a free port, closed after the test. */
async function serve(handler: Handler): Promise<number> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  return (server.address() as AddressInfo).port;
}

/** A port that was free a moment ago and has nothing listening now. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const reply =
  (body: unknown, status = 200): Handler =>
  (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

describe("countsOf", () => {
  it("counts every session and those waiting", () => {
    expect(countsOf(snapshot(["working", "waiting", "idle", "waiting"]))).toEqual({ sessions: 4, waiting: 2 });
    expect(countsOf(snapshot([]))).toEqual({ sessions: 0, waiting: 0 });
  });
});

describe("probeHealth", () => {
  it("is true when the health endpoint answers ok, whatever else the body carries", async () => {
    let path = "";
    const port = await serve((req, res) => {
      path = req.url ?? "";
      reply({ ok: true, version: "9.9.9", sessions: 2, somethingNewer: 1 })(req, res);
    });
    expect(await probeHealth(port)).toBe(true);
    expect(path).toBe("/api/health");
  });

  it("is false for an error status, a body that is not ok, a body that is not JSON, a closed port or a reply too slow", async () => {
    expect(await probeHealth(await serve(reply({ error: "not found" }, 404)))).toBe(false);
    expect(await probeHealth(await serve(reply({ ok: false })))).toBe(false);
    expect(await probeHealth(await serve(reply("<html>")))).toBe(false);
    expect(await probeHealth(await closedPort())).toBe(false);
    expect(await probeHealth(await serve(() => {}), 50)).toBe(false);
  });
});

describe("fetchCounts", () => {
  it("counts from the agent's snapshot", async () => {
    const port = await serve((req, res) => (req.url === "/api/snapshot" ? reply(snapshot(["waiting", "working"])) : reply({}, 404))(req, res));
    expect(await fetchCounts(port)).toEqual({ sessions: 2, waiting: 1 });
  });

  it("is null when the reply is not a snapshot or nothing answers", async () => {
    expect(await fetchCounts(await serve(reply({ version: 2 })))).toBeNull();
    expect(await fetchCounts(await closedPort())).toBeNull();
  });
});
