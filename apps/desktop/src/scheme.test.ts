import { DESKTOP_ORIGIN } from "@clawd/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
  contentSecurityPolicy,
  createSchemeHandler,
  hostOf,
  mapRequest,
  mimeFor,
  SETTINGS_URL,
  SETTINGS_POLICY,
  WIDGET_URL,
} from "./scheme";

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
const SETTINGS = resolve("settings-root");
const WIDGET = resolve("widget-root");
const DIRS = { clawd: ROOT, settings: SETTINGS, widget: WIDGET };

describe("the app origin", () => {
  it("is core's desktop origin, so the window and the agent's CORS check agree", () => {
    expect(`${APP_SCHEME}://${APP_HOST}`).toBe(DESKTOP_ORIGIN);
    expect(APP_URL).toBe("app://clawd/");
    expect(SETTINGS_URL).toBe("app://settings/");
  });
});

describe("hostOf", () => {
  it("names our hosts, whatever the case, and nothing else", () => {
    expect(hostOf("app://clawd/index.html")).toBe("clawd");
    expect(hostOf("app://SETTINGS/page.js")).toBe("settings");
    expect(hostOf("app://settingsfoo/index.html")).toBe("settingsfoo");
    expect(hostOf("http://clawd/index.html")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("mapRequest", () => {
  it("maps the root to index.html and any other path to that file under the renderer directory", () => {
    expect(mapRequest("app://clawd/", DIRS)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd", DIRS)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd/_next/static/chunks/a.js", DIRS)).toBe(join(ROOT, "_next", "static", "chunks", "a.js"));
    expect(mapRequest("app://CLAWD/index.txt", DIRS)).toBe(join(ROOT, "index.txt"));
  });

  it("ignores the query and the hash, and decodes the path", () => {
    expect(mapRequest("app://clawd/favicon.ico?favicon.2vob68tjqpejf.ico", DIRS)).toBe(join(ROOT, "favicon.ico"));
    expect(mapRequest("app://clawd/index.html#top", DIRS)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd/media/a%20b.woff2", DIRS)).toBe(join(ROOT, "media", "a b.woff2"));
  });

  it("keeps a path whose dot segments the URL parser resolved inside the directory", () => {
    expect(mapRequest("app://clawd/../../secret.txt", DIRS)).toBe(join(ROOT, "secret.txt"));
    expect(mapRequest("app://clawd/%2e%2e/secret.txt", DIRS)).toBe(join(ROOT, "secret.txt"));
  });

  it("refuses other schemes and hosts, encoded traversal, backslashes, drive letters, NUL, bad escapes and non-URLs", () => {
    for (const url of [
      "http://clawd/index.html",
      "app://other/index.html",
      "app://clawd/..%2F..%2Fsecret.txt",
      "app://clawd/%5C..%5Csecret.txt",
      "app://clawd/C:/Windows/win.ini",
      "app://clawd/index.html%00.js",
      "app://clawd/%E0%A4%A",
      "not a url",
    ]) {
      expect(mapRequest(url, DIRS), url).toBeNull();
    }
  });

  it("refuses a segment whose name before the first dot is a Windows device, which Windows 10 would open as one", () => {
    for (const url of ["app://clawd/CON", "app://clawd/con.txt", "app://clawd/NUL.js", "app://clawd/_next/COM1.json", "app://clawd/lpt9.tar.gz", "app://clawd/aux%20.css", "app://clawd/PRN/index.html", "app://clawd/CONIN$"]) {
      expect(mapRequest(url, DIRS), url).toBeNull();
    }
    // Only the whole name before the first dot counts: these are ordinary files.
    expect(mapRequest("app://clawd/console.js", DIRS)).toBe(join(ROOT, "console.js"));
    expect(mapRequest("app://clawd/com10.js", DIRS)).toBe(join(ROOT, "com10.js"));
    expect(mapRequest("app://clawd/icon.con", DIRS)).toBe(join(ROOT, "icon.con"));
  });
});

describe("the settings host", () => {
  it("serves the settings page from its own directory, and refuses any other host", () => {
    expect(mapRequest("app://settings/", DIRS)).toBe(join(SETTINGS, "index.html"));
    expect(mapRequest("app://settings/page.js", DIRS)).toBe(join(SETTINGS, "page.js"));
    expect(mapRequest("app://other/index.html", DIRS)).toBeNull();
    expect(mapRequest("app://settings/..%2F..%2Fmain.cjs", DIRS)).toBeNull();
  });

  it("gives the settings page a policy that lets it reach nothing", () => {
    expect(SETTINGS_POLICY).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'",
    );
  });
});

describe("the widget host", () => {
  it("serves the widget page from its own directory, and nothing outside it", () => {
    expect(WIDGET_URL).toBe("app://widget/");
    expect(mapRequest("app://widget/", DIRS)).toBe(join(WIDGET, "index.html"));
    expect(mapRequest("app://widget/page.js", DIRS)).toBe(join(WIDGET, "page.js"));
    expect(mapRequest("app://widget/..%2Fsettings%2Fpage.js", DIRS)).toBeNull();
  });

  it("gives a widget the policy that lets a page reach nothing: it is sent its snapshot, and fetches none", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<canvas></canvas>");
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir, widget: dir }, port: () => 4750, fallbackPort: 4750 });
    const page = await handle({ url: "app://widget/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(SETTINGS_POLICY);
    expect(SETTINGS_POLICY).toContain("connect-src 'none'");
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
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://127.0.0.1:4750 http://localhost:4750; frame-ancestors 'none'",
    );
  });
});

describe("createSchemeHandler", () => {
  it("serves a file with its type and the policy, and answers 404 with the policy for anything unmapped, untyped or missing", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<p>hi</p>");
    await writeFile(join(dir, "setup.exe"), "MZ");
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir, widget: dir }, port: () => 4750, fallbackPort: 4750 });

    const page = await handle({ url: "app://clawd/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));
    expect(await page.text()).toBe("<p>hi</p>");

    for (const url of ["app://clawd/setup.exe", "app://clawd/missing.js", "app://clawd/..%2Fsecret.txt"]) {
      const res = await handle({ url });
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));
    }
    const other = await handle({ url: "app://other/" });
    expect(other.status).toBe(404);
    expect(other.headers.get("content-security-policy")).toBe(SETTINGS_POLICY);
  });

  it("reads the port for each response, so the policy follows the agent in use", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "");
    let port = 4750;
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir, widget: dir }, port: () => port, fallbackPort: 4750 });
    port = 4800;
    expect((await handle({ url: "app://clawd/" })).headers.get("content-security-policy")).toContain("connect-src 'self' http://127.0.0.1:4800 http://localhost:4800;");
  });

  it("serves the settings page under its own policy", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<p>settings</p>");
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir, widget: dir }, port: () => 4750, fallbackPort: 4750 });
    const page = await handle({ url: "app://settings/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(SETTINGS_POLICY);
  });

  it("answers 404 under the settings host with the settings policy, and treats a host that merely starts with it as unknown", async () => {
    const dir = await tempDir();
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir, widget: dir }, port: () => 4750, fallbackPort: 4750 });
    const missing = await handle({ url: "app://settings/missing.js" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-security-policy")).toBe(SETTINGS_POLICY);
    const other = await handle({ url: "app://settingsfoo/index.html" });
    expect(other.status).toBe(404);
    expect(other.headers.get("content-security-policy")).toBe(SETTINGS_POLICY);
  });

  it("never rejects: a port getter that throws falls back to the given port, and a read that rejects is a 404", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<p>hi</p>");
    const throwing = createSchemeHandler({
      dirs: { clawd: dir, settings: dir, widget: dir },
      port: () => {
        throw new Error("no host yet");
      },
      fallbackPort: 4750,
    });
    const page = await throwing({ url: "app://clawd/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));

    const unreadable = createSchemeHandler({
      dirs: { clawd: dir, settings: dir, widget: dir },
      port: () => 4750,
      fallbackPort: 4750,
      readFile: async () => {
        throw new Error("EIO");
      },
    });
    const res = await unreadable({ url: "app://clawd/" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("answers a missing page with the export's 404.html when there is one, and anything else with plain text", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "404.html"), "<p>gone</p>");
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir, widget: dir }, port: () => 4750, fallbackPort: 4750 });
    for (const url of ["app://clawd/nowhere", "app://clawd/nowhere.html", "app://clawd/a/b/"]) {
      const res = await handle({ url });
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-type"), url).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-security-policy"), url).toBe(contentSecurityPolicy(4750));
      expect(await res.text(), url).toBe("<p>gone</p>");
    }
    const script = await handle({ url: "app://clawd/missing.js" });
    expect(script.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await script.text()).toBe("not found");
    // The settings page has one route and no 404 page of its own.
    const settings = await handle({ url: "app://settings/nowhere" });
    expect(settings.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
});
