import { z } from "zod";
import { ToolCategorySchema } from "./events";
import { PaneDetailSchema, SessionDetailSchema } from "./detail";

/** The five states a session can be in. */
export const SessionPhaseSchema = z.enum(["working", "waiting", "idle", "asleep", "done"]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

/** What a working session is doing: a tool category, or `think`, the gap between tool calls. */
export const ActivitySchema = z.enum([...ToolCategorySchema.options, "think"]);
export type Activity = z.infer<typeof ActivitySchema>;

const Ext = z.record(z.string(), z.unknown()).optional();

export const PaneSnapshotSchema = z
  .object({
    pane: z.string().min(1),
    label: z.string().min(1),
    /** Absent until collision detection (M7) computes it; additive, per the versioning rule. */
    collision: z.boolean().optional(),
    /** At the paths level, the pane's working directory. */
    detail: PaneDetailSchema.optional(),
  })
  .strict();
export type PaneSnapshot = z.infer<typeof PaneSnapshotSchema>;

export const SessionSnapshotSchema = z
  .object({
    alias: z.string().min(1),
    label: z.string().min(1),
    pane: z.string().min(1),
    state: SessionPhaseSchema,
    activity: ActivitySchema.nullable(),
    subagents: z.number().int().nonnegative(),
    contextPct: z.number().min(0).max(100).nullable(),
    since: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    /** Local only: never in a cloud snapshot (toCloudSnapshot strips it). */
    detail: SessionDetailSchema.optional(),
    ext: Ext,
  })
  .strict();
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

export const SnapshotSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.iso.datetime(),
    panes: z.array(PaneSnapshotSchema),
    sessions: z.array(SessionSnapshotSchema),
    ext: Ext,
  })
  .strict();
export type Snapshot = z.infer<typeof SnapshotSchema>;
