// Claude Code SessionStart command hook for the Clawd visualiser. Forwards the payload on stdin to
// the local agent, which redacts it at ingest. Prints nothing and always exits 0.
import { post, readConfig, readStdin } from "./clawd-lib.mjs";

setTimeout(() => process.exit(0), 1500).unref();

try {
  const config = readConfig();
  const body = await readStdin();
  if (config && body.length > 0) await post(config, "/ingest/hook", body);
} catch {
  // A hook must never fail the session.
}
process.exit(0);
