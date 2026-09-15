import { DESKTOP_ORIGIN } from "@clawd/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_HOST, APP_SCHEME, APP_URL, contentSecurityPolicy, createSchemeHandler, mapRequest, mimeFor } from "./scheme";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawd-scheme-"));
  made.push(dir);
  return dir;
}

const ROOT = resolve("renderer-root");

describe("the app origin", () => {
  it("is core's desktop origin, so the window and the agent's CORS check agree", () => {
    expect(`${APP_SCHEME}://${APP_HOST}`).toBe(DESKTOP_ORIGIN);
    expect(APP_URL).toBe("app://clawd/");
  });
});

describe("mapRequest", () => {
  it("maps the root to index.html and any other path to that file under the renderer directory", () => {
    expect(mapRequest("app://clawd/", ROOT)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd", ROOT)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd/_next/static/chunks/a.js", ROOT)).toBe(join(ROOT, "_next", "static", "chunks", "a.js"));
    expect(mapRequest("app://CLAWD/index.txt", ROOT)).toBe(join(ROOT, "index.txt"));
  });

  it("ignores the query and the hash, and decodes the path", () => {
    expect(mapRequest("app://clawd/favicon.ico?favicon.2vob68tjqpejf.ico", ROOT)).toBe(join(ROOT, "favicon.ico"));
    expect(mapRequest("app://clawd/index.html#top", ROOT)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd/media/a%20b.woff2", ROOT)).toBe(join(ROOT, "media", "a b.woff2"));
  });

  it("keeps a path whose dot segments the URL parser resolved inside the directory", () => {
    expect(mapRequest("app://clawd/../../secret.txt", ROOT)).toBe(join(ROOT, "secret.txt"));
    expect(mapRequest("app://clawd/%2e%2e/secret.txt", ROOT)).toBe(join(ROOT, "secret.txt"));
  });

  it("refuses other schemes and hosts, encoded traversal, backslashes, drive letters, NUL, bad escapes and non-URLs", () => {
    for (const url of [
      "http://clawd/index.html",
      "app://settings/index.html",
      "app://clawd/..%2F..%2Fsecret.txt",
      "app://clawd/%5C..%5Csecret.txt",
      "app://clawd/C:/Windows/win.ini",
      "app://clawd/index.html%00.js",
      "app://clawd/%E0%A4%A",
      "not a url",
    ]) {
      expect(mapRequest(url, ROOT), url).toBeNull();
    }
  });
});

describe("mimeFor", () => {
  it("types the export's files from a fixed table, and nothing else", () => {
    expect(mimeFor(join(ROOT, "index.html"))).toBe("text/html; charset=utf-8");
    expect(mimeFor("a.JS")).toBe("text/javascript; charset=utf-8");
    expect(mimeFor("a.css")).toBe("text/css; charset=utf-8");
    expect(mimeFor("font.woff2")).toBe("font/woff2");
    expect(mimeFor("index.txt")).toBe("text/plain; charset=utf-8");
    expect(mimeFor("favicon.ico")).toBe("image/x-icon");
    expect(mimeFor("a.js.map")).toBe("application/json; charset=utf-8");
    expect(mimeFor("setup.exe")).toBeNull();
    expect(mimeFor("README")).toBeNull();
    expect(mimeFor("x.constructor")).toBeNull();
  });
});

describe("contentSecurityPolicy", () => {
  it("is the design's policy with the agent's port", () => {
    expect(contentSecurityPolicy(4750)).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src http://127.0.0.1:4750 http://localhost:4750; frame-ancestors 'none'",
    );
  });
});

describe("createSchemeHandler", () => {
  it("serves a file with its type and the policy, and answers 404 with the policy for anything unmapped, untyped or missing", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<p>hi</p>");
    await writeFile(join(dir, "setup.exe"), "MZ");
    const handle = createSchemeHandler({ rendererDir: dir, port: () => 4750 });

    const page = await handle({ url: "app://clawd/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));
    expect(await page.text()).toBe("<p>hi</p>");

    for (const url of ["app://clawd/setup.exe", "app://clawd/missing.js", "app://clawd/..%2Fsecret.txt", "app://settings/"]) {
      const res = await handle({ url });
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));
    }
  });

  it("reads the port for each response, so the policy follows the agent in use", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "");
    let port = 4750;
    const handle = createSchemeHandler({ rendererDir: dir, port: () => port });
    port = 4800;
    expect((await handle({ url: "app://clawd/" })).headers.get("content-security-policy")).toContain("connect-src http://127.0.0.1:4800 http://localhost:4800;");
  });
});
