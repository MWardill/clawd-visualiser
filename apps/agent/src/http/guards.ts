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

/** Constant-time comparison of the hook token header. */
export function tokenMatches(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== "string" || expected.length === 0) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
