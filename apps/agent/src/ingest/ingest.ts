import { redact, type IngestContext, type RedactedEvent } from "@clawd/core";

/**
 * Hooks core does not model but whose meaning it already has. A tool that errors still ends its
 * call, and a turn that ends in an API error still ends the turn. Renamed before redaction, so
 * every other field still goes through redact(). Candidates to move into core.
 */
const FAILURE_HOOKS: Readonly<Record<string, string>> = { PostToolUseFailure: "PostToolUse", StopFailure: "Stop" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A raw hook payload to a redacted event, or null. Status line payloads are refused here. */
export function ingestHook(raw: unknown, ctx: IngestContext): RedactedEvent | null {
  if (!isPlainObject(raw)) return null;
  const name = raw.hook_event_name;
  if (typeof name !== "string") return null;
  const renamed = Object.hasOwn(FAILURE_HOOKS, name) ? FAILURE_HOOKS[name] : undefined;
  const event = redact(renamed ? { ...raw, hook_event_name: renamed } : raw, ctx);
  return event && event.kind !== "status" && event.kind !== "presence" ? event : null;
}

/** A raw status line payload to a `status` event, or null. Hook payloads are refused here. */
export function ingestStatus(raw: unknown, ctx: IngestContext): RedactedEvent | null {
  if (!isPlainObject(raw) || "hook_event_name" in raw) return null;
  const event = redact(raw, ctx);
  return event?.kind === "status" ? event : null;
}

export function parseJson(body: Buffer): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body.toString("utf8")) as unknown };
  } catch {
    return { ok: false };
  }
}
