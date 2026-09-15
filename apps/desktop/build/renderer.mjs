// Builds the web app as a static export and copies it to dist/renderer, where the app:// handler
// serves it from. The Next build runs in apps/web with CLAWD_TARGET=desktop.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const webDir = here("../../web");
const exportDir = join(webDir, "out");
const rendererDir = here("../dist/renderer");

// Next's own CLI, run with this Node and no shell, so the environment variable is set the same way on Windows.
const nextBin = createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, "build"], { cwd: webDir, env: { ...process.env, CLAWD_TARGET: "desktop" }, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

if (!existsSync(join(exportDir, "index.html"))) {
  console.error("renderer: the build finished without apps/web/out/index.html; check next.config.ts sets output: \"export\" for CLAWD_TARGET=desktop");
  process.exit(1);
}
await rm(rendererDir, { recursive: true, force: true });
await cp(exportDir, rendererDir, { recursive: true });
console.log("renderer: copied the export to dist/renderer");
