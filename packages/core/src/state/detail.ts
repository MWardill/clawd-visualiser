// How an event's detail becomes the session's: the copied fields, and the subject of a tool call.
import type { SessionDetail, Subject } from "../schema/detail";
import type { RedactedEvent } from "../schema/events";

/** What a tool event is about, as far as its detail says: the file (or its extension), the program, the host, the agent. */
export function subjectOf(e: RedactedEvent): Subject | undefined {
  if (e.detail === undefined || !("category" in e)) return undefined;
  const d = e.detail;
  switch (e.category) {
    case "read":
    case "edit": {
      const text = d.file ?? d.ext;
      return text === undefined ? undefined : { kind: "file", text };
    }
    case "run":
      return d.program === undefined ? undefined : { kind: "program", text: d.program };
    case "web":
      return d.host === undefined ? undefined : { kind: "host", text: d.host };
    case "spawn": {
      const text = d.description ?? d.agent;
      return text === undefined ? undefined : { kind: "agent", text };
    }
    case "other":
      return undefined;
    default:
      e.category satisfies never;
      return undefined;
  }
}

/**
 * Folds an event's detail into the session's: the session-wide fields whenever an event carries
 * them, the subject on a tool start only, so it names the newest call and survives its end.
 * Returns `prev` itself when nothing changed.
 */
export function mergeSessionDetail(prev: SessionDetail, e: RedactedEvent): SessionDetail {
  const d = e.detail;
  if (d === undefined) return prev;
  let next = prev;
  if (d.permissionMode !== undefined && d.permissionMode !== next.permissionMode) next = { ...next, permissionMode: d.permissionMode };
  if (d.shells !== undefined && d.shells !== next.shells) next = { ...next, shells: d.shells };
  if (d.name !== undefined && d.name !== next.name) next = { ...next, name: d.name };
  if (d.dir !== undefined && d.dir !== next.dir) next = { ...next, dir: d.dir };
  if (e.kind === "tool.start") {
    const subject = subjectOf(e);
    if (subject !== undefined && (next.subject?.kind !== subject.kind || next.subject.text !== subject.text)) next = { ...next, subject };
  }
  return next;
}
