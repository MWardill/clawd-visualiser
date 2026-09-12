// Turns the spike recordings (raw listener log lines) into committed, redacted fixtures, and
// regenerates the golden snapshot sequences for every fixture.
//
//   pnpm --filter @clawd/core fixtures
//
// Raw recordings never enter the repo; they are gitignored under tools/hook-spike/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../src/ingest/redact";
import { snapshotFrames } from "../src/fixtures/frames";
import { parseFixture } from "../src/fixtures/load";

const root = join(import.meta.dirname, "..", "..", "..");
const fixturesDir = join(root, "packages", "core", "src", "fixtures");
const recordings: [string, string][] = [
  ["spike-headless", join(root, "tools", "hook-spike", "spike-events-headless.jsonl")],
  ["spike-interactive", join(root, "tools", "hook-spike", "spike-events-interactive.jsonl")],
];
const BASE = 1_757_671_200_000;

type Recorded = { t: number; url: string; body: { kind?: string; payload?: unknown } & Record<string, unknown> };

/** The listener wrapped each POST as { t, url, body }; command hooks nested the real payload under body.payload. */
function payloadOf(rec: Recorded): unknown {
  return rec.body.kind === "command-hook" ? rec.body.payload : rec.body;
}

for (const [name, file] of recordings) {
  if (!existsSync(file)) {
    console.log(`skip ${name}: ${file} not found`);
    continue;
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: string[] = [JSON.stringify({ fixture: 1, name })];
  // The listener's clock restarts when it is relaunched; keep fixture time monotonic across restarts.
  let offset = 0;
  let lastT = -Infinity;
  let kept = 0;
  for (const line of lines) {
    const rec = JSON.parse(line) as Recorded;
    if (rec.t < lastT) offset += lastT + 1000;
    lastT = rec.t;
    const payload = payloadOf(rec);
    const cwd = typeof payload === "object" && payload !== null ? (payload as { cwd?: unknown }).cwd : undefined;
    const e = redact(payload, { now: BASE + offset + rec.t, allowlist: typeof cwd === "string" ? [cwd] : [] });
    if (e) {
      out.push(JSON.stringify(e));
      kept++;
    }
  }
  writeFileSync(join(fixturesDir, `${name}.jsonl`), out.join("\n") + "\n");
  console.log(`${name}: ${kept} events from ${lines.length} recorded lines`);
}

mkdirSync(join(fixturesDir, "golden"), { recursive: true });
for (const name of ["permission-denied", "killed-session", "spike-headless", "spike-interactive"]) {
  const path = join(fixturesDir, `${name}.jsonl`);
  if (!existsSync(path)) continue;
  const frames = snapshotFrames(parseFixture(readFileSync(path, "utf8")));
  writeFileSync(join(fixturesDir, "golden", `${name}.json`), JSON.stringify(frames, null, 1) + "\n");
  console.log(`golden ${name}: ${frames.length} frames`);
}
