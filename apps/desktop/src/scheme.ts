// The app:// scheme: how the window's pages and their files are served with no web server. Chromium
// hands main each request for app://<host>/<path>, and main answers from one of two directories — the
// visualiser's and the settings page's — each host with its own Content Security Policy. Electron-free,
// so it is tested.
import { DESKTOP_ORIGIN } from "@clawd/core";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "clawd";
/** Where the window loads the visualiser from when no dev URL is given. */
export const APP_URL = `${DESKTOP_ORIGIN}/`;
/** The settings window's host; its page is served from dist/settings (design §7). */
export const SETTINGS_HOST = "settings";
export const SETTINGS_URL = `${APP_SCHEME}://${SETTINGS_HOST}/`;

type AppUrl = { host: string; pathname: string };

/** The host and path of one of our URLs, or null when it does not parse or is not our scheme. */
function parseAppUrl(url: string): AppUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:`) return null;
  return { host: parsed.host.toLowerCase(), pathname: parsed.pathname };
}

/** Which of our hosts a request names, or null. */
export function hostOf(url: string): string | null {
  return parseAppUrl(url)?.host ?? null;
}

export type SchemeDirs = { clawd: string; settings: string };

const HTML_TYPE = "text/html; charset=utf-8";

/** The only file types served. Anything else is 404, so a stray file in the export is never run. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  html: HTML_TYPE,
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
 * The page may load and fetch its own files, run the inline scripts Next's export emits, and reach
 * only the agent. The renderer is sandboxed too; the network limit is where this policy earns its
 * keep. `'self'` in connect-src is for the router: a page that navigates on the client fetches its
 * own payloads, and without it that fails with nothing said.
 */
export function contentSecurityPolicy(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' http://127.0.0.1:${port} http://localhost:${port}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The settings page talks to main through its preload bridge, never over the network, so it is
 * allowed no connections at all, and no inline scripts. Also what a host we do not serve gets: the
 * strictest policy there is, and one that needs no port.
 */
export const SETTINGS_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Everything that differs between our two hosts, looked up once per request. */
type HostEntry = { dir(dirs: SchemeDirs): string; policy(port: number): string; notFound: string | null };

const HOSTS: ReadonlyMap<string, HostEntry> = new Map<string, HostEntry>([
  [APP_HOST, { dir: (dirs) => dirs.clawd, policy: contentSecurityPolicy, notFound: "404.html" }],
  [SETTINGS_HOST, { dir: (dirs) => dirs.settings, policy: () => SETTINGS_POLICY, notFound: null }],
]);

/**
 * Names Windows treats as devices whatever follows the first dot. On Windows 11 `CON.txt` is an
 * ordinary missing file; on Windows 10 it is the console, and reading it can hang the request.
 */
const DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;
const isDeviceName = (segment: string): boolean => DEVICE_NAME.test((segment.split(".")[0] ?? "").trimEnd());

/**
 * The file a URL's path names inside a directory, or null. The URL parser has already resolved dot
 * segments; what decoding reveals (an encoded slash or backslash, a `..`, a drive letter, a NUL, a
 * device name) is refused, and the result must still lie inside the directory.
 */
function fileFor(pathname: string, dir: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\")) return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  // ":" would let a segment name a drive or an alternate data stream on Windows.
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(":") || isDeviceName(segment))) return null;
  if (segments.length === 0) segments.push("index.html");
  const root = resolve(dir);
  const file = resolve(root, ...segments);
  const inside = relative(root, file);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return null;
  return file;
}

/** The file an app:// URL names inside its host's directory, the visualiser's or the settings page's, or null. */
export function mapRequest(url: string, dirs: SchemeDirs): string | null {
  const parsed = parseAppUrl(url);
  const entry = parsed === null ? undefined : HOSTS.get(parsed.host);
  return parsed === null || entry === undefined ? null : fileFor(parsed.pathname, entry.dir(dirs));
}

/** The served type of a file, by extension; null for any type not in the table. */
export function mimeFor(file: string): string | null {
  const ext = extname(file).slice(1).toLowerCase();
  return Object.hasOwn(MIME_TYPES, ext) ? (MIME_TYPES[ext] ?? null) : null;
}

export type SchemeDeps = {
  /** The renderer's and the settings page's directories: dist/renderer and dist/settings beside main.cjs. */
  dirs: SchemeDirs;
  /** The port of the agent in use, read for each response. */
  port(): number;
  /** The port the policy names if `port` throws. Main passes the agent's default. */
  fallbackPort: number;
  readFile?(path: string): Promise<Uint8Array>;
};

/**
 * The protocol.handle callback. It never rejects, which Chromium would show as a failed load with no
 * policy at all: anything it cannot map, type or read is a 404, the export's own 404 page for a
 * path that looks like a page, plain text otherwise.
 */
export function createSchemeHandler(deps: SchemeDeps): (request: { url: string }) => Promise<Response> {
  const read = deps.readFile ?? ((path: string) => readFile(path));
  const readOrNull = (path: string): Promise<Uint8Array | null> => read(path).then((bytes) => bytes, () => null);
  const port = (): number => {
    try {
      return deps.port();
    } catch {
      return deps.fallbackPort;
    }
  };
  return async (request) => {
    // The strictest policy until the host is known.
    let policy = SETTINGS_POLICY;
    try {
      const parsed = parseAppUrl(request.url);
      const entry = parsed === null ? undefined : HOSTS.get(parsed.host);
      if (parsed !== null && entry !== undefined) {
        policy = entry.policy(port());
        const dir = entry.dir(deps.dirs);
        const file = fileFor(parsed.pathname, dir);
        const type = file === null ? null : mimeFor(file);
        const body = file === null || type === null ? null : await readOrNull(file);
        if (body !== null && type !== null) return new Response(body, { status: 200, headers: { "content-security-policy": policy, "content-type": type } });
        const pageLike = ["", ".html"].includes(extname(parsed.pathname).toLowerCase());
        const notFound = entry.notFound === null || !pageLike ? null : await readOrNull(join(resolve(dir), entry.notFound));
        if (notFound !== null) return new Response(notFound, { status: 404, headers: { "content-security-policy": policy, "content-type": HTML_TYPE } });
      }
    } catch {
      // Whatever threw, the answer is the plain 404 below.
    }
    return new Response("not found", { status: 404, headers: { "content-security-policy": policy, "content-type": "text/plain; charset=utf-8" } });
  };
}
