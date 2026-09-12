import { normalisePath } from "../alias/pane";

/**
 * True when `cwd` is one of the allowlisted directories or lies beneath one. An empty list allows
 * nothing, and so does an empty or blank entry: a stray separator in a configured list must never
 * open the boundary to every path.
 */
export function isAllowed(cwd: string, allowlist: readonly string[]): boolean {
  const target = normalisePath(cwd);
  return allowlist.some((entry) => {
    const root = normalisePath(entry.trim());
    if (root === "") return false;
    return target === root || target.startsWith(root.endsWith("/") ? root : root + "/");
  });
}
