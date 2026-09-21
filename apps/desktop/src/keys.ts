// The keyboard shortcut main handles in the window. Pure.

/** The fields of Electron's `Input` a shortcut needs. */
export type KeyInput = { type: string; key: string; code: string; control: boolean; shift: boolean; alt: boolean; meta: boolean };

/**
 * Ctrl+Q pressed, with no other modifier: quit the app, not just hide the window. `key` is what the
 * layout types, so it is right wherever the layout has a q. A layout with no Latin letters (Russian,
 * Greek, Hebrew) never types one, and there the physical Q key stands in. Only there: on AZERTY the
 * physical Q key types `a`, and Ctrl+A has to stay select-all.
 */
export function isQuitShortcut(input: KeyInput): boolean {
  if (input.type !== "keyDown" || !input.control || input.shift || input.alt || input.meta) return false;
  if (input.key.toLowerCase() === "q") return true;
  const nonLatin = input.key.length === 1 && input.key.charCodeAt(0) > 127;
  return nonLatin && input.code === "KeyQ";
}
