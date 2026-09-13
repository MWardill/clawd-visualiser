# Folder Pane Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label each pane with its working directory's last path segment, numbered on collision, behind an agent setting that selects generated tree names.

**Architecture:** Redaction adds an optional `paneName` (the last segment only) to the event envelope when asked. The fleet keeps each pane's latest name, and `deriveSnapshot` turns names into labels, falling back to the alias map's trees. The agent's `paneLabels` config drives redaction, the poller's `history` events and the host's state config.

**Tech Stack:** TypeScript, zod 4, vitest, pnpm workspaces (`@clawd/core`, `@clawd/agent`).

**Spec:** `docs/superpowers/specs/2026-09-13-folder-pane-labels-design.md`

## Global Constraints

- A pane name is one path segment: 1 to 255 characters, no `/` or `\`. Nothing else of a path is kept.
- `IngestContext.paneNames` defaults to off, so fixtures and golden snapshots do not change.
- Agent config `paneLabels`: `"folder"` (default, also when absent) or `"generated"`. With `"generated"` no name is kept on any event or shown in any snapshot.
- Collisions compare names without case and number in order of first sight: `visualiser`, `visualiser 2`.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.

---

### Task 1: Core names panes

**Files:**
- Modify: `packages/core/src/alias/pane.ts`, `packages/core/src/schema/events.ts`, `packages/core/src/ingest/redact.ts`, `packages/core/src/state/fleet.ts`, `packages/core/src/state/config.ts`, `packages/core/src/state/snapshot.ts`, `packages/core/src/testing/events.ts`
- Test: `packages/core/src/alias/pane-name.test.ts` (new), `packages/core/src/schema/events.test.ts`, `packages/core/src/ingest/redact.test.ts`, `packages/core/src/state/fleet.test.ts`, `packages/core/src/state/snapshot.test.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Produces: `paneName(cwd: string): string | null`; `RedactedEvent.paneName?: string`; `IngestContext.paneNames?: boolean`; `PaneState.name: string | null`; `StateConfig.folderPaneLabels: boolean`; test helper `EventIds.paneName?: string`.

- [ ] **Step 1: Write the failing tests**

`pane-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { paneName } from "./pane";

describe("paneName", () => {
  it("keeps only the last segment of a directory, as written", () => {
    expect(paneName("C:\\mw\\visualiser")).toBe("visualiser");
    expect(paneName("c:/mw/Visualiser-Agent/")).toBe("Visualiser-Agent");
    expect(paneName("/home/me/work/repo")).toBe("repo");
    expect(paneName("C:\\mw\\visualiser\\\\")).toBe("visualiser");
  });

  it("names nothing for a bare root, an empty path or an impossibly long segment", () => {
    for (const cwd of ["C:\\", "C:", "/", "", "\\\\"]) expect(paneName(cwd)).toBeNull();
    expect(paneName(`C:/work/${"x".repeat(256)}`)).toBeNull();
  });
});
```

`events.test.ts`:

```ts
  it("carries a pane name only as a single directory name", () => {
    expect(RedactedEventSchema.parse({ ...base, kind: "prompt", paneName: "visualiser" })).toMatchObject({ paneName: "visualiser" });
    for (const paneName of ["", "mw/visualiser", "mw\\visualiser", "x".repeat(256)]) {
      expect(() => RedactedEventSchema.parse({ ...base, kind: "prompt", paneName })).toThrow();
    }
  });
```

`redact.test.ts`, a new describe and a presence test:

```ts
describe("pane names", () => {
  const named = { ...ctx, paneNames: true };

  it("keeps the directory's last segment on every event when asked, and nothing else of the path", () => {
    for (const payload of Object.values(raw)) {
      const event = redact(payload, named);
      if (!event) continue;
      expect(event.paneName).toBe("visualiser");
      expect(containsForbidden(event, [cwd, "C:\\mw", "mw\\visualiser"])).toBeNull();
    }
    expect(redact(raw.prompt, ctx)).not.toHaveProperty("paneName");
  });
});
```

```ts
  it("keeps the directory's last segment on a presence only when asked", () => {
    expect(redactPresence(entry, true, { ...ctx, paneNames: true })).toMatchObject({ paneName: "visualiser" });
    expect(redactPresence(entry, true, ctx)).not.toHaveProperty("paneName");
  });
```

`fleet.test.ts`:

```ts
  it("names a pane from the latest event that carries a pane name, and keeps it through events that carry none", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    expect(f.panes["k1"]?.name).toBeNull();
    f = reduceFleet(f, event("stop", T0 + 1, { backgroundTasks: 0 }, { sessionId: "s1", paneKey: "k1", paneName: "visualiser" }), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 2, {}, { sessionId: "s2", paneKey: "k1" }), T0 + 2, DEFAULT_CONFIG);
    expect(f.panes["k1"]).toMatchObject({ name: "visualiser", sessionIds: ["s1", "s2"] });
  });
```

`snapshot.test.ts`:

```ts
  it("labels a pane with its directory name, numbering a later pane of the same name, and falls back to trees", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1", paneName: "visualiser" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 1, {}, { sessionId: "s2", paneKey: "k2", paneName: "Visualiser" }), T0 + 1, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0 + 2, {}, { sessionId: "s3", paneKey: "k3" }), T0 + 2, DEFAULT_CONFIG);
    expect(deriveSnapshot(f, emptyAliasMap(), T0 + 10).snapshot.panes.map((p) => p.label)).toEqual(["visualiser", "Visualiser 2", "Ash"]);
  });

  it("shows only generated pane labels when the config turns directory names off", () => {
    const f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1", paneName: "visualiser" }), T0, DEFAULT_CONFIG);
    const { snapshot } = deriveSnapshot(f, emptyAliasMap(), T0 + 10, { ...DEFAULT_CONFIG, folderPaneLabels: false });
    expect(snapshot.panes.map((p) => p.label)).toEqual(["Oak"]);
    expect(JSON.stringify(snapshot)).not.toContain("visualiser");
  });
```

`index.test.ts`: add `"paneName"` after `"paneKey"`. `testing/events.ts`: `EventIds` gains `paneName?: string`, spread into the event when set.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/core && npx vitest run`
Expected: FAIL. `paneName` is not exported; the strict schema refuses `paneName`; panes have no `name`; labels are trees.

- [ ] **Step 3: Implement**

`pane.ts`:

```ts
/**
 * The last segment of a working directory as written, for a pane's label: `visualiser` for
 * `C:\mw\visualiser`. Null when the path names no directory, such as a bare drive root, or when the
 * segment is longer than a directory name can be. The result never holds a separator.
 */
export function paneName(cwd: string): string | null {
  const last = cwd.split(/[\\/]+/).filter((segment) => segment.length > 0).at(-1);
  return last === undefined || last.endsWith(":") || last.length > 255 ? null : last;
}
```

`events.ts`, in `base`:

```ts
  // The working directory's last segment, for the pane's label, when the agent keeps it. Never a
  // path: the schema refuses separators.
  paneName: z.string().min(1).max(255).regex(/^[^\\/]+$/).optional(),
```

`redact.ts`: `IngestContext` gains `paneNames?: boolean`; `envelope` adds the name:

```ts
  const name = ctx.paneNames === true ? paneName(cwd) : null;
  return { v: EVENT_SCHEMA_VERSION, t: ctx.now, sessionId, paneKey: paneKey(cwd), ...(name === null ? {} : { paneName: name }) };
```

`fleet.ts`:

```ts
export type PaneState = { paneKey: string; firstSeenAt: number; sessionIds: string[]; name: string | null };

function withSession(f: Fleet, s: SessionState, name: string | undefined): Fleet {
  const pane = own(f.panes, s.paneKey) ?? { paneKey: s.paneKey, firstSeenAt: s.firstSeenAt, sessionIds: [], name: null };
  const joined = pane.sessionIds.includes(s.sessionId);
  const renamed = name !== undefined && name !== pane.name;
  const panes = joined && !renamed ? f.panes : { ...f.panes, [s.paneKey]: { ...pane, sessionIds: joined ? pane.sessionIds : [...pane.sessionIds, s.sessionId], ...(renamed ? { name } : {}) } };
  return { sessions: { ...f.sessions, [s.sessionId]: s }, panes };
}
```

and `reduceFleet` passes `e.paneName`.

`config.ts`: `folderPaneLabels: boolean` in `StateConfig`, `true` in `DEFAULT_CONFIG`.

`snapshot.ts`:

```ts
function folderLabels(f: Fleet): Map<string, string> {
  const labels = new Map<string, string>();
  const taken = new Map<string, number>();
  const named = Object.values(f.panes)
    .filter((p): p is PaneState & { name: string } => p.name !== null)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt || (a.paneKey < b.paneKey ? -1 : a.paneKey > b.paneKey ? 1 : 0));
  for (const p of named) {
    const key = p.name.toLowerCase();
    const n = (taken.get(key) ?? 0) + 1;
    taken.set(key, n);
    labels.set(p.paneKey, n === 1 ? p.name : `${p.name} ${n}`);
  }
  return labels;
}
```

and in `deriveSnapshot`: `const folders = cfg.folderPaneLabels ? folderLabels(f) : new Map<string, string>();`, label `folders.get(p.paneKey) ?? r.label`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: PASS, with golden snapshots unchanged.

- [ ] **Step 5: Docs and commit**

Core design: `paneName` in the envelope, `IngestContext.paneNames`, `PaneState.name`, folder labels in §5.4 and §6.

```bash
git add packages/core docs/superpowers/specs/2026-09-12-core-contract-design.md
git commit -m "feat(core): panes take their directory's last segment as a label when events carry it"
```

### Task 2: The agent keeps pane names by default

**Files:**
- Modify: `apps/agent/src/config.ts`, `apps/agent/src/http/server.ts`, `apps/agent/src/presence/reconcile.ts`, `apps/agent/src/presence/poller.ts`, `apps/agent/src/agent.ts`, `apps/agent/src/testing/raw.ts`
- Test: `apps/agent/src/presence/reconcile.test.ts`, `apps/agent/src/presence/poller.test.ts`, `apps/agent/src/agent.test.ts`, `apps/agent/src/agent.e2e.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `AgentConfig.paneLabels?: "folder" | "generated"`; `usesFolderPaneLabels(config): boolean`; `ReconcileInput.paneNames?: boolean`; poller dependency `paneNames?: boolean`.

- [ ] **Step 1: Write the failing tests**

`testing/raw.ts`: `CANARY_CWD = "C:/work/CANARY-parent/repo"`, so the kept segment carries no canary.

`reconcile.test.ts`:

```ts
  it("keeps the directory's last segment on a first-sight presence when pane names are on, and nothing more of the path", () => {
    const [named] = reconcile(input({ entries: [rawAgentEntry("s1")], paneNames: true }));
    expect(named).toMatchObject({ kind: "presence", paneName: "repo" });
    expect(JSON.stringify(named)).not.toContain(CANARY);
    expect(reconcile(input({ entries: [rawAgentEntry("s1")] }))[0]).not.toHaveProperty("paneName");
  });
```

`poller.test.ts`: `setup(readTranscript?, paneNames = false)` passing `...(paneNames ? { paneNames } : {})`, and:

```ts
  it("names a restored pane on the history it sends, when pane names are on", async () => {
    const t = setup(async () => ({ lastWriteAt: T0, prompts: 12 }), true);
    t.host.restore([ev("prompt", T0 - 1_000, {}, "s1", paneKey(CANARY_CWD))]);
    t.list(rawAgentEntry("s1"));
    await t.poller.pollOnce();
    expect(t.host.snapshot().panes.map((p) => p.label)).toEqual(["repo"]);
  });
```

`agent.test.ts`:

```ts
  it("names panes after their folder by default, and keeps every folder name out when the config asks for generated names", async () => {
    for (const [paneLabels, label] of [["folder", "repo"], ["generated", "Oak"]] as const) {
      const home = await tempDir();
      const paths = agentPaths(home);
      const config = { ...defaultConfig(), allowlist: [ALLOWED_ROOT], paneLabels };
      await saveConfig(paths, config);
      const agent = await startAgent({ home, port: 0, exec: async () => ({ ok: true, stdout: "[]" }), log: silentLogger, platform: "linux", transcriptsDir: await tempDir() });
      try {
        await send(agent.port, { method: "POST", path: "/ingest/hook", headers: { "content-type": "application/json", "x-clawd-token": config.token }, body: JSON.stringify(rawHook("UserPromptSubmit", "s1")) });
        const snapshot = SnapshotSchema.parse(JSON.parse((await send(agent.port, { path: "/api/snapshot" })).body));
        expect(snapshot.panes.map((p) => p.label)).toEqual([label]);
      } finally {
        await agent.stop();
      }
      let logged = "";
      for (const name of await readdir(paths.logs)) logged += await readFile(join(paths.logs, name), "utf8");
      expect(logged.includes('"paneName":"repo"')).toBe(paneLabels === "folder");
    }
  });
```

`agent.e2e.test.ts`: expect the snapshot's pane labels to equal `["repo"]`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/agent && npx vitest run`
Expected: FAIL. No `paneName` from reconcile or history; the config refuses `paneLabels`; the pane label is a tree.

- [ ] **Step 3: Implement**

`config.ts`: `paneLabels: z.enum(["folder", "generated"]).optional()` in the schema, `paneLabels: "folder"` in `defaultConfig()`, and:

```ts
/** Whether panes are named after their directory's last segment: yes, unless `paneLabels` is "generated". */
export function usesFolderPaneLabels(config: Pick<AgentConfig, "paneLabels">): boolean {
  return config.paneLabels !== "generated";
}
```

`server.ts`: the config pick adds `"paneLabels"`; the ingest context is `{ now: deps.now(), allowlist: deps.config.allowlist, paneNames: usesFolderPaneLabels(deps.config) }`.

`reconcile.ts`: `paneNames?: boolean` on the input; `const ctx = { now: input.now, allowlist: input.allowlist, paneNames: input.paneNames === true };`.

`poller.ts`: `paneNames?: boolean` dependency; the allowed loop records each id's `cwd`; reconcile gets `paneNames: deps.paneNames === true`; the history event gets `...(name === null ? {} : { paneName: name })` where `name = deps.paneNames === true ? paneName(cwdOf.get(id) ?? "") : null`.

`agent.ts`: `const folderLabels = usesFolderPaneLabels(config);` the host's config is `{ ...(opts.stateConfig ?? DEFAULT_CONFIG), folderPaneLabels: folderLabels }`, and the poller gets `paneNames: folderLabels`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/agent && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Docs and commit**

Agent design: privacy rule on the kept segment, §4.3 context, §6.2 and §6.4 names, §7.2 `paneLabels`, §13 tests.

```bash
git add apps/agent docs/superpowers/specs/2026-09-12-local-agent-design.md
git commit -m "feat(agent): name panes after their folder by default, with a paneLabels setting for generated names"
```

### Task 3: Verify and merge

- [ ] **Step 1:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build` in the worktree.
- [ ] **Step 2:** Run the branch against a temporary copy of `~/.clawd` and compare its pane labels with the last segments of the listed sessions' directories.
- [ ] **Step 3:** Merge `feat/folder-pane-labels` into main with `--no-ff`, rerun Step 1 on main, remove the worktree. Do not push.
