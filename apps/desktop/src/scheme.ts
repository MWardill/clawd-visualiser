// The app:// scheme: how the window's page and its files are served with no web server. Chromium
// hands main each request for app://clawd/<path>, and main answers from the static export copied to
// dist/renderer, with a Content Security Policy on every response. Electron-free, so it is tested.
import { DESKTOP_ORIGIN } from "@clawd/core";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "clawd";
/** Where the window loads the visualiser from when no dev URL is given. */
export const APP_URL = `${DESKTOP_ORIGIN}/`;
/** The settings window's host; its page is served from dist/settings (design §7). */
export const SETTINGS_HOST = "settings";
export const SETTINGS_URL = `${APP_SCHEME}://${SETTINGS_HOST}/`;

export type SchemeDirs = { clawd: string; settings: string };

/** The only file types served. Anything else is 404, so a stray file in the export is never run. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  // Next's export writes its page payloads as .txt, and its router accepts them only as text/plain.
  txt: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
};

/**
 * The file an app:// URL names inside the renderer directory, or null. The URL parser has already
 * resolved dot segments; what decoding reveals (an encoded slash or backslash, a `..`, a drive
 * letter, a NUL) is refused, and the result must still lie inside the directory.
 */
export function mapRequest(url: string, dirs: SchemeDirs): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:`) return null;
  const host = parsed.host.toLowerCase();
  let root = host === APP_HOST ? dirs.clawd : host === SETTINGS_HOST ? dirs.settings : null;
  if (root === null) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\")) return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  // ":" would let a segment name a drive or an alternate data stream on Windows.
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))) return null;
  if (segments.length === 0) segments.push("index.html");
  root = resolve(root);
  const file = resolve(root, ...segments);
  const inside = relative(root, file);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return null;
  return file;
}

/** The served type of a file, by extension; null for any type not in the table. */
export function mimeFor(file: string): string | null {
  const ext = extname(file).slice(1).toLowerCase();
  return Object.hasOwn(MIME_TYPES, ext) ? (MIME_TYPES[ext] ?? null) : null;
}

/**
 * The page may load its own files, run the inline scripts Next's export emits, and reach only the
 * agent. The renderer is sandboxed too; the network limit is where this policy earns its keep.
 */
export function contentSecurityPolicy(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src http://127.0.0.1:${port} http://localhost:${port}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The settings page talks to main through its preload bridge, never over the network, so it is
 * allowed no connections at all, and no inline scripts.
 */
export function settingsPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export type SchemeDeps = {
  /** The renderer's and the settings page's directories: dist/renderer and dist/settings beside main.cjs. */
  dirs: SchemeDirs;
  /** The port of the agent in use, read for each response. */
  port(): number;
  readFile?(path: string): Promise<Uint8Array>;
};

/** The protocol.handle callback. Anything it cannot map, type or read is answered with a 404. */
export function createSchemeHandler(deps: SchemeDeps): (request: { url: string }) => Promise<Response> {
  const read = deps.readFile ?? ((path: string) => readFile(path));
  return async (request) => {
    const settings = request.url.toLowerCase().startsWith(`${APP_SCHEME}://${SETTINGS_HOST}`);
    const policy = { "content-security-policy": settings ? settingsPolicy() : contentSecurityPolicy(deps.port()) };
    const file = mapRequest(request.url, deps.dirs);
    const type = file === null ? null : mimeFor(file);
    if (file !== null && type !== null) {
      try {
        return new Response(await read(file), { status: 200, headers: { ...policy, "content-type": type } });
      } catch {
        // Missing or unreadable: the same 404 as a path that maps nowhere.
      }
    }
    return new Response("not found", { status: 404, headers: { ...policy, "content-type": "text/plain; charset=utf-8" } });
  };
}
