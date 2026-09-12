import { z } from "zod";
import { RedactedEventSchema, type RedactedEvent } from "../schema/events";

export type Fixture = { name: string; events: RedactedEvent[] };

const HeaderSchema = z.object({ fixture: z.literal(1), name: z.string().min(1) }).strict();

/** One JSON header line, then one validated RedactedEvent per line. Blank lines are ignored. */
export function parseFixture(text: string): Fixture {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const first = lines[0];
  if (!first) throw new Error("fixture is empty");
  const header = HeaderSchema.safeParse(JSON.parse(first));
  if (!header.success) throw new Error('fixture must start with a header line {"fixture":1,"name":...}');
  const events = lines.slice(1).map((line, i) => {
    const parsed = RedactedEventSchema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`fixture ${header.data.name} line ${i + 2}: ${parsed.error.message}`);
    return parsed.data;
  });
  return { name: header.data.name, events };
}
