// The app's own command line. Pure, so the main process stays a few lines.

/** `hidden` is read from stage 4 (start at login without a window); parsed now so the shape is settled. */
export type Args = { hidden: boolean; devUrl: string | null };

export const DEFAULT_DEV_URL = "http://localhost:3000";

/** The app's own arguments: Electron puts its executable first, and `electron .` adds the app path after it. */
export function ownArgs(argv: readonly string[], packaged: boolean): string[] {
  return argv.slice(packaged ? 1 : 2);
}

/** `--hidden`, and `--dev-url <url>` or `--dev-url=<url>`. Anything else is ignored. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { hidden: false, devUrl: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--hidden") args.hidden = true;
    else if (a === "--dev-url") args.devUrl = argv[++i] ?? null;
    else if (a.startsWith("--dev-url=")) args.devUrl = a.slice("--dev-url=".length) || null;
  }
  return args;
}

/** Where the renderer loads from in development: the flag, else the environment, else the Next dev server. */
export function resolveDevUrl(args: Args, env: Readonly<Record<string, string | undefined>>): string {
  const fromEnv = env.CLAWD_DESKTOP_URL?.trim();
  return args.devUrl ?? (fromEnv ? fromEnv : DEFAULT_DEV_URL);
}
