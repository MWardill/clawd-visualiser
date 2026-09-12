export type CliEnv = { serve: () => Promise<number>; printError: (line: string) => void };

export const USAGE = "usage: agent serve";

export async function runCli(argv: readonly string[], env: CliEnv): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "serve" && rest.length === 0) return env.serve();
  env.printError(USAGE);
  return 2;
}
