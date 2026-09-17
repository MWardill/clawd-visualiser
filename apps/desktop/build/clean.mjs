// Removes the build output, so nothing from an older build is bundled or packaged beside the new one.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await rm(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true, force: true });
