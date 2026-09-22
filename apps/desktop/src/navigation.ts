// Whether the renderer may go somewhere. Pure, so it is tested without a window.

/** Scheme and host of a URL, compared without case; null when it does not parse. */
function site(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when a renderer loaded from `current` may navigate to `target`: the same scheme and host
 * only. Compared by hand rather than through `URL.origin`, which is the string "null" for a
 * custom scheme and so would make every `app://` URL alike.
 */
export function sameOrigin(current: string, target: string): boolean {
  const a = site(current);
  const b = site(target);
  return a !== null && b !== null && a === b;
}
