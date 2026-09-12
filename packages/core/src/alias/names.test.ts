import { describe, expect, it } from "vitest";
import { SESSION_LABELS, emptyAliasMap, ensurePaneAlias, ensureSessionAlias } from "./names";

describe("aliases", () => {
  it("assigns a stable alias and label per session id, never reusing a live label", () => {
    const a = ensureSessionAlias(emptyAliasMap(), "s1");
    const b = ensureSessionAlias(a.map, "s2");
    const again = ensureSessionAlias(b.map, "s1");
    expect(a.alias).toBe("agent-1");
    expect(b.alias).toBe("agent-2");
    expect(again.alias).toBe("agent-1");
    expect(again.label).toBe(a.label);
    expect(a.label).not.toBe(b.label);
  });

  it("suffixes labels once the list is exhausted", () => {
    let map = emptyAliasMap();
    for (let i = 0; i < SESSION_LABELS.length; i++) map = ensureSessionAlias(map, `s${i}`).map;
    const extra = ensureSessionAlias(map, "overflow");
    expect(extra.label).toMatch(/ 2$/);
  });

  it("aliases panes separately and does not mutate the input map", () => {
    const start = emptyAliasMap();
    const p = ensurePaneAlias(start, "k1");
    expect(p.alias).toBe("pane-1");
    expect(p.label).toBeTruthy();
    expect(start).toEqual(emptyAliasMap());
    expect(ensureSessionAlias(p.map, "s1").alias).toBe("agent-1");
  });
  it("does not mutate the input map when aliasing a session", () => {
    const start = emptyAliasMap();
    ensureSessionAlias(start, "s1");
    expect(start).toEqual(emptyAliasMap());
  });
});
