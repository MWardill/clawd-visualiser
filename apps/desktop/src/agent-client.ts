// What the main process asks of an agent it does not own: is it there, and how many sessions has
// it? Plain HTTP to 127.0.0.1, as any client of the agent would. Neither function ever rejects.
import { TOKEN_HEADER } from "@clawd/agent";
import { DESKTOP_ORIGIN, ENDPOINTS, SnapshotSchema, type Snapshot } from "@clawd/core";
import { request } from "node:http";

export type Counts = { sessions: number; waiting: number };

/** An agent that has not answered its health check in this long counts as not there. */
export const PROBE_TIMEOUT_MS = 500;
const COUNTS_TIMEOUT_MS = 2_000;

export function countsOf(s: Snapshot): Counts {
  return { sessions: s.sessions.length, waiting: s.sessions.filter((session) => session.state === "waiting").length };
}

async function getJson(port: number, path: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/** What answered on the port: an agent that lets this app's page in, an agent that refuses it, or nothing of use. */
export type Probe = "ok" | "refused" | "none";

/**
 * Asks the health endpoint as the app's page would, with its origin. `ok` when it answers `ok: true`
 * in time; only `ok` is read, so a newer agent with more fields still counts. `refused` when it
 * answers the agent's own 403 for an origin it does not know: an agent started before it learned
 * `app://clawd`, which the page cannot talk to. Never rejects.
 */
export async function probeHealth(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<Probe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${ENDPOINTS.health}`, { headers: { origin: DESKTOP_ORIGIN }, signal: AbortSignal.timeout(timeoutMs) });
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return "none";
    if (res.status === 403) return (body as { error?: unknown }).error === "origin not allowed" ? "refused" : "none";
    return res.ok && (body as { ok?: unknown }).ok === true ? "ok" : "none";
  } catch {
    return "none";
  }
}

/** The session counts of the agent on the port, or null when it does not answer with a snapshot. */
export async function fetchCounts(port: number, timeoutMs = COUNTS_TIMEOUT_MS): Promise<Counts | null> {
  try {
    const parsed = SnapshotSchema.safeParse(await getJson(port, ENDPOINTS.snapshot, timeoutMs));
    return parsed.success ? countsOf(parsed.data) : null;
  } catch {
    return null;
  }
}

/** Whether the agent on the port holds a token: it does, it refuses it, or it did not say. */
export type TokenCheck = "held" | "refused" | "unknown";

/** The agent's status-line ingest route, which answers 401 to a token it does not hold and 200 otherwise. */
const INGEST_STATUS_PATH = "/ingest/status";

/**
 * Asks the agent on the port whether it holds this token, the way a hook script would: a POST with
 * the token header, an empty body, and no Origin, which the ingest routes refuse outright. The agent
 * counts the empty body as one bad one in its `ingest.counts`. Over `node:http`, as the hook scripts
 * are, so nothing adds a header. Never rejects.
 */
export function checkToken(port: number, token: string, timeoutMs = COUNTS_TIMEOUT_MS): Promise<TokenCheck> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path: INGEST_STATUS_PATH, headers: { [TOKEN_HEADER]: token, "content-length": "0" }, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? "held" : res.statusCode === 401 ? "refused" : "unknown");
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve("unknown"));
    req.end();
  });
}
