// Runs before a widget page, in its own world. `contextBridge` publishes exactly these functions on
// window.clawdWidget; the page has no other way out, and is allowed no network at all. `invoke` is a
// question with an answer; `send` is a message with none, which is what most of these are.
import { contextBridge, ipcRenderer } from "electron";
import { WIDGET_CHANNELS } from "./channels";
import type { WidgetApi, WidgetSize, WidgetState } from "./state";

contextBridge.exposeInMainWorld("clawdWidget", {
  ready: () => ipcRenderer.invoke(WIDGET_CHANNELS.ready) as Promise<WidgetState | null>,
  onState: (cb: (s: WidgetState) => void) => {
    const listener = (_event: unknown, state: WidgetState): void => cb(state);
    ipcRenderer.on(WIDGET_CHANNELS.state, listener);
    return () => void ipcRenderer.off(WIDGET_CHANNELS.state, listener);
  },
  resize: (size: WidgetSize | null) => ipcRenderer.send(WIDGET_CHANNELS.resize, size),
  dragStart: () => ipcRenderer.send(WIDGET_CHANNELS.dragStart),
  dragMove: () => ipcRenderer.send(WIDGET_CHANNELS.dragMove),
  dragEnd: () => ipcRenderer.send(WIDGET_CHANNELS.dragEnd),
  togglePin: () => ipcRenderer.send(WIDGET_CHANNELS.togglePin),
  select: (alias: string) => ipcRenderer.send(WIDGET_CHANNELS.select, alias),
  menu: () => ipcRenderer.send(WIDGET_CHANNELS.menu),
} satisfies WidgetApi);
