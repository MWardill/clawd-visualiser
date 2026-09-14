import { z } from "zod";
import { ActivitySchema, SessionPhaseSchema } from "./snapshot";
import { TickerDetailSchema } from "./detail";

export const TickerKindSchema = z.enum([
  "session.start",
  "session.end",
  "prompt",
  "tool.start",
  "tool.end",
  "permission",
  "stop",
  "subagent.start",
  "subagent.stop",
  "state",
  "context",
]);
export type TickerKind = z.infer<typeof TickerKindSchema>;

/** One line of the detail ticker. Local mode only; never published to the cloud. */
export const TickerEventSchema = z
  .object({
    t: z.iso.datetime(),
    kind: TickerKindSchema,
    activity: ActivitySchema.optional(),
    tool: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    agentType: z.string().optional(),
    state: SessionPhaseSchema.optional(),
    contextPct: z.number().min(0).max(100).optional(),
    reason: z.string().optional(),
    detail: TickerDetailSchema.optional(),
  })
  .strict();
export type TickerEvent = z.infer<typeof TickerEventSchema>;
