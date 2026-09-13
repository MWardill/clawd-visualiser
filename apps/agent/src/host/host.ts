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
  /** Sessions brought back by restore() that no poll has confirmed and no live event has touched. */
  private readonly restored = new Set<string>();
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
    if (this.accept(e, now, true)) this.refresh(now);
  }

  /**
   * Replays the event log at startup, each event at its recorded time, so sessions come back in the
   * state they were in when the agent stopped. Nothing is written back to the log. The log cannot
   * say which sessions closed while the agent was down, so what it brings back waits on the first
   * successful poll (settleRestored).
   */
  restore(events: readonly RedactedEvent[]): void {
    const now = this.deps.now();
    for (const e of events) this.accept(e, Math.min(e.t, now), false);
    this.tick();
    for (const id of Object.keys(this.fleet.sessions)) this.restored.add(id);
  }

  /**
   * Given the allowlisted ids of the first successful poll after a restore, removes the restored
   * sessions it does not list: they closed while the agent was down, so there is no exit to play and
   * no done state. A session heard from since the restore has proved itself and is kept. Only the
   * first call decides; later ones do nothing.
   */
  settleRestored(listed: ReadonlySet<string>): void {
    if (this.restored.size === 0) return;
    const drop = new Set([...this.restored].filter((id) => !listed.has(id)));
    this.restored.clear();
    if (![...drop].some((id) => this.session(id))) return;
    const sessions = Object.fromEntries(Object.entries(this.fleet.sessions).filter(([id]) => !drop.has(id)));
    const panes: Fleet["panes"] = {};
    for (const p of Object.values(this.fleet.panes)) {
      const sessionIds = p.sessionIds.filter((id) => !drop.has(id));
      if (sessionIds.length > 0) panes[p.paneKey] = { ...p, sessionIds };
    }
    this.fleet = { sessions, panes };
    for (const id of drop) {
      this.buffers.delete(id);
      this.lastAccepted.delete(id);
    }
    this.refresh(this.deps.now());
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
    const { snapshot, aliases } = deriveSnapshot(this.fleet, this.aliasMap, this.deps.now(), this.deps.config);
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

  /**
   * One event through §5.1, reduced at `now`. False when it was dropped as noise. A recorded event
   * is live: it goes to the log and proves its session alive. A restored one is neither.
   */
  private accept(e: RedactedEvent, now: number, record: boolean): boolean {
    if (this.isNoise(e, now)) return false;
    if (e.kind === "session.start") this.ended.delete(e.sessionId);
    const applied = applyEvent(this.fleet, e, now, this.deps.config);
    this.fleet = applied.fleet;
    if (endsSession(e)) this.ended.add(e.sessionId);
    this.lastAccepted.set(e.sessionId, { kind: e.kind, at: now });
    if (record) {
      this.restored.delete(e.sessionId);
      this.emit((l) => l.event?.(e));
    }
    for (const line of applied.ticker) this.pushTicker(e.sessionId, line);
    return true;
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
    const { snapshot, aliases } = deriveSnapshot(this.fleet, this.aliasMap, now, this.deps.config);
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
