// Claude Code status line command for the Clawd visualiser. Forwards the payload on stdin to the
// local agent and prints a status line: the user's previous status line when one was wrapped, else a
// short default. The status bar never goes blank. Always exits 0.
import { defaultLine, post, readConfig, readStdin, runWrapped } from "./clawd-lib.mjs";

setTimeout(() => process.exit(0), 6000).unref();

let line;
try {
  const config = readConfig();
  const input = await readStdin();
  let payload = null;
  try {
    payload = JSON.parse(input.toString("utf8"));
  } catch {
    payload = null;
  }
  const wrapped = typeof config?.wrappedStatusLine?.command === "string" ? config.wrappedStatusLine.command : null;
  const [output] = await Promise.all([
    wrapped ? runWrapped(wrapped, input) : Promise.resolve(null),
    config && input.length > 0 ? post(config, "/ingest/status", input) : Promise.resolve(),
  ]);
  line = output ?? `${defaultLine(payload)}\n`;
} catch {
  line = "clawd\n";
}
process.stdout.write(line, () => process.exit(0));
