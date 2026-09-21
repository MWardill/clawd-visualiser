// Snapshots while attached. The app's own agent hands main every snapshot as it is made; an agent
// the app is only attached to (the CLI's, say) does not, and the host asks it for counts every ten
// seconds, which is too slow to draw from. While widgets are shown this asks it for the snapshot
// every second instead. Electron-free, with the fetch injected.
import type { Snapshot } from "@clawd/core";
import type { HostState } from "./agent-host";
import type { View } from "./desktop-state";

export const ATTACHED_FEED_MS = 1_000;

/** The port to ask: only while attached, and only while something draws from snapshots main would otherwise lack. */
export function feedPort(host: Pick<HostState, "mode" | "port">, view: View): number | null {
  return host.mode === "attached" && view === "widgets" ? host.port : null;
}

export type AttachedFeedDeps = {
  /** The snapshot of the agent on the port, or null. */
  fetch(port: number): Promise<Snapshot | null>;
  onSnapshot(s: Snapshot, port: number): void;
  intervalMs?: number;
};

export type AttachedFeed = {
  /** Ask this port from now on, or nobody. The same port again changes nothing. */
  watch(port: number | null): void;
  stop(): void;
};

export function createAttachedFeed(deps: AttachedFeedDeps): AttachedFeed {
  const interval = deps.intervalMs ?? ATTACHED_FEED_MS;
  let watched: number | null = null;
  /** Which watch is current, so an answer to an earlier one is dropped. */
  let turn = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const ask = async (mine: number, port: number): Promise<void> => {
    let s: Snapshot | null = null;
    try {
      s = await deps.fetch(port);
    } catch {
      // No answer this time.
    }
    if (mine !== turn) return;
    if (s !== null) deps.onSnapshot(s, port);
    // Timed from the answer, so a slow agent never has two requests out.
    timer = setTimeout(() => {
      timer = null;
      void ask(mine, port);
    }, interval);
  };

  const watch = (port: number | null): void => {
    if (port === watched) return;
    watched = port;
    turn++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (port !== null) void ask(turn, port);
  };

  return { watch, stop: () => watch(null) };
}
