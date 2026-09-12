import { own } from "../own";

/** Display labels for sessions. Generated, never the session's own name. */
export const SESSION_LABELS = [
  "Otter", "Heron", "Badger", "Lynx", "Finch", "Vole", "Stoat", "Wren", "Pike", "Newt",
  "Marten", "Kestrel", "Hare", "Shrew", "Raven", "Adder", "Puffin", "Seal", "Fox", "Owl",
  "Crane", "Beaver", "Moth", "Robin", "Trout", "Weasel", "Swift", "Ibis", "Mole", "Gull",
  "Bittern", "Ermine", "Osprey", "Skylark", "Plover", "Dormouse", "Grouse", "Toad", "Carp", "Jay",
  "Curlew", "Lamprey", "Polecat", "Siskin", "Perch", "Chough", "Eel", "Elk", "Lark", "Bream",
  "Hoopoe", "Grebe", "Smelt", "Tern", "Auk", "Dace", "Roach", "Stint", "Teal", "Knot",
] as const;

/** Display labels for panes: trees. */
export const PANE_LABELS = [
  "Oak", "Elm", "Ash", "Birch", "Cedar", "Rowan", "Willow", "Hazel", "Alder", "Yew",
  "Larch", "Maple", "Beech", "Holly", "Pine", "Aspen", "Hawthorn", "Lime", "Poplar", "Spruce",
] as const;

export type AliasEntry = { alias: string; label: string };

/** Persisted by the agent as JSON; every function here returns a new map. */
export type AliasMap = {
  sessions: Record<string, AliasEntry>;
  panes: Record<string, AliasEntry>;
  nextSession: number;
  nextPane: number;
};

export function emptyAliasMap(): AliasMap {
  return { sessions: {}, panes: {}, nextSession: 1, nextPane: 1 };
}

function nextLabel(pool: readonly string[], taken: Iterable<string>): string {
  const used = new Set(taken);
  for (const name of pool) if (!used.has(name)) return name;
  for (let n = 2; ; n++) for (const name of pool) if (!used.has(`${name} ${n}`)) return `${name} ${n}`;
}

export function ensureSessionAlias(map: AliasMap, sessionId: string): { map: AliasMap; alias: string; label: string } {
  const existing = own(map.sessions, sessionId);
  if (existing) return { map, ...existing };
  const entry = { alias: `agent-${map.nextSession}`, label: nextLabel(SESSION_LABELS, Object.values(map.sessions).map((e) => e.label)) };
  return { map: { ...map, sessions: { ...map.sessions, [sessionId]: entry }, nextSession: map.nextSession + 1 }, ...entry };
}

export function ensurePaneAlias(map: AliasMap, paneKey: string): { map: AliasMap; alias: string; label: string } {
  const existing = own(map.panes, paneKey);
  if (existing) return { map, ...existing };
  const entry = { alias: `pane-${map.nextPane}`, label: nextLabel(PANE_LABELS, Object.values(map.panes).map((e) => e.label)) };
  return { map: { ...map, panes: { ...map.panes, [paneKey]: entry }, nextPane: map.nextPane + 1 }, ...entry };
}
