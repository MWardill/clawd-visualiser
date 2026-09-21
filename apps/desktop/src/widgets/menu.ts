// A widget's context menu, as data. Main turns the template into a Menu and pops it on the widget's
// window. Nothing here loads Electron at run time (only its types are imported), so it is tested without it.
import type { MenuItemConstructorOptions } from "electron";

export type WidgetMenuActions = {
  togglePin(): void;
  openWindow(): void;
  settings(): void;
};

/** Pin on top, Open full window, Settings. */
export function widgetMenuTemplate(pinned: boolean, actions: WidgetMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: "Pin on top", type: "checkbox", checked: pinned, click: () => actions.togglePin() },
    { type: "separator" },
    { label: "Open full window", click: () => actions.openWindow() },
    { label: "Settings", click: () => actions.settings() },
  ];
}
