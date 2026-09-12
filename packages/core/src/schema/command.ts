import { z } from "zod";

/** Commands the web app may send to the agent. */
export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("focus"), alias: z.string().min(1) }).strict(),
  z.object({ type: z.literal("ping") }).strict(),
]);
export type Command = z.infer<typeof CommandSchema>;
