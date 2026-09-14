// The three HTTP calls the app makes to the agent, each validated with the shared schemas. `fetch`
// is injected so tests need no network.
import { CommandSchema, DEFAULT_AGENT_URL, ENDPOINTS, HealthSchema, TickerEventSchema, type Command, type Health, type TickerEvent } from "@clawd/core";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** The agent's base URL: NEXT_PUBLIC_AGENT_URL at build time, else the contract's default. No trailing slash. */
export function agentUrl(): string {
  return (process.env.NEXT_PUBLIC_AGENT_URL || DEFAULT_AGENT_URL).replace(/\/+$/, "");
}

export const PROBE_TIMEOUT_MS = 1500;

/** The agent's Health when it answers with a valid body within the timeout, else null. */
export async function probeHealth(base: string, fetchFn: FetchLike = defaultFetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<Health | null> {
  try {
    const res = await fetchFn(`${base}${ENDPOINTS.health}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const parsed = HealthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The last ticker lines the agent kept for a session; anything that does not validate is dropped. */
export async function fetchBackfill(base: string, alias: string, fetchFn: FetchLike = defaultFetch): Promise<TickerEvent[]> {
  try {
    const res = await fetchFn(`${base}${ENDPOINTS.ticker(encodeURIComponent(alias))}`);
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return [];
    const out: TickerEvent[] = [];
    for (const item of body) {
      const parsed = TickerEventSchema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}

/** Sends a Command; true when the agent accepted it with 202. */
export async function sendCommand(base: string, command: Command, fetchFn: FetchLike = defaultFetch): Promise<boolean> {
  const parsed = CommandSchema.safeParse(command);
  if (!parsed.success) return false;
  try {
    const res = await fetchFn(`${base}${ENDPOINTS.command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    return res.status === 202;
  } catch {
    return false;
  }
}
