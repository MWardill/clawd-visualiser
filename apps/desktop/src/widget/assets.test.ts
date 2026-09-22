import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");
const PAGES_RE = /const PAGES = \[([^\]]*)\]/;

describe("the widget page's files", () => {
  it("loads only fonts the bundle step copies beside the page", async () => {
    const css = await read("./page.css");
    const bundle = await read("../../build/bundle.mjs");
    const fonts = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((match) => match[1] ?? "");
    expect(fonts).toEqual(["jetbrains-mono-400.woff2", "jetbrains-mono-700.woff2"]);
    expect(bundle).toMatch(PAGES_RE);
    expect(PAGES_RE.exec(bundle)?.[1] ?? "").toContain('"widget"');
    for (const font of fonts) {
      expect(bundle, font).toContain(`"${font}"]`);
      expect(bundle, font).toContain("dist/${page}/${name}");
    }
    for (const file of ["dist/${page}/index.html", "dist/${page}/page.css", "dist/${page}/page.js", "dist/${page}/preload.js"]) expect(bundle, file).toContain(file);
  });
});
