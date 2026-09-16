// The keyboard shortcut main handles in the window. Pure.

/** The fields of Electron's `Input` a shortcut needs. */
export type KeyInput = { type: string; key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean };

/** Ctrl+Q pressed, with no other modifier: quit the app, not just hide the window. */
export function isQuitShortcut(input: KeyInput): boolean {
  return input.type === "keyDown" && input.control && !input.shift && !input.alt && !input.meta && input.key.toLowerCase() === "q";
}
