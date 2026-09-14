// The main process: the one Node program in the app. It owns the lifecycle and the windows and
// draws nothing itself; Chromium does that, in a sandboxed renderer process per window.
import { app } from "electron";
import { ownArgs, parseArgs, resolveDevUrl } from "./args";
import { createMainWindow } from "./window";

const args = parseArgs(ownArgs(process.argv, app.isPackaged));
const url = resolveDevUrl(args, process.env);

// `ready` fires once Electron has initialised; no window can be made before it.
void app.whenReady().then(() => {
  createMainWindow(url);
});

// Stage 1 quits when the window closes. Stage 4 replaces this: the tray keeps the app alive.
app.on("window-all-closed", () => app.quit());
