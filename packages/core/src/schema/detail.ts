import { z } from "zod";

/**
 * How much of a session's activity the agent keeps beyond states, categories and tool names
 * (detail levels design §2). `none` is the wire format the cloud and the event log always get.
 */
export const DETAIL_LEVELS = ["none", "hints", "paths"] as const;
export const DetailLevelSchema = z.enum(DETAIL_LEVELS);
export type DetailLevel = z.infer<typeof DetailLevelSchema>;

/** True when `level` carries at least what `min` does. */
export function atLeast(level: DetailLevel, min: DetailLevel): boolean {
  return DETAIL_LEVELS.indexOf(level) >= DETAIL_LEVELS.indexOf(min);
}

const NO_CONTROL = /^[^\x00-\x1f\x7f]+$/;
const text = (max: number) => z.string().min(1).max(max).regex(NO_CONTROL);
const permissionMode = z.string().regex(/^[a-zA-Z]{1,32}$/);
const shells = z.number().int().nonnegative();

/** Hints: nothing here can hold a path, so every string refuses separators. */
export const HintsDetailSchema = z
  .object({
    program: z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/).optional(),
    ext: z.string().regex(/^[a-z0-9]{1,16}$/).optional(),
    host: z.string().regex(/^[A-Za-z0-9.:[\]-]{1,253}$/).optional(),
    agent: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional(),
    permissionMode: permissionMode.optional(),
    shells: shells.optional(),
  })
  .strict();
export type HintsDetail = z.infer<typeof HintsDetailSchema>;

/** Paths: the file or directory a tool touches, the working directory, the session's own name. */
export const PathsDetailSchema = HintsDetailSchema.extend({
  file: text(512).optional(),
  dir: text(512).optional(),
  name: text(120).optional(),
  description: text(120).optional(),
}).strict();
export type PathsDetail = z.infer<typeof PathsDetailSchema>;

/** What a redacted event may carry: the paths shape. Ingest fills only what the level allows. */
export const EventDetailSchema = PathsDetailSchema;
export type EventDetail = z.infer<typeof EventDetailSchema>;

/** What a tool call is about: a file (or its extension at hints), a program, a host, an agent. */
export const SubjectSchema = z.object({ kind: z.enum(["file", "program", "host", "agent"]), text: text(512) }).strict();
export type Subject = z.infer<typeof SubjectSchema>;

export const SessionDetailSchema = z
  .object({ name: text(120).optional(), dir: text(512).optional(), permissionMode: permissionMode.optional(), shells: shells.optional(), subject: SubjectSchema.optional() })
  .strict();
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

export const PaneDetailSchema = z.object({ dir: text(512).optional() }).strict();
export type PaneDetail = z.infer<typeof PaneDetailSchema>;

export const TickerDetailSchema = z.object({ subject: SubjectSchema.optional(), permissionMode: permissionMode.optional() }).strict();
export type TickerDetail = z.infer<typeof TickerDetailSchema>;

/** The one key detail travels under, so one rule strips every level back to `none`. */
export const DETAIL_KEY = "detail";

/** A copy of `value` with every `detail` key removed at any depth. The input is not touched. */
export function stripDetail<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => stripDetail(v)) as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (k !== DETAIL_KEY) out[k] = stripDetail(v);
    return out as T;
  }
  return value;
}

/** True when a `detail` key exists anywhere in `value`. */
export function containsDetail(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((v) => containsDetail(v));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([k, v]) => k === DETAIL_KEY || containsDetail(v));
  }
  return false;
}
