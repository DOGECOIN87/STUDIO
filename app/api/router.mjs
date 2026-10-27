/**
 * STUDIO DAW API — HTTP router.
 *
 * All /api/* routes live here, in the style of api-anything
 * (github.com/DOGECOIN87/api-anything):
 *   GET  /api/health                  server + api health
 *   GET  /api/sites                   list_sites
 *   GET  /api/operations              list_operations (the full catalog with params)
 *   GET  /api/sessions                connected DAW browser tabs
 *   POST /api/call {site?,op,args?,session?}   call_operation -> {ok,class,tier,data,ms}
 *   POST /api/exports/upload?name=    binary upload of a rendered WAV (used by exportWav)
 *   GET  /api/exports                 rendered WAV list
 *   GET  /api/exports/<name>          download a rendered WAV
 *   DELETE /api/exports/<name>
 *   POST /api/imports/upload?name=    binary upload of source audio for importAudio
 *   GET  /api/imports / GET /api/imports/<name> / DELETE /api/imports/<name>
 *   GET|POST /api/projects[...]       the pre-existing project persistence endpoints
 *
 * Zero dependencies (Node >= 18).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coerceArgs, failEnvelope, okEnvelope, publicOperation, tierFor, validateCatalog, TIER_SERVER } from "./envelope.mjs";
import { createBridgeHub, HubError } from "./ws-hub.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readCatalog() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "operations.json"), "utf8"));
  return validateCatalog(raw);
}

function sanitizeName(name) {
  return (
    String(name || "untitled")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .trim()
      .slice(0, 80) || "untitled"
  );
}

/** File names for the exports/imports folders: no path parts, .wav/.audio kept, safe chars only. */
function sanitizeFileName(name, fallbackExt) {
  const base = path.basename(String(name || "").replace(/\\/g, "/")).trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") return `audio-${Date.now()}${fallbackExt}`;
  return path.extname(cleaned) ? cleaned : cleaned + fallbackExt;
}

function readRequestBody(req, maxBytes) {
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

export function createApi({ projectsDir, exportsDir, importsDir } = {}) {
  const appDir = path.join(__dirname, "..");
  const PROJECTS_DIR = projectsDir || path.join(appDir, "projects");
  const EXPORTS_DIR = exportsDir || path.join(PROJECTS_DIR, "exports");
  const IMPORTS_DIR = importsDir || path.join(PROJECTS_DIR, "imports");
  const EXPORT_MAX_BYTES = Number(process.env.DAW_EXPORT_MAX_BYTES || 512 * 1024 * 1024);
  const IMPORT_MAX_BYTES = Number(process.env.DAW_IMPORT_MAX_BYTES || 256 * 1024 * 1024);
  const CALL_BODY_MAX_BYTES = Number(process.env.DAW_CALL_MAX_BYTES || 96 * 1024 * 1024);
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });

  const catalog = readCatalog();
  const opsByName = new Map(catalog.operations.map((op) => [op.name, op]));
  const hub = createBridgeHub();

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  }

  function listDir(dir, exts) {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x)))
      .map((e) => {
        const stat = fs.statSync(path.join(dir, e.name));
        return { name: e.name, bytes: stat.size, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ----- server-executed (tier 1) operation handlers -----
  const serverOps = {
    getHealth: () => healthPayload(),
    listSessions: () => ({ sessions: hub.listSessions() }),
    listProjectFiles: () => ({
      projects: listDir(PROJECTS_DIR, [".dawproj.json"]).map((f) => ({
        fileName: f.name,
        name: f.name.replace(/\.dawproj\.json$/, ""),
        size: f.bytes,
        updatedAt: f.updatedAt,
      })),
    }),
    getProjectFile: (args) => {
      const full = projectFilePath(args.name);
      if (!full) throw new HubError("input", `project "${args.name}" is not saved on this server`, "listProjectFiles shows what is on disk");
      return JSON.parse(fs.readFileSync(full, "utf8"));
    },
    putProjectFile: (args) => {
      const proj = args.project;
      if (!proj || !Array.isArray(proj.tracks) || !Array.isArray(proj.clips)) {
        throw new HubError("input", "project needs at least tracks[] and clips[] arrays", "getSession returns a valid project payload shape");
      }
      const safe = sanitizeName(args.name || proj.name || "project") + ".dawproj.json";
      const payload = { version: 1, savedAt: new Date().toISOString(), ...proj, name: args.name || proj.name || "project" };
      fs.writeFileSync(path.join(PROJECTS_DIR, safe), JSON.stringify(payload, null, 2), "utf8");
      return { fileName: safe, name: payload.name, bytes: fs.statSync(path.join(PROJECTS_DIR, safe)).size };
    },
    deleteProjectFile: (args) => {
      const full = projectFilePath(args.name);
      if (!full) throw new HubError("input", `project "${args.name}" is not saved on this server`, "listProjectFiles shows what is on disk");
      fs.unlinkSync(full);
      return { deleted: path.basename(full) };
    },
    listExports: () => ({
      exports: listDir(EXPORTS_DIR, [".wav"]).map((f) => ({ ...f, url: `/api/exports/${encodeURIComponent(f.name)}` })),
    }),
    deleteExport: (args) => deleteStoredFile(EXPORTS_DIR, args.name, ".wav"),
    listImports: () => ({
      imports: listDir(IMPORTS_DIR, [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".webm"]).map((f) => ({
        ...f,
        url: `/api/imports/${encodeURIComponent(f.name)}`,
      })),
    }),
  };

  function projectFilePath(name) {
    const safe = sanitizeName(String(name || "").replace(/\.dawproj\.json$/, "")) + ".dawproj.json";
    const full = path.join(PROJECTS_DIR, safe);
    return fs.existsSync(full) ? full : null;
  }

  function deleteStoredFile(dir, name, ext) {
    const safe = sanitizeFileName(name, ext);
    const full = path.join(dir, safe);
    if (!fs.existsSync(full)) throw new HubError("input", `no file named "${safe}"`, `listExports / listImports show what is stored`);
    fs.unlinkSync(full);
    return { deleted: safe };
  }

  function healthPayload() {
    return {
      status: "ok",
      app: "STUDIO",
      domain: "audius-studio.online",
      platform: process.platform,
      node: process.version,
      api: {
        name: catalog.site.name,
        version: catalog.apiVersion,
        operations: catalog.operations.length,
        readOnlyOperations: catalog.operations.filter((o) => o.readOnly).length,
        sessions: hub.sessionCount,
        endpoints: ["/api/sites", "/api/operations", "/api/sessions", "/api/call", "/api/exports", "/api/imports", "/api/projects"],
        style: "api-anything envelope: {ok, class, tier, data, ms} / {ok:false, class, reason, next}",
      },
    };
  }

  /** POST /api/call — the single call entry point, api-anything's call_operation over HTTP. */
  async function handleCall(req, res, url) {
    const started = Date.now();
    let body;
    try {
      const buf = await readRequestBody(req, CALL_BODY_MAX_BYTES);
      body = buf.length ? JSON.parse(buf.toString("utf8")) : {};
    } catch (err) {
      return sendJson(res, 400, failEnvelope("input", `the call body is not valid JSON (${err.message})`, 'POST {"op":"<name>","args":{...}} to /api/call', { ms: Date.now() - started }));
    }
    const site = body.site || catalog.site.name;
    if (site !== catalog.site.name) {
      return sendJson(res, 404, failEnvelope("input", `unknown site "${site}"`, "GET /api/sites lists the sites this server exposes", { ms: Date.now() - started }));
    }
    const opName = String(body.op || body.operation || "");
    const op = opsByName.get(opName);
    if (!op) {
      return sendJson(res, 404, failEnvelope("input", opName ? `unknown operation "${opName}"` : "no operation given", "GET /api/operations (or: daw-api ops) lists every operation with its params", { ms: Date.now() - started }));
    }
    const coerced = coerceArgs(op, body.args);
    if (!coerced.ok) {
      return sendJson(res, 400, failEnvelope("input", coerced.reason, coerced.hint ? `${coerced.hint}; GET /api/operations?op=${encodeURIComponent(op.name)} shows the full param spec` : `GET /api/operations?op=${encodeURIComponent(op.name)} shows the full param spec`, { ms: Date.now() - started }));
    }
    const args = coerced.args;
    const tier = tierFor(op);

    try {
      if (op.executor === "server") {
        const data = await serverOps[op.name](args);
        return sendJson(res, 200, okEnvelope(data, TIER_SERVER, Date.now() - started));
      }
      const timeoutMs = Number(op.timeoutMs || 20000);
      const result = await hub.call(op.name, args, { sessionId: String(body.session || ""), timeoutMs });
      return sendJson(res, 200, okEnvelope(result.data, tier, Date.now() - started, { pageMs: result.ms }));
    } catch (err) {
      if (err instanceof HubError) {
        const status = err.cls === "blocked" ? 503 : err.cls === "input" ? 400 : 502;
        return sendJson(res, status, failEnvelope(err.cls, err.reason, err.next, { ms: Date.now() - started, tier }));
      }
      return sendJson(res, 500, failEnvelope("error", err && err.message ? err.message : String(err), "the server failed to run the operation; retry once", { ms: Date.now() - started, tier }));
    }
  }

  async function handleUpload(req, res, url, dir, maxBytes, fallbackExt, kind) {
    const name = sanitizeFileName(url.searchParams.get("name") || "", fallbackExt);
    let buf;
    try {
      buf = await readRequestBody(req, maxBytes);
    } catch (err) {
      return sendJson(res, 413, failEnvelope("input", err.message, `keep ${kind} uploads under ${Math.round(maxBytes / (1024 * 1024))} MB`));
    }
    if (!buf.length) return sendJson(res, 400, failEnvelope("input", "the upload body is empty", "send the raw file bytes as the request body"));
    const full = path.join(dir, name);
    fs.writeFileSync(full, buf);
    return sendJson(res, 200, {
      ok: true,
      name,
      url: `/api/${kind}/${encodeURIComponent(name)}`,
      bytes: buf.length,
    });
  }

  function streamStoredFile(res, dir, name, contentType) {
    const safe = sanitizeFileName(name, path.extname(name) || ".bin");
    const full = path.join(dir, safe);
    if (!full.startsWith(dir) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      sendJson(res, 404, failEnvelope("input", `no file named "${safe}"`, `listExports / listImports show what is stored`));
      return true;
    }
    const stat = fs.statSync(full);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safe.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(full).pipe(res);
    return true;
  }

  /**
   * Handle any /api/* request. Returns true when the response was handled here,
   * false when the route is unknown (the caller falls through to static files,
   * which keeps the old "Not found" behaviour for /api/typos).
   */
  async function handle(req, res, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) return false;
    const method = req.method || "GET";

    // CORS preflight for cross-origin API clients.
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return true;
    }

    try {
      // ---- discovery (api-anything's list_sites / list_operations) ----
      if (method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, healthPayload());
        return true;
      }
      if (method === "GET" && pathname === "/api/sites") {
        sendJson(res, 200, {
          sites: [
            {
              name: catalog.site.name,
              displayName: catalog.site.displayName,
              baseUrl: catalog.site.baseUrl,
              description: catalog.site.description,
              operations: catalog.operations.length,
              readOnlyOperations: catalog.operations.filter((o) => o.readOnly).length,
              sessions: hub.listSessions().length,
            },
          ],
        });
        return true;
      }
      if (method === "GET" && pathname === "/api/operations") {
        const onlyOp = url.searchParams.get("op");
        const onlyExecutor = url.searchParams.get("executor");
        const onlyReadOnly = url.searchParams.get("readOnly");
        let ops = catalog.operations;
        if (onlyOp) ops = ops.filter((o) => o.name === onlyOp);
        if (onlyExecutor) ops = ops.filter((o) => o.executor === onlyExecutor);
        if (onlyReadOnly === "true") ops = ops.filter((o) => o.readOnly);
        if (onlyReadOnly === "false") ops = ops.filter((o) => !o.readOnly);
        sendJson(res, 200, {
          site: { name: catalog.site.name, displayName: catalog.site.displayName, baseUrl: catalog.site.baseUrl, description: catalog.site.description },
          apiVersion: catalog.apiVersion,
          operations: ops.map(publicOperation),
        });
        return true;
      }
      if (method === "GET" && pathname === "/api/sessions") {
        sendJson(res, 200, { sessions: hub.listSessions() });
        return true;
      }

      // ---- the call entry point ----
      if (method === "POST" && pathname === "/api/call") {
        await handleCall(req, res, url);
        return true;
      }

      // ---- rendered exports ----
      if (method === "POST" && pathname === "/api/exports/upload") {
        await handleUpload(req, res, url, EXPORTS_DIR, EXPORT_MAX_BYTES, ".wav", "exports");
        return true;
      }
      if (method === "GET" && pathname === "/api/exports") {
        sendJson(res, 200, {
          exports: listDir(EXPORTS_DIR, [".wav"]).map((f) => ({ ...f, url: `/api/exports/${encodeURIComponent(f.name)}` })),
        });
        return true;
      }
      if (method === "GET" && pathname.startsWith("/api/exports/")) {
        return streamStoredFile(res, EXPORTS_DIR, decodeURIComponent(pathname.slice("/api/exports/".length)), "audio/wav");
      }
      if (method === "DELETE" && pathname.startsWith("/api/exports/")) {
        try {
          sendJson(res, 200, okEnvelope(deleteStoredFile(EXPORTS_DIR, decodeURIComponent(pathname.slice("/api/exports/".length)), ".wav"), TIER_SERVER, 0));
        } catch (err) {
          sendJson(res, 404, failEnvelope("input", err.message, "listExports shows what is stored"));
        }
        return true;
      }

      // ---- import inbox (source audio for importAudio url=...) ----
      if (method === "POST" && pathname === "/api/imports/upload") {
        await handleUpload(req, res, url, IMPORTS_DIR, IMPORT_MAX_BYTES, ".wav", "imports");
        return true;
      }
      if (method === "GET" && pathname === "/api/imports") {
        sendJson(res, 200, {
          imports: listDir(IMPORTS_DIR, [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".webm"]).map((f) => ({
            ...f,
            url: `/api/imports/${encodeURIComponent(f.name)}`,
          })),
        });
        return true;
      }
      if (method === "GET" && pathname.startsWith("/api/imports/")) {
        const name = decodeURIComponent(pathname.slice("/api/imports/".length));
        const ext = path.extname(name).toLowerCase();
        const types = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".webm": "audio/webm" };
        return streamStoredFile(res, IMPORTS_DIR, name, types[ext] || "application/octet-stream");
      }
      if (method === "DELETE" && pathname.startsWith("/api/imports/")) {
        try {
          sendJson(res, 200, okEnvelope(deleteStoredFile(IMPORTS_DIR, decodeURIComponent(pathname.slice("/api/imports/".length)), ".wav"), TIER_SERVER, 0));
        } catch (err) {
          sendJson(res, 404, failEnvelope("input", err.message, "listImports shows what is stored"));
        }
        return true;
      }

      // ---- legacy project persistence (used by app.js in the browser) ----
      if (method === "GET" && pathname === "/api/projects") {
        sendJson(res, 200, serverOps.listProjectFiles());
        return true;
      }
      if (method === "GET" && pathname.startsWith("/api/projects/")) {
        const rawName = pathname.slice("/api/projects/".length);
        const safe = sanitizeName(decodeURIComponent(rawName).replace(/\.dawproj\.json$/, "")) + ".dawproj.json";
        const full = path.join(PROJECTS_DIR, safe);
        if (!fs.existsSync(full)) {
          sendJson(res, 404, { error: "Project not found" });
          return true;
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(fs.readFileSync(full, "utf8"));
        return true;
      }
      if (method === "POST" && pathname === "/api/projects") {
        const buf = await readRequestBody(req, 50 * 1024 * 1024);
        const data = JSON.parse(buf.toString("utf8"));
        const safe = sanitizeName(data.name || "project") + ".dawproj.json";
        fs.writeFileSync(path.join(PROJECTS_DIR, safe), JSON.stringify(data, null, 2), "utf8");
        sendJson(res, 200, { ok: true, fileName: safe });
        return true;
      }
    } catch (err) {
      sendJson(res, 500, failEnvelope("error", err && err.message ? err.message : String(err), "the server failed to run the request; retry once"));
      return true;
    }
    return false;
  }

  return { handle, attachWs: (server) => hub.attach(server), hub, catalog, dirs: { PROJECTS_DIR, EXPORTS_DIR, IMPORTS_DIR } };
}
