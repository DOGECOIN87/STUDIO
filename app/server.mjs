#!/usr/bin/env node
/**
 * PulseForge DAW — Local Ubuntu & Web Workstation Server
 * Zero external dependencies. Serves the DAW frontend and provides local disk
 * persistence for projects and imported/exported audio files under ./projects.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const PROJECTS_DIR = path.join(__dirname, "projects");

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

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
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sanitizeName(name) {
  return String(name || "untitled")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim()
    .slice(0, 80) || "untitled";
}

function readRequestBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    // Health check
    if (req.method === "GET" && pathname === "/api/health") {
      return sendJson(res, 200, {
        status: "ok",
        app: "PulseForge DAW",
        platform: process.platform,
        node: process.version,
      });
    }

    // List saved projects on disk
    if (req.method === "GET" && pathname === "/api/projects") {
      const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
      const projects = entries
        .filter((e) => e.isFile() && e.name.endsWith(".dawproj.json"))
        .map((e) => {
          const full = path.join(PROJECTS_DIR, e.name);
          const stat = fs.statSync(full);
          return {
            fileName: e.name,
            name: e.name.replace(/\.dawproj\.json$/, ""),
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return sendJson(res, 200, { projects });
    }

    // Load a saved project from disk
    if (req.method === "GET" && pathname.startsWith("/api/projects/")) {
      const rawName = pathname.slice("/api/projects/".length);
      const safe = sanitizeName(rawName.replace(/\.dawproj\.json$/, "")) + ".dawproj.json";
      const full = path.join(PROJECTS_DIR, safe);
      if (!fs.existsSync(full)) {
        return sendJson(res, 404, { error: "Project not found" });
      }
      const content = fs.readFileSync(full, "utf-8");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(content);
    }

    // Save project to disk
    if (req.method === "POST" && pathname === "/api/projects") {
      const bodyBuf = await readRequestBody(req);
      const data = JSON.parse(bodyBuf.toString("utf-8"));
      const safe = sanitizeName(data.name || "project") + ".dawproj.json";
      const full = path.join(PROJECTS_DIR, safe);
      fs.writeFileSync(full, JSON.stringify(data, null, 2), "utf-8");
      return sendJson(res, 200, { ok: true, fileName: safe });
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
    sendJson(res, 500, { error: err?.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PulseForge DAW listening on http://${HOST}:${PORT}`);
});

// Also listen on ports 3005 and 3008 so Arena Live Preview opens a fresh uncached preview tab automatically
for (const altPort of [3005, 3008]) {
  if (PORT !== altPort) {
    const altServer = http.createServer(server.listeners("request")[0]);
    altServer.listen(altPort, HOST, () => {
      console.log(`PulseForge DAW (Live Preview) listening on http://${HOST}:${altPort}`);
    });
  }
}
