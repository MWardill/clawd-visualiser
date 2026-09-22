// The widget bridge's messages, on main's side. Every widget window sends on the same channels, so
// each handler is given the sender's id and the controller finds the window by it. Every argument is
// validated, and no handler throws. Electron-free and tested over a fake controller; main hands the
// handlers to ipcMain.
import { z } from "zod";
import type { WidgetController } from "../widgets/controller";
import { WIDGET_CHANNELS } from "./channels";

/** What a page may ask of the controller. */
export type WidgetCalls = Pick<WidgetController, "ready" | "resize" | "dragStart" | "dragMove" | "dragEnd" | "togglePin" | "select" | "menu">;

export type WidgetHandlers = {
  /** For `ipcMain.handle`: the one call with an answer. */
  invoke: Record<string, (sender: number, raw: unknown) => unknown>;
  /** For `ipcMain.on`: messages with none. */
  on: Record<string, (sender: number, raw: unknown) => void>;
};

/** CSS pixels. 4096 is far past any pane; the floor keeps a zero or negative size from reaching setBounds. */
const Size = z
  .object({ width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096) })
  .strict()
  .nullable();
const Alias = z.string().min(1).max(200);

export function createWidgetHandlers(calls: WidgetCalls): WidgetHandlers {
  // An exception nothing catches in main is handed to the agent host, which restarts the agent. A
  // page must never be able to cause that, so nothing escapes a handler.
  const quiet =
    (run: (sender: number, raw: unknown) => void) =>
    (sender: number, raw: unknown): void => {
      try {
        run(sender, raw);
      } catch {
        // The message is dropped.
      }
    };
  return {
    invoke: {
      [WIDGET_CHANNELS.ready]: (sender) => {
        try {
          return calls.ready(sender);
        } catch {
          return null;
        }
      },
    },
    on: {
      [WIDGET_CHANNELS.resize]: quiet((sender, raw) => {
        const size = Size.safeParse(raw);
        if (size.success) calls.resize(sender, size.data);
      }),
      [WIDGET_CHANNELS.dragStart]: quiet((sender) => calls.dragStart(sender)),
      [WIDGET_CHANNELS.dragMove]: quiet((sender) => calls.dragMove(sender)),
      [WIDGET_CHANNELS.dragEnd]: quiet((sender) => calls.dragEnd(sender)),
      [WIDGET_CHANNELS.togglePin]: quiet((sender) => calls.togglePin(sender)),
      [WIDGET_CHANNELS.select]: quiet((sender, raw) => {
        const alias = Alias.safeParse(raw);
        if (alias.success) calls.select(sender, alias.data);
      }),
      [WIDGET_CHANNELS.menu]: quiet((sender) => calls.menu(sender)),
    },
  };
}
