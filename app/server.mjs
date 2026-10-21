#!/usr/bin/env node
/**
 * Audius Studio (audius-studio.online) — Local Ubuntu & Web Workstation Server
 * Zero external dependencies. Serves the DAW frontend and the DAW API:
 *
 *   /api/*   discovery + calls in the style of api-anything
 *            (github.com/DOGECOIN87/api-anything): {ok, class, tier, data, ms}.
 *            File operations run here (tier 1); session operations are bridged
 *            over WebSocket (/api/ws) into a live DAW browser tab (tier 3),
 *            so the real Web Audio engine executes them. See app/api/README.md.
 *   ./projects        saved .dawproj.json files, plus exports/ and imports/
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./api/router.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

const api = createApi();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
};

const requestListener = async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    // Every /api/* route (health, sites, operations, sessions, call, exports,
    // imports, projects) lives in the API router.
    if (pathname.startsWith("/api/")) {
      const handled = await api.handle(req, res, url);
      if (handled) return;
    }

    // Serve static files from PUBLIC_DIR
    let relPath = pathname === "/" ? "/index.html" : pathname;
    const resolved = path.normalize(path.join(PUBLIC_DIR, relPath));
    if (!resolved.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      });
      fs.createReadStream(resolved).pipe(res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    const body = JSON.stringify({ error: err?.message || "Internal server error" });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(body);
  }
};

const server = http.createServer(requestListener);
api.attachWs(server);

server.listen(PORT, HOST, () => {
  console.log(`Audius Studio listening on http://${HOST}:${PORT}`);
  console.log(`DAW API ready: GET /api/operations · POST /api/call · docs in app/api/README.md`);
});

// Also listen on ports 3005, 3008, 3009, 3010, 3011, 3012, and 3013 so Arena Live Preview opens a fresh uncached preview tab automatically
for (const altPort of [3005, 3008, 3009, 3010, 3011, 3012, 3013]) {
  if (PORT !== altPort) {
    const altServer = http.createServer(requestListener);
    api.attachWs(altServer);
    altServer.listen(altPort, HOST, () => {
      console.log(`Audius Studio (Live Preview) listening on http://${HOST}:${altPort}`);
    });
  }
}
