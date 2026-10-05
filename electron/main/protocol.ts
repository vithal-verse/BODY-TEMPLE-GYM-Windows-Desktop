import { net, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "app";
export const APP_ORIGIN = "app://local";

/** No remote content is ever loaded: scripts/styles/fonts/images come from the app itself, and the page cannot make network requests. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Next.js static export inlines small hydration scripts
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Must run before app 'ready'. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Maps a URL path to a file inside `root`, or null. Cannot escape `root`. Exported for tests. */
export function resolveAppFile(root: string, pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0") || /[\\:*?"<>|]/.test(rel)) return null; // also blocks NTFS alternate data streams
  const clean = path.posix.normalize("/" + rel);
  const base = path.resolve(root);
  let candidate = path.join(base, ...clean.split("/").filter(Boolean));
  if (clean.endsWith("/")) candidate = path.join(candidate, "index.html");
  if (candidate !== base && !candidate.startsWith(base + path.sep)) return null;
  for (const c of [candidate, candidate + ".html", path.join(candidate, "index.html")]) {
    if (c.startsWith(base) && isFile(c)) return c;
  }
  return null;
}

export function registerAppProtocol(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "local") return new Response("Not found", { status: 404 });
    const file = resolveAppFile(root, url.pathname);
    const target = file ?? path.join(root, "404.html");
    if (!isFile(target)) return new Response("Not found", { status: 404, headers: { "Content-Security-Policy": CSP } });
    const res = await net.fetch(pathToFileURL(target).toString());
    const headers = new Headers(res.headers);
    headers.set("Content-Security-Policy", CSP);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(res.body, { status: file ? 200 : 404, headers });
  });
}
