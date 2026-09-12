import { z } from "zod";

/**
 * Loose shapes of the payloads Claude Code sends, as measured in docs/spike-hooks.md. Only the
 * fields ingest reads are named, and every schema parses in zod's default strip mode, so parsing
 * is itself the first redaction step: anything we never named is gone before ingest sees it.
 * Fields on the forbidden list are deliberately absent from these schemas, except `cwd`, which
 * ingest reads only to hash and to check against the allowlist.
 */
const envelope = { session_id: z.string().min(1), cwd: z.string().min(1) };

export const RawHookSchema = z.object({
  ...envelope,
  hook_event_name: z.string(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  duration_ms: z.number().optional(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  // Only the discriminator is named: a background shell's `command` and `description` are tool
  // input and must never be copied, so they are stripped here.
  background_tasks: z.array(z.object({ type: z.string().optional() })).optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
});
export type RawHook = z.infer<typeof RawHookSchema>;

/** Every figure is nullish: a status line early in a session reports nulls, or omits sections. */
export const RawStatusLineSchema = z.object({
  ...envelope,
  context_window: z.object({ used_percentage: z.number().nullish() }).optional(),
  cost: z.object({ total_cost_usd: z.number().nullish() }).optional(),
  rate_limits: z
    .object({
      five_hour: z.object({ used_percentage: z.number().nullish() }).optional(),
      seven_day: z.object({ used_percentage: z.number().nullish() }).optional(),
    })
    .optional(),
  model: z.object({ display_name: z.string().nullish() }).optional(),
});
export type RawStatusLine = z.infer<typeof RawStatusLineSchema>;
