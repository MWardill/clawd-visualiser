import {
  StreamTickerMessageSchema,
  TICKER_BACKFILL,
  TickerEventSchema,
  applyEvent,
  deriveSnapshot,
  emptyFleet,
  ensureSessionAlias,
  tickFleet,
  type AliasMap,
  type Fleet,
  type RedactedEvent,
  type SessionPhase,
  type SessionState,
  type Snapshot,
  type StateConfig,
  type StreamTickerMessage,
  type TickerEvent,
} from "@clawd/core";
import type { Logger } from "../log";

export type SessionView = { paneKey: string; state: SessionPhase; firstSeenAt: number; lastEventAt: number };

export type HostListener = {
  /** An accepted redacted event, for the event log. */
  event?(e: RedactedEvent): void;
  ticker?(m: StreamTickerMessage): void;
  /** Only when the snapshot changed, ignoring generatedAt. */
  snapshot?(s: Snapshot): void;
  /** Only when a session or pane was given a new alias. */
  aliases?(map: AliasMap): void;
};

export type HostDeps = { now: () => number; config: StateConfig; aliases: AliasMap; log: Logger };

/** A second SessionStart this soon after the first is the other hook type reporting the same start. */
export const DUPLICATE_START_MS = 5_000;

const endsSession = (e: RedactedEvent): boolean => e.kind === "session.end" || (e.kind === "presence" && !e.alive);

/**
 * The one owner of agent state: the fleet, the alias map, the ticker buffers and the ended set.
 * No I/O; everything leaves through listeners.
 */
export class FleetHost {
  private fleet: Fleet = emptyFleet();
  private aliasMap: AliasMap;
  private readonly buffers = new Map<string, TickerEvent[]>();
  private readonly lastAccepted = new Map<string, { kind: RedactedEvent["kind"]; at: number }>();
  private readonly ended = new Set<string>();
  private readonly listeners = new Set<HostListener>();
  private lastSnapshotKey: string | null = null;
  private readonly deps: HostDeps;

  constructor(deps: HostDeps) {
    this.deps = deps;
    this.aliasMap = deps.aliases;
  }

  on(listener: HostListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ingest(e: RedactedEvent): void {
    const now = this.deps.now();
    if (this.isNoise(e, now)) return;
    if (e.kind === "session.start") this.ended.delete(e.sessionId);
    const applied = applyEvent(this.fleet, e, now, this.deps.config);
    this.fleet = applied.fleet;
    if (endsSession(e)) this.ended.add(e.sessionId);
    this.lastAccepted.set(e.sessionId, { kind: e.kind, at: now });
    this.emit((l) => l.event?.(e));
    for (const line of applied.ticker) this.pushTicker(e.sessionId, line);
    this.refresh(now);
  }

  tick(): void {
    const now = this.deps.now();
    const before = this.fleet.sessions;
    this.fleet = tickFleet(this.fleet, now, this.deps.config);
    for (const [id, prev] of Object.entries(before)) {
      const next = this.session(id);
      if (!next) {
        this.buffers.delete(id);
        this.lastAccepted.delete(id);
        continue;
      }
      // tickFleet has no event, so toTickerEvents cannot describe its transitions; the line carries only the state.
      if (next.state !== prev.state) this.pushTicker(id, TickerEventSchema.parse({ t: new Date(now).toISOString(), kind: "state", state: next.state }));
    }
    this.refresh(now);
  }

  snapshot(): Snapshot {
    const { snapshot, aliases } = deriveSnapshot(this.fleet, this.aliasMap, this.deps.now());
    this.setAliases(aliases);
    return snapshot;
  }

  tickerFor(alias: string): TickerEvent[] | null {
    const id = this.sessionIdFor(alias);
    return id === null ? null : [...(this.buffers.get(id) ?? [])];
  }

  sessionIdFor(alias: string): string | null {
    for (const [id, entry] of Object.entries(this.aliasMap.sessions)) if (entry.alias === alias) return id;
    return null;
  }

  sessions(): ReadonlyMap<string, SessionView> {
    const views = new Map<string, SessionView>();
    for (const s of Object.values(this.fleet.sessions)) {
      views.set(s.sessionId, { paneKey: s.paneKey, state: s.state, firstSeenAt: s.firstSeenAt, lastEventAt: s.lastEventAt });
    }
    return views;
  }

  sessionCount(): number {
    return Object.keys(this.fleet.sessions).length;
  }

  endedIds(): ReadonlySet<string> {
    return new Set(this.ended);
  }

  /** Forget ended ids the latest successful poll no longer lists: they cannot come back through presence. */
  forgetEnded(listed: ReadonlySet<string>): void {
    for (const id of [...this.ended]) if (!listed.has(id)) this.ended.delete(id);
  }

  aliases(): AliasMap {
    return this.aliasMap;
  }

  private session(id: string): SessionState | undefined {
    return Object.hasOwn(this.fleet.sessions, id) ? this.fleet.sessions[id] : undefined;
  }

  /** Events that would add noise but no information (spec §5.1). */
  private isNoise(e: RedactedEvent, now: number): boolean {
    if (e.kind === "session.start") {
      const last = this.lastAccepted.get(e.sessionId);
      return this.session(e.sessionId) !== undefined && last?.kind === "session.start" && now - last.at < DUPLICATE_START_MS;
    }
    if (this.ended.has(e.sessionId)) return true;
    const existing = this.session(e.sessionId);
    if (e.kind === "status" && existing) {
      return e.contextPct === undefined || (existing.contextPct !== null && Math.round(e.contextPct) === Math.round(existing.contextPct));
    }
    return false;
  }

  private pushTicker(sessionId: string, line: TickerEvent): void {
    const named = ensureSessionAlias(this.aliasMap, sessionId);
    this.setAliases(named.map);
    const buffer = this.buffers.get(sessionId) ?? [];
    buffer.push(line);
    if (buffer.length > TICKER_BACKFILL) buffer.splice(0, buffer.length - TICKER_BACKFILL);
    this.buffers.set(sessionId, buffer);
    const message = StreamTickerMessageSchema.safeParse({ alias: named.alias, event: line });
    if (message.success) this.emit((l) => l.ticker?.(message.data));
  }

  private refresh(now: number): void {
    const { snapshot, aliases } = deriveSnapshot(this.fleet, this.aliasMap, now);
    this.setAliases(aliases);
    const key = JSON.stringify({ ...snapshot, generatedAt: "" });
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.emit((l) => l.snapshot?.(snapshot));
  }

  private setAliases(map: AliasMap): void {
    if (map === this.aliasMap) return;
    this.aliasMap = map;
    this.emit((l) => l.aliases?.(map));
  }

  private emit(call: (listener: HostListener) => void): void {
    for (const listener of [...this.listeners]) {
      try {
        call(listener);
      } catch {
        this.deps.log("host.listenerFailed");
      }
    }
  }
}
