import { z } from "zod";

/** The five states a session can be in. */
export const SessionPhaseSchema = z.enum(["working", "waiting", "idle", "asleep", "done"]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

/** What a working session is doing. `think` is the gap between tool calls. */
export const ActivitySchema = z.enum(["read", "edit", "run", "web", "spawn", "think", "other"]);
export type Activity = z.infer<typeof ActivitySchema>;

const Ext = z.record(z.string(), z.unknown()).optional();

export const PaneSnapshotSchema = z
  .object({
    pane: z.string().min(1),
    label: z.string().min(1),
    collision: z.boolean(),
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
