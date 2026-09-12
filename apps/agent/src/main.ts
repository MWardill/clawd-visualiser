import { fileURLToPath } from "node:url";
import { startAgent } from "./agent";
import { runCli } from "./cli";
import { ConfigError, defaultHome, defaultSettingsPath } from "./config";
import { isErrno } from "./json-file";

const HOOKS_DIR = fileURLToPath(new URL("../hooks/", import.meta.url));

async function serve(): Promise<number> {
  let agent;
  try {
    agent = await startAgent({ home: defaultHome() });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    if (isErrno(err, "EADDRINUSE")) {
      process.stderr.write("the agent's port is already in use; is another agent running?\n");
      return 1;
    }
    throw err;
  }
  process.stderr.write(`clawd agent listening on http://127.0.0.1:${agent.port}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await agent.stop();
  return 0;
}

runCli(process.argv.slice(2), {
  serve,
  home: defaultHome(),
  settingsPath: defaultSettingsPath(),
  // pnpm runs package scripts inside apps/agent; INIT_CWD is where the command was typed.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  node: process.execPath,
  hooksDir: HOOKS_DIR,
  now: Date.now,
  print: (line) => process.stdout.write(`${line}\n`),
  printError: (line) => process.stderr.write(`${line}\n`),
}).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
