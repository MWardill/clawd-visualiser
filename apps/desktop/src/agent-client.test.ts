import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkToken, countsOf, fetchCounts, fetchSnapshot, probeHealth, sendFocus } from "./agent-client";
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
  it("is ok when the health endpoint answers ok, whatever else the body carries, and asks as the app's page would", async () => {
    let path = "";
    let origin: string | undefined;
    const port = await serve((req, res) => {
      path = req.url ?? "";
      origin = req.headers.origin;
      reply({ ok: true, version: "9.9.9", sessions: 2, somethingNewer: 1 })(req, res);
    });
    expect(await probeHealth(port)).toBe("ok");
    expect(path).toBe("/api/health");
    expect(origin).toBe("app://clawd");
  });

  it("is refused when an agent answers the app's origin with its own 403, and none for a 403 from anything else", async () => {
    expect(await probeHealth(await serve(reply({ error: "origin not allowed" }, 403)))).toBe("refused");
    expect(await probeHealth(await serve(reply("<html>forbidden</html>", 403)))).toBe("none");
    expect(await probeHealth(await serve(reply({ error: "something else" }, 403)))).toBe("none");
  });

  it("is none for an error status, a body that is not ok, a body that is not JSON, a closed port or a reply too slow", async () => {
    expect(await probeHealth(await serve(reply({ error: "not found" }, 404)))).toBe("none");
    expect(await probeHealth(await serve(reply({ ok: false })))).toBe("none");
    expect(await probeHealth(await serve(reply("<html>")))).toBe("none");
    expect(await probeHealth(await closedPort())).toBe("none");
    expect(await probeHealth(await serve(() => {}), 50)).toBe("none");
  });
});

describe("checkToken", () => {
  it("posts the token to the status ingest route with an empty body and no origin, and reads 200 as held and 401 as refused", async () => {
    const seen: { method?: string; url?: string; token?: string | string[]; origin?: string; length?: string } = {};
    const held = await serve((req, res) => {
      Object.assign(seen, { method: req.method, url: req.url, token: req.headers["x-clawd-token"], origin: req.headers.origin, length: req.headers["content-length"] });
      reply({})(req, res);
    });
    expect(await checkToken(held, "a".repeat(64))).toBe("held");
    expect(seen).toEqual({ method: "POST", url: "/ingest/status", token: "a".repeat(64), origin: undefined, length: "0" });
    expect(await checkToken(await serve(reply({}, 401)), "a".repeat(64))).toBe("refused");
  });

  it("is unknown for any other status, a closed port or a reply too slow", async () => {
    expect(await checkToken(await serve(reply({}, 403)), "t")).toBe("unknown");
    expect(await checkToken(await closedPort(), "t")).toBe("unknown");
    expect(await checkToken(await serve(() => {}), "t", 50)).toBe("unknown");
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

describe("fetchSnapshot", () => {
  it("is the agent's snapshot, and null for a body that is not one, an error status or nothing listening", async () => {
    const s = snapshot(["working", "idle"]);
    expect(await fetchSnapshot(await serve(reply(s)))).toEqual(s);
    expect(await fetchSnapshot(await serve(reply({ sessions: "many" })))).toBeNull();
    expect(await fetchSnapshot(await serve(reply(s, 500)))).toBeNull();
    expect(await fetchSnapshot(await closedPort())).toBeNull();
  });

  it("sends no Origin, so an agent that refuses the app's page still answers main", async () => {
    let origin: string | undefined = "unset";
    const port = await serve((req, res) => {
      origin = req.headers.origin;
      reply(snapshot([]))(req, res);
    });
    await fetchSnapshot(port);
    expect(origin).toBeUndefined();
  });
});

describe("sendFocus", () => {
  it("posts a focus command for the alias as JSON with no origin, and reads the agent's 202 as sent", async () => {
    const seen: { method?: string; url?: string; type?: string; origin?: string; body?: string } = {};
    const port = await serve((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        Object.assign(seen, { method: req.method, url: req.url, type: req.headers["content-type"], origin: req.headers.origin, body });
        res.writeHead(202);
        res.end();
      });
    });
    expect(await sendFocus(port, "agent-3")).toBe(true);
    expect(seen).toEqual({ method: "POST", url: "/api/command", type: "application/json", origin: undefined, body: JSON.stringify({ type: "focus", alias: "agent-3" }) });
  });

  it("is false when the agent does not know the alias, refuses, is not there, or is too slow", async () => {
    expect(await sendFocus(await serve(reply({ error: "unknown alias" }, 404)), "agent-9")).toBe(false);
    expect(await sendFocus(await serve(reply({ error: "origin not allowed" }, 403)), "agent-1")).toBe(false);
    expect(await sendFocus(await closedPort(), "agent-1")).toBe(false);
    expect(await sendFocus(await serve(() => {}), "agent-1", 50)).toBe(false);
  });
});
