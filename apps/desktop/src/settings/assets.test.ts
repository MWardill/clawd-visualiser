import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");

describe("the settings page's files", () => {
  it("loads only fonts the bundle step copies beside the page", async () => {
    const css = await read("./page.css");
    const bundle = await read("../../build/bundle.mjs");
    const fonts = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((match) => match[1] ?? "");
    expect(fonts).toEqual(["jetbrains-mono-400.woff2", "jetbrains-mono-700.woff2"]);
    expect(bundle).toMatch(/const PAGES = \[([^\]]*)\]/);
    expect(/const PAGES = \[([^\]]*)\]/.exec(bundle)?.[1] ?? "").toContain('"settings"');
    for (const font of fonts) expect(bundle, font).toContain(`"${font}"]`);
  });

  it("keeps the preload free of the schema library: it imports the channel names and types, nothing else of ours", async () => {
    const preload = await read("./preload.ts");
    // `\r?` because a Windows checkout may hold CRLF line endings.
    const imports = [...preload.matchAll(/^import (type )?.* from "([^"]+)";\r?$/gm)].map((match) => `${match[1] ?? ""}${match[2] ?? ""}`);
    expect(imports).toEqual(["electron", "./channels", "type ./state"]);
    expect(await read("./channels.ts")).not.toMatch(/^\s*import\s/m);
  });
});
