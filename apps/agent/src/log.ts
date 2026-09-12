/**
 * Operational logging. A closed set of codes and a record of numbers and booleans: there is no
 * parameter a string can travel through, so payload content, paths and error messages cannot be
 * logged. Strings are also dropped at runtime, in case a cast gets one past the type.
 */
export type LogCode =
  | "agent.started"
  | "agent.stopped"
  | "config.emptyAllowlist"
  | "ingest.counts"
  | "ingest.failed"
  | "presence.failed"
  | "privacy.blocked"
  | "store.aliasesRecovered"
  | "store.aliasesSaveFailed"
  | "store.logWriteFailed"
  | "store.retentionFailed"
  | "server.error"
  | "server.portInUse"
  | "stream.clientLimit"
  | "stream.slowClient"
  | "host.listenerFailed"
  | "focus.raised"
  | "focus.flashed"
  | "focus.noWindow"
  | "focus.failed"
  | "focus.notListed"
  | "focus.unsupported";

export type LogFields = Readonly<Record<string, number | boolean>>;
export type Logger = (code: LogCode, fields?: LogFields) => void;

export function createLogger(write: (line: string) => void = (line) => void process.stdout.write(line), now: () => number = Date.now): Logger {
  return (code, fields = {}) => {
    const kept: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (key === "t" || key === "code") continue;
      if (typeof value === "number" || typeof value === "boolean") kept[key] = value;
    }
    write(JSON.stringify({ t: new Date(now()).toISOString(), code, ...kept }) + "\n");
  };
}

export const silentLogger: Logger = () => {};
