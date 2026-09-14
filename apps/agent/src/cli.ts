import { DetailLevelSchema } from "@clawd/core";
import { parseArgs } from "node:util";
import { ConfigError } from "./config";
import { setDetail } from "./detail";
import { install, uninstall, type Print } from "./install/installer";

export type CliEnv = {
  serve: () => Promise<number>;
  home: string;
  settingsPath: string;
  /** The directory the command was typed in. */
  cwd: string;
  node: string;
  hooksDir: string;
  now: () => number;
  print: Print;
  printError: Print;
  probe?: (port: number) => Promise<boolean>;
};

export const USAGE = [
  "usage: agent serve",
  "       agent install --allow <dir> [--allow <dir> ...] [--port <n>] [--settings <path>] [--dry-run]",
  "       agent uninstall [--settings <path>]",
  "       agent detail <none|hints|paths>",
].join("\n");

function usage(env: CliEnv): number {
  env.printError(USAGE);
  return 2;
}

function isParseArgsError(err: unknown): boolean {
  return err instanceof TypeError && String((err as { code?: unknown }).code ?? "").startsWith("ERR_PARSE_ARGS");
}

export async function runCli(argv: readonly string[], env: CliEnv): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "serve":
        return rest.length === 0 ? await env.serve() : usage(env);
      case "install": {
        const { values } = parseArgs({
          args: rest,
          options: { allow: { type: "string", multiple: true }, port: { type: "string" }, settings: { type: "string" }, "dry-run": { type: "boolean" } },
          strict: true,
          allowPositionals: false,
        });
        const port = values.port === undefined ? undefined : Number(values.port);
        if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65_535)) return usage(env);
        return await install({
          home: env.home,
          settingsPath: values.settings ?? env.settingsPath,
          allow: values.allow ?? [],
          ...(port !== undefined ? { port } : {}),
          dryRun: values["dry-run"] ?? false,
          hooksDir: env.hooksDir,
          cwd: env.cwd,
          node: env.node,
          now: env.now,
          print: env.print,
          ...(env.probe ? { probe: env.probe } : {}),
        });
      }
      case "uninstall": {
        const { values } = parseArgs({ args: rest, options: { settings: { type: "string" } }, strict: true, allowPositionals: false });
        return await uninstall({ home: env.home, settingsPath: values.settings ?? env.settingsPath, now: env.now, print: env.print });
      }
      case "detail": {
        const level = DetailLevelSchema.safeParse(rest[0]);
        if (rest.length !== 1 || !level.success) return usage(env);
        return await setDetail({ home: env.home, level: level.data, print: env.print });
      }
      default:
        return usage(env);
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      env.printError(err.message);
      return 1;
    }
    if (isParseArgsError(err)) return usage(env);
    throw err;
  }
}
