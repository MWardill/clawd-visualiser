// The four invariants of the detail levels design (§4), over one session's worth of raw payloads.
// CANARY marks content that must never appear anywhere; LOCALONLY marks paths and names that may
// appear only inside `detail`, only at paths, and never after stripDetail.
import { describe, expect, it } from "vitest";
import { emptyAliasMap } from "../alias/names";
import { HintsDetailSchema, containsDetail, stripDetail, type DetailLevel } from "../schema/detail";
import type { RedactedEvent } from "../schema/events";
import type { Snapshot } from "../schema/snapshot";
import type { TickerEvent } from "../schema/ticker";
import { applyEvent } from "../state/apply";
import { toCloudSnapshot } from "../state/cloud";
import { DEFAULT_CONFIG } from "../state/config";
import { emptyFleet, type Fleet } from "../state/fleet";
import { deriveSnapshot } from "../state/snapshot";
import { containsForbidden, redact, redactPresence, type IngestContext } from "./redact";

const T0 = 1_757_671_200_000;
const CWD = "C:\\work\\LOCALONLY-parent\\repo";
const LIVE = [CWD, "C:/work/LOCALONLY-parent/repo"];
const FILE = "C:\\work\\LOCALONLY-parent\\repo\\src\\LOCALONLY-file.ts";
const common = { session_id: "s1", transcript_path: "C:/x/CANARY-transcript.jsonl", cwd: CWD, prompt_id: "p1", permission_mode: "acceptEdits" };
const script: Record<string, unknown>[] = [
  { ...common, hook_event_name: "UserPromptSubmit", prompt: "CANARY prompt" },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Write", tool_use_id: "t1", tool_input: { file_path: FILE, content: "CANARY content" } },
  { ...common, hook_event_name: "PostToolUse", tool_name: "Write", tool_use_id: "t1", tool_input: { file_path: FILE }, tool_response: { ok: "CANARY output" }, duration_ms: 3 },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "git status CANARY-arg", description: "CANARY shell description" } },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Grep", tool_use_id: "t3", tool_input: { pattern: "CANARY pattern", path: "C:\\work\\LOCALONLY-parent\\repo\\src" } },
  { ...common, hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_use_id: "t4", tool_input: { url: "https://example.test/CANARY-path?q=CANARY", prompt: "CANARY fetch prompt" } },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: "t5", tool_input: { subagent_type: "Explore", description: "LOCALONLY task", prompt: "CANARY agent prompt" } },
  { ...common, hook_event_name: "Stop", last_assistant_message: "CANARY reply", background_tasks: [{ id: "b", type: "shell", status: "running", command: "CANARY cmd", description: "CANARY desc" }] },
  { session_id: "s1", cwd: CWD, transcript_path: "C:/x/CANARY-transcript.jsonl", session_name: "LOCALONLY session", workspace: { current_dir: CWD }, context_window: { used_percentage: 12 } },
];
const entry = { pid: 1, cwd: CWD, kind: "interactive", startedAt: T0, sessionId: "s1", name: "LOCALONLY session" };

type Run = { events: RedactedEvent[]; ticker: TickerEvent[]; snapshot: Snapshot; all: unknown[] };

function run(level: DetailLevel): Run {
  const ctx: IngestContext = { now: T0, allowlist: ["C:\\work"], paneNames: true, detail: level };
  let fleet: Fleet = emptyFleet();
  const events: RedactedEvent[] = [];
  const ticker: TickerEvent[] = [];
  let t = T0;
  const feed = (e: RedactedEvent | null): void => {
    if (!e) return;
    events.push(e);
    const applied = applyEvent(fleet, e, e.t, DEFAULT_CONFIG);
    fleet = applied.fleet;
    ticker.push(...applied.ticker);
  };
  for (const raw of script) feed(redact(raw, { ...ctx, now: (t += 1000) }));
  feed(redactPresence(entry, true, { ...ctx, now: (t += 1000) }));
  const { snapshot } = deriveSnapshot(fleet, emptyAliasMap(), t + 5000);
  return { events, ticker, snapshot, all: [events, ticker, snapshot] };
}

describe("detail level invariants", () => {
  it("1: level none produces no detail key anywhere and no local string", () => {
    const r = run("none");
    expect(r.events).toHaveLength(script.length + 1);
    expect(containsDetail(r.all)).toBe(false);
    expect(JSON.stringify(r.all)).not.toContain("LOCALONLY");
  });

  it("2: outside detail nothing forbidden and no content appears at any level", () => {
    for (const level of ["none", "hints", "paths"] as const) {
      const r = run(level);
      expect(JSON.stringify(r.all), level).not.toContain("CANARY");
      for (const value of r.all) expect(containsForbidden(stripDetail(value), LIVE), level).toBeNull();
    }
  });

  it("3: the cloud snapshot is level none whatever the level, and the strip is what makes it so", () => {
    const r = run("paths");
    expect(containsForbidden(r.snapshot, LIVE)).not.toBeNull();
    const cloud = toCloudSnapshot(r.snapshot);
    expect(containsDetail(cloud)).toBe(false);
    expect(JSON.stringify(cloud)).not.toContain("LOCALONLY");
    expect(containsForbidden(cloud, LIVE)).toBeNull();
    expect(cloud.sessions[0]?.label).toBe(r.snapshot.sessions[0]?.label);
  });

  it("4: hints are bounded by the hints schema and carry no path", () => {
    const r = run("hints");
    expect(JSON.stringify(r.all)).not.toContain("LOCALONLY");
    for (const e of r.events) if (e.detail !== undefined) expect(() => HintsDetailSchema.parse(e.detail), e.kind).not.toThrow();
    const by = (tool: string) => r.events.find((e) => e.kind === "tool.start" && e.tool === tool)?.detail;
    expect(by("Write")).toEqual({ ext: "ts", permissionMode: "acceptEdits" });
    expect(by("Bash")).toEqual({ program: "git", permissionMode: "acceptEdits" });
    expect(by("Grep")).toEqual({ permissionMode: "acceptEdits" });
    expect(by("WebFetch")).toEqual({ host: "example.test", permissionMode: "acceptEdits" });
    expect(by("Agent")).toEqual({ agent: "Explore", permissionMode: "acceptEdits" });
    expect(r.events.find((e) => e.kind === "stop")?.detail).toEqual({ shells: 1, permissionMode: "acceptEdits" });
    expect(r.snapshot.sessions[0]?.detail).toEqual({ permissionMode: "acceptEdits", shells: 1, subject: { kind: "agent", text: "Explore" } });
    expect(r.snapshot.panes[0]).not.toHaveProperty("detail");
  });

  it("paths carry relative files, the directory, the name and the agent description, inside detail only", () => {
    const r = run("paths");
    const by = (tool: string) => r.events.find((e) => e.kind === "tool.start" && e.tool === tool)?.detail;
    expect(by("Write")).toEqual({ ext: "ts", permissionMode: "acceptEdits", file: "src/LOCALONLY-file.ts", dir: "C:/work/LOCALONLY-parent/repo" });
    expect(by("Grep")).toEqual({ permissionMode: "acceptEdits", file: "src", dir: "C:/work/LOCALONLY-parent/repo" });
    expect(by("Agent")).toMatchObject({ description: "LOCALONLY task" });
    expect(r.events.find((e) => e.kind === "status")?.detail).toEqual({ dir: "C:/work/LOCALONLY-parent/repo", name: "LOCALONLY session" });
    expect(r.events.find((e) => e.kind === "presence")?.detail).toEqual({ dir: "C:/work/LOCALONLY-parent/repo", name: "LOCALONLY session" });
    expect(r.snapshot.sessions[0]?.detail).toEqual({ permissionMode: "acceptEdits", shells: 1, dir: "C:/work/LOCALONLY-parent/repo", name: "LOCALONLY session", subject: { kind: "agent", text: "LOCALONLY task" } });
    expect(r.snapshot.panes[0]?.detail).toEqual({ dir: "C:/work/LOCALONLY-parent/repo" });
    expect(r.ticker.find((l) => l.kind === "tool.start")?.detail).toEqual({ subject: { kind: "file", text: "src/LOCALONLY-file.ts" }, permissionMode: "acceptEdits" });
    expect(JSON.stringify(stripDetail(r.all))).not.toContain("LOCALONLY");
  });
});
