// Showing a window that may not exist yet. Both windows, the visualiser and the settings page, are
// made the first time they are asked for and shown after that; this is the one copy of that rule.
// Electron-free: a BrowserWindow fits `Revealable` as it is.

export type Revealable = { isDestroyed(): boolean; isMinimized(): boolean; restore(): void; show(): void; focus(): void };

/**
 * The window to keep hold of: the one there is, restored if minimised, shown and focused; else a new
 * one. Once quitting has begun nothing is shown or made, so neither a second launch nor the tray can
 * bring a window back while the app exits.
 */
export function showOrCreate<W extends Revealable>(current: W | null, quitting: boolean, create: () => W): W | null {
  if (quitting) return current;
  if (current === null || current.isDestroyed()) return create();
  if (current.isMinimized()) current.restore();
  current.show();
  current.focus();
  return current;
}
