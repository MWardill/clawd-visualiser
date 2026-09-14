// The detail an event may carry at each level, derived from a raw payload's shape and paths.
// Pure; every function bounds what it returns so the schemas in schema/detail.ts accept it.
import { atLeast, type DetailLevel, type EventDetail } from "../schema/detail";
import type { RawAgentEntryDetail, RawHookDetail, RawStatusLineDetail } from "../schema/raw";

const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);
const segments = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s.length > 0);
/** Removes control characters, the class the schemas' `text()` bound refuses. */
const stripControl = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, "");
const HOST_PATTERN = /^[A-Za-z0-9.:[\]-]{1,253}$/;

/** The program a shell command runs: its first token after any `NAME=value` prefixes, without directory or Windows extension. */
export function program(command: string): string | undefined {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const first = tokens.find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  if (first === undefined) return undefined;
  const last = segments(first.replace(/^["']|["']$/g, "")).at(-1) ?? "";
  const name = last.replace(/\.(exe|cmd|bat)$/i, "");
  return /^[A-Za-z0-9._+-]{1,32}$/.test(name) ? name : undefined;
}

/** A file's extension, lower case; none for a dotfile, a bare name or one that is not letters and digits. */
export function ext(path: string): string | undefined {
  const last = segments(path).at(-1) ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return undefined;
  const e = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(e) ? e : undefined;
}

/** A URL's hostname, or none when it has none, does not parse, or does not match the schema's bound. */
export function host(url: string): string | undefined {
  try {
    const h = new URL(url).hostname;
    return HOST_PATTERN.test(h) ? h : undefined;
  } catch {
    return undefined;
  }
}

export function agentType(subagentType: string): string | undefined {
  return /^[A-Za-z0-9._:-]{1,64}$/.test(subagentType) ? subagentType : undefined;
}

export function permissionMode(mode: string): string | undefined {
  return /^[a-zA-Z]{1,32}$/.test(mode) ? mode : undefined;
}

/** A directory with forward slashes and no trailing slash, except a bare root. */
export function dir(cwd: string): string {
  const s = stripControl(cwd).replace(/\\/g, "/");
  const stripped = s.replace(/\/+$/, "");
  return cut(stripped === "" ? "/" : stripped, 512);
}

/** `file` relative to `cwd` when it lies inside it (compared without case), else as given, with forward slashes. */
export function relative(file: string, cwd: string): string | undefined {
  const f = stripControl(file).replace(/\\/g, "/");
  const root = dir(cwd);
  if (f.toLowerCase() === root.toLowerCase()) return ".";
  const prefix = `${root}/`;
  const inside = f.length > prefix.length && f.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
  const rel = inside ? f.slice(prefix.length) : f;
  return rel.length === 0 ? undefined : cut(rel, 512);
}

/** Free text for the wire: control characters removed, trimmed, cut; none when nothing is left. */
export function label(s: string, max = 120): string | undefined {
  const clean = stripControl(s).trim();
  return clean.length === 0 ? undefined : cut(clean, max);
}

type Fields = { [K in keyof EventDetail]: EventDetail[K] | undefined };

/** Drops the absent fields; none when nothing is left, so an event never carries an empty detail. */
function pruned(fields: Fields): EventDetail | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length === 0 ? undefined : (out as EventDetail);
}

const shells = (tasks: readonly { type?: string | undefined }[] | undefined): number | undefined =>
  tasks === undefined ? undefined : tasks.filter((t) => t.type === "shell").length;

/** What a hook payload yields at `level`: hints from the tool input's shape, paths from its paths. */
export function hookDetail(level: DetailLevel, raw: RawHookDetail): EventDetail | undefined {
  if (!atLeast(level, "hints")) return undefined;
  const input = raw.tool_input ?? {};
  const filePath = input.file_path ?? input.notebook_path ?? input.path;
  const paths = atLeast(level, "paths");
  return pruned({
    program: input.command === undefined ? undefined : program(input.command),
    ext: filePath === undefined ? undefined : ext(filePath),
    host: input.url === undefined ? undefined : host(input.url),
    agent: input.subagent_type === undefined ? undefined : agentType(input.subagent_type),
    permissionMode: raw.permission_mode === undefined ? undefined : permissionMode(raw.permission_mode),
    shells: shells(raw.background_tasks),
    file: paths && filePath !== undefined ? relative(filePath, raw.cwd) : undefined,
    dir: paths ? dir(raw.cwd) : undefined,
    // Only an Agent call's description: a shell command's describes the command, which is content.
    description: paths && raw.tool_name === "Agent" && input.description !== undefined ? label(input.description) : undefined,
  });
}

/** A status line yields the session's directory and name, at paths only. */
export function statusDetail(level: DetailLevel, raw: RawStatusLineDetail): EventDetail | undefined {
  if (!atLeast(level, "paths")) return undefined;
  return pruned({ dir: dir(raw.cwd), name: raw.session_name ? label(raw.session_name) : undefined });
}

/** An agents-list entry yields the same, at paths only. */
export function presenceDetail(level: DetailLevel, raw: RawAgentEntryDetail): EventDetail | undefined {
  if (!atLeast(level, "paths")) return undefined;
  return pruned({ dir: dir(raw.cwd), name: raw.name ? label(raw.name) : undefined });
}
