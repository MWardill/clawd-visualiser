import { z } from "zod";
import { RedactedEventSchema, type RedactedEvent } from "../schema/events";

export type Fixture = { name: string; events: RedactedEvent[] };

const HeaderSchema = z.object({ fixture: z.literal(1), name: z.string().min(1) }).strict();

/** JSON.parse, but a syntax error says which fixture and which line of the file it was on. */
function parseLine(line: string, where: string, n: number): unknown {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new Error(`${where} line ${n}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * One JSON header line, then one validated RedactedEvent per line. Blank lines are ignored, but
 * they still count: reported line numbers are the file's own, so an error can be opened where it is.
 */
export function parseFixture(text: string): Fixture {
  const lines = text
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter((l) => l.line.trim().length > 0);
  const first = lines[0];
  if (!first) throw new Error("fixture is empty");
  const header = HeaderSchema.safeParse(parseLine(first.line, "fixture header", first.n));
  if (!header.success) throw new Error('fixture must start with a header line {"fixture":1,"name":...}');
  const where = `fixture ${header.data.name}`;
  const events = lines.slice(1).map(({ line, n }) => {
    const parsed = RedactedEventSchema.safeParse(parseLine(line, where, n));
    if (!parsed.success) throw new Error(`${where} line ${n}: ${parsed.error.message}`);
    return parsed.data;
  });
  return { name: header.data.name, events };
}
