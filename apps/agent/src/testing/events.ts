import type { RedactedEvent } from "@clawd/core";

/** 12 September 2026 10:00 UTC. */
export const T0 = 1_757_671_200_000;

type Kind = RedactedEvent["kind"];
type Extra<K extends Kind> = Omit<Extract<RedactedEvent, { kind: K }>, "v" | "t" | "sessionId" | "paneKey" | "kind">;

/** A typed redacted event for tests: the kind decides which extra fields are required. */
export function ev<K extends Kind>(kind: K, t: number, extra: Extra<K>, sessionId = "s1", paneKey = "pane-key-1"): RedactedEvent {
  return { v: 1, t, sessionId, paneKey, kind, ...extra } as RedactedEvent;
}
