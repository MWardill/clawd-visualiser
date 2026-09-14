import { z } from "zod";

/**
 * Loose shapes of the payloads Claude Code sends, as measured in docs/spike-hooks.md. Only the
 * fields ingest reads are named, and every schema parses in zod's default strip mode, so parsing
 * is itself the first redaction step: anything we never named is gone before ingest sees it.
 * Fields on the forbidden list are deliberately absent from these schemas, except `cwd`, which
 * ingest reads only to hash and to check against the allowlist. The `*Detail` schemas at the
 * bottom name more, and are used only above level none.
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
  // input and must never be copied, so they are stripped here. An entry that cannot be read counts
  // for nothing rather than costing the whole Stop, which a session cannot afford to lose.
  background_tasks: z.array(z.object({ type: z.string().optional() }).catch({})).catch([]).optional(),
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

/**
 * One entry of `claude agents --json`, the presence poll. The entry also carries `pid`, `kind` and
 * `name`; `name` is session-name content, so none of them are named here. `startedAt` is epoch
 * milliseconds in the CLI measured today and was an ISO time in the spike, so both are read; one
 * that cannot be read is dropped rather than costing the entry.
 */
const StartedAtSchema = z
  .union([z.number(), z.string().transform((s) => Date.parse(s))])
  .pipe(z.number().int().nonnegative())
  .optional()
  .catch(undefined);

export const RawAgentEntrySchema = z.object({ sessionId: z.string().min(1), cwd: z.string().min(1), startedAt: StartedAtSchema });
export type RawAgentEntry = z.infer<typeof RawAgentEntrySchema>;

/**
 * The detail fields, named only above level none (detail levels design §5). Still strip mode:
 * `prompt`, `pattern`, `query` and everything else in the tool input never become values. A tool
 * input that is not an object reads as empty rather than failing the event.
 */
const ToolInputDetailSchema = z
  .object({
    file_path: z.string().optional().catch(undefined),
    notebook_path: z.string().optional().catch(undefined),
    path: z.string().optional().catch(undefined),
    command: z.string().optional().catch(undefined),
    url: z.string().optional().catch(undefined),
    subagent_type: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
  })
  .catch({});

export const RawHookDetailSchema = RawHookSchema.extend({ tool_input: ToolInputDetailSchema.optional(), permission_mode: z.string().optional() });
export type RawHookDetail = z.infer<typeof RawHookDetailSchema>;

export const RawStatusLineDetailSchema = RawStatusLineSchema.extend({ session_name: z.string().nullish() });
export type RawStatusLineDetail = z.infer<typeof RawStatusLineDetailSchema>;

export const RawAgentEntryDetailSchema = RawAgentEntrySchema.extend({ name: z.string().optional().catch(undefined) });
export type RawAgentEntryDetail = z.infer<typeof RawAgentEntryDetailSchema>;
