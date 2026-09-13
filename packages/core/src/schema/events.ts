import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1 as const;

/** Activity categories a tool call maps to. `think` is not here: it is derived between calls. */
export const ToolCategorySchema = z.enum(["read", "edit", "run", "web", "spawn", "other"]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

const base = {
  v: z.literal(EVENT_SCHEMA_VERSION),
  t: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  paneKey: z.string().min(1),
  agentId: z.string().min(1).optional(),
};

const tool = { tool: z.string().min(1), category: ToolCategorySchema };

/**
 * The internal event type: what remains of a Claude Code payload after ingest. Carries the
 * session id and a hashed working directory so reducers can tell sessions apart; those two
 * never reach a snapshot.
 */
export const RedactedEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("session.start"), source: z.string().optional() }).strict(),
  z.object({ ...base, kind: z.literal("session.end"), reason: z.string() }).strict(),
  z.object({ ...base, kind: z.literal("prompt") }).strict(),
  z.object({ ...base, kind: z.literal("tool.start"), ...tool, toolUseId: z.string().min(1) }).strict(),
  z.object({ ...base, kind: z.literal("tool.end"), ...tool, toolUseId: z.string().min(1), durationMs: z.number().nonnegative() }).strict(),
  z.object({ ...base, kind: z.literal("permission.request"), ...tool, toolUseId: z.string().min(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal("permission.denied"), tool: z.string().min(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal("stop"), backgroundTasks: z.number().int().nonnegative() }).strict(),
  z.object({ ...base, agentId: z.string().min(1), kind: z.literal("subagent.start"), agentType: z.string().min(1) }).strict(),
  z.object({ ...base, agentId: z.string().min(1), kind: z.literal("subagent.stop"), agentType: z.string().min(1) }).strict(),
  z
    .object({
      ...base,
      kind: z.literal("status"),
      contextPct: z.number().min(0).max(100).optional(),
      costUsd: z.number().nonnegative().optional(),
      rateLimit5h: z.number().min(0).max(100).optional(),
      rateLimit7d: z.number().min(0).max(100).optional(),
      model: z.string().optional(),
    })
    .strict(),
  // `lastActiveAt`, on a live presence only: when the session last did anything, so one first seen
  // by the poll (after a restart, say) is idle since then rather than since it was noticed.
  z.object({ ...base, kind: z.literal("presence"), alive: z.boolean(), lastActiveAt: z.number().int().nonnegative().optional() }).strict(),
  // A session's typed prompt count from its transcript, read by the agent once per session per run.
  // It can raise the session's count, never lower it, and describes a session rather than creating one.
  z.object({ ...base, kind: z.literal("history"), prompts: z.number().int().nonnegative() }).strict(),
]);
export type RedactedEvent = z.infer<typeof RedactedEventSchema>;
export type RedactedEventKind = RedactedEvent["kind"];
