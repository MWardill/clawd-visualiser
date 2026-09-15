// What the main process asks of an agent it does not own: is it there, and how many sessions has
// it? Plain HTTP to 127.0.0.1, as any client of the agent would. Neither function ever rejects.
import { ENDPOINTS, SnapshotSchema, type Snapshot } from "@clawd/core";

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

/**
 * True when an agent's health endpoint on the port answers `ok: true` in time. Only `ok` is read,
 * so a newer agent with more fields still counts as an agent.
 */
export async function probeHealth(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const body = await getJson(port, ENDPOINTS.health, timeoutMs);
    return typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
  } catch {
    return false;
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
