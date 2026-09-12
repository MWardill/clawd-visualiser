/** Lower-case, forward slashes, no trailing slash (a bare "/" stays "/"). */
export function normalisePath(p: string): string {
  const s = p.replace(/\\/g, "/").toLowerCase();
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

/**
 * 64-bit FNV-1a of the normalised path, as 16 hex characters. An internal key so the path never
 * appears in a log line; the snapshot carries a pane alias, never this.
 *
 * Hashes UTF-16 code units rather than UTF-8 bytes so it needs no TextEncoder (the package has no
 * DOM or Node types). For ASCII paths this is exactly FNV-1a over the bytes.
 */
export function paneKey(cwd: string): string {
  const s = normalisePath(cwd);
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}
