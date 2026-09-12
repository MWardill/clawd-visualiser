import { normalisePath } from "../alias/pane";

/** True when `cwd` is one of the allowlisted directories or lies beneath one. Empty list allows nothing. */
export function isAllowed(cwd: string, allowlist: readonly string[]): boolean {
  const target = normalisePath(cwd);
  return allowlist.some((entry) => {
    const root = normalisePath(entry);
    return target === root || target.startsWith(root + "/");
  });
}
