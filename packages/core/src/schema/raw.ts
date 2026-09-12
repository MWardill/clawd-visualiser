import { z } from "zod";

/**
 * Loose shapes of the payloads Claude Code sends, as measured in docs/spike-hooks.md. Only the
 * fields ingest reads are named; everything else passes through untyped and is never copied.
 * Fields on the forbidden list are deliberately absent from these schemas, except `cwd`, which
 * ingest reads only to hash and to check against the allowlist.
 */
const envelope = { session_id: z.string().min(1), cwd: z.string().min(1) };

export const RawHookSchema = z
  .object({
    ...envelope,
    hook_event_name: z.string(),
    tool_name: z.string().optional(),
    tool_use_id: z.string().optional(),
    duration_ms: z.number().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
    background_tasks: z.array(z.unknown()).optional(),
    reason: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();
export type RawHook = z.infer<typeof RawHookSchema>;

export const RawStatusLineSchema = z
  .object({
    ...envelope,
    context_window: z.object({ used_percentage: z.number().optional() }).passthrough(),
    cost: z.object({ total_cost_usd: z.number().optional() }).passthrough().optional(),
    rate_limits: z
      .object({
        five_hour: z.object({ used_percentage: z.number().optional() }).passthrough().optional(),
        seven_day: z.object({ used_percentage: z.number().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    model: z.object({ display_name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
export type RawStatusLine = z.infer<typeof RawStatusLineSchema>;
