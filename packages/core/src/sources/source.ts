import type { RedactedEvent } from "../schema/events";

export type Sink = (e: RedactedEvent) => void;

/** Anything that produces redacted events. `start` returns a function that stops it. */
export interface Source {
  start(sink: Sink): () => void;
}
