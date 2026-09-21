import { DESKTOP_ORIGIN } from "@clawd/core";
import { timingSafeEqual } from "node:crypto";

/** Only loopback names on our own port: a rebound DNS name pointing at 127.0.0.1 is refused. */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const name = host.toLowerCase();
  return name === `127.0.0.1:${port}` || name === `localhost:${port}`;
}

export type OriginCheck = { kind: "none" } | { kind: "allowed"; origin: string } | { kind: "denied" };

export function checkOrigin(origin: string | undefined, allowed: readonly string[]): OriginCheck {
  if (origin === undefined) return { kind: "none" };
  return allowed.includes(origin) ? { kind: "allowed", origin } : { kind: "denied" };
}

/**
 * The web app's dev server. Accepted with no configuration unless the agent's host leaves them out:
 * the packaged desktop app does, because a teammate's machine has no dev server of ours, and
 * whatever else listens on port 3000 there should not read the stream or send focus commands.
 */
export const DEV_ORIGINS: readonly string[] = ["http://localhost:3000", "http://127.0.0.1:3000"];

/** Origins an agent accepts with no configuration: the dev server's and the desktop app's page. */
export const BUILTIN_ORIGINS: readonly string[] = [...DEV_ORIGINS, DESKTOP_ORIGIN];

/** The built-in origins, then those the config adds. A config that lists a built-in one is harmless, and is how a host without the dev origins gets one back. */
export function allowedOrigins(configured: readonly string[], devOrigins = true): string[] {
  return [...(devOrigins ? DEV_ORIGINS : []), DESKTOP_ORIGIN, ...configured];
}

/** Constant-time comparison of the hook token header. */
export function tokenMatches(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== "string" || expected.length === 0) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
