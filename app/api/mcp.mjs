#!/usr/bin/env node
/**
 * Audius Studio DAW — MCP server (stdio), shaped like api-anything's
 * (github.com/DOGECOIN87/api-anything) so an agent drives the DAW with the
 * same three meta-tools it already knows:
 *
 *   list_sites        the DAW site and whether a browser tab is connected
 *   list_operations   every operation with params (writes hidden unless allowed)
 *   call_operation    {site?, op, args?, session?} -> {ok, class, tier, data, ms}
 *
 * Wire format: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio
 * transport). Zero dependencies (Node >= 18).
 *
 * Run:   node app/api/mcp.mjs [--allow-writes] [--api http://127.0.0.1:3000]
 * Env:   DAW_API_URL, DAW_API_ALLOW_WRITES=1
 *
 * Like api-anything, write operations change the user's session: they are
 * hidden from list_operations and refused by call_operation unless this
 * server was started with --allow-writes.
 */
import readline from "node:readline";

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagValue = (f) => {
  const i = argv.indexOf(f);
  return i !== -1 ? argv[i + 1] : undefined;
};

const API = (flagValue("--api") || process.env.DAW_API_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const ALLOW_WRITES = hasFlag("--allow-writes") || process.env.DAW_API_ALLOW_WRITES === "1";
const VERSION = "1.0.0";
const SITE_HINT = "Audius Studio DAW (local server + one open DAW browser tab)";

let catalogCache = null;

async function apiGet(path) {
  const r = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${path} failed with HTTP ${r.status}`);
  return await r.json();
}

async function getCatalog(force = false) {
  if (!catalogCache || force) catalogCache = await apiGet("/api/operations");
  return catalogCache;
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const toolResult = (v, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(v) }],
  isError,
});

/** Like api-anything: a list of records goes over MCP as {columns, rows} when that shortens the JSON. */
function asTable(data) {
  const isRecord = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  if (!Array.isArray(data) || data.length < 2 || !data.every(isRecord)) return data;
  const keys = new Set();
  let fields = 0;
  for (const record of data) {
    const names = Object.keys(record);
    fields += names.length;
    for (const name of names) keys.add(name);
  }
  const sourceSize = JSON.stringify(data).length;
  if ((data.length * keys.size - fields) * 4 > sourceSize) return data;
  const columns = Array.from(keys);
  const table = { columns, rows: data.map((x) => columns.map((c) => (Object.prototype.hasOwnProperty.call(x, c) ? x[c] : null))) };
  return JSON.stringify(table).length < sourceSize ? table : data;
}

const TOOLS = [
  {
    name: "list_sites",
    description: "List the sites this server exposes — the Audius Studio DAW — with operation counts and whether a DAW browser tab is connected.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => {
      const j = await apiGet("/api/sites");
      return toolResult(
        (j.sites || []).map((s) => ({
          name: s.name,
          description: s.description || SITE_HINT,
          operations: ALLOW_WRITES ? s.operations : s.readOnlyOperations,
          sessions: s.sessions,
        }))
      );
    },
  },
  {
    name: "list_operations",
    description:
      "List the DAW's operations with their params. Read-only operations query the live session (getSession, getClips, getTracks, getAssets, getMeters, listProjects, listExports...). Write operations edit it (transport, tracks, clips, slicing, chop, exportWav...)" +
      (ALLOW_WRITES
        ? " Write operations change the user's session: only call them when the user asked for that exact action."
        : " Writes are disabled on this server."),
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string", description: "site name from list_sites (optional; there is one site)" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ site } = {}) => {
      const j = await getCatalog();
      let ops = j.operations || [];
      if (!ALLOW_WRITES) ops = ops.filter((o) => o.readOnly);
      if (site && j.site && site !== j.site.name) {
        return toolResult({ ok: false, error: `unknown site "${site}"`, next: "list_sites" }, true);
      }
      return toolResult({
        site: j.site,
        operations: ops.map((o) => ({
          name: o.name,
          tier: o.tier,
          readOnly: o.readOnly,
          description: o.description,
          params: (o.params || []).map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required,
            ...(p.pattern ? { pattern: p.pattern } : {}),
            ...(p.hint ? { hint: p.hint } : {}),
            ...(p.default !== undefined ? { default: p.default } : {}),
            ...(p.description ? { description: p.description } : {}),
          })),
        })),
        note: "tier 1 runs on the server; tier 3 runs inside the connected DAW browser tab and needs one open (list_sites shows sessions).",
      });
    },
  },
  {
    name: "call_operation",
    description:
      "Call a DAW operation. Returns {ok, class, data, tier, ms, reason?, next?}; a list of two or more records comes back as data {columns, rows} when that shortens the JSON. On failure follow `next` at most once, then stop and report. class 'blocked' means no DAW browser tab is connected: ask the user to open the DAW (npm start, then http://127.0.0.1:3000/) and keep the tab open." +
      (ALLOW_WRITES
        ? " Write operations change the user's session: only call them when the user asked for that exact action."
        : " Writes are disabled on this server."),
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string", description: "site name from list_sites (optional)" },
        op: { type: "string", description: "operation name from list_operations" },
        args: { type: "object", description: "param name -> value", additionalProperties: true },
        session: { type: "string", description: "target one connected DAW tab (default: newest)" },
      },
      required: ["op"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: !ALLOW_WRITES, destructiveHint: ALLOW_WRITES, openWorldHint: false },
    run: async ({ site, op, args, session } = {}) => {
      const j = await getCatalog();
      const spec = (j.operations || []).filter((o) => o.name === op)[0];
      if (!spec) {
        getCatalog(true).catch(() => {});
        return toolResult({ ok: false, class: "input", reason: `unknown operation "${op}"`, next: "list_operations" }, true);
      }
      if (!spec.readOnly && !ALLOW_WRITES) {
        return toolResult(
          {
            ok: false,
            class: "blocked",
            reason: `operation "${op}" is a write and writes are disabled on this MCP server`,
            next: "ask the user to restart this MCP server with --allow-writes",
          },
          true
        );
      }
      const body = { op, args: args || {} };
      if (site) body.site = site;
      if (session) body.session = session;
      const r = await fetch(`${API}/api/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const env = await r.json();
      return toolResult(
        { ...env, ...(env.data !== undefined ? { data: asTable(env.data) } : {}) },
        !env.ok
      );
    },
  },
];

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "audius-studio-daw", version: VERSION },
      instructions:
        `Drives the Audius Studio DAW like an API, in the style of api-anything: ${SITE_HINT}. ` +
        "Prefer list_operations then call_operation over driving the browser UI. " +
        `Writes ${ALLOW_WRITES ? "are allowed" : "are disabled (restart with --allow-writes)"}.`,
    });
  }
  if (method === "tools/list") {
    return reply(id, { tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
  }
  if (method === "tools/call") {
    const name = params && params.name;
    const tool = TOOLS.filter((t) => t.name === name)[0];
    if (!tool) return reply(id, toolResult({ ok: false, error: `unknown tool "${name}"`, next: "tools/list" }, true));
    try {
      return reply(id, await tool.run((params && params.arguments) || {}));
    } catch (err) {
      const message = (err && err.message ? err.message : String(err)).split("\n")[0];
      return reply(
        id,
        toolResult(
          {
            ok: false,
            class: "error",
            reason: message,
            next: /ECONNREFUSED|fetch failed|HTTP /.test(message)
              ? `the DAW server is not answering at ${API}: ask the user to run npm start in the DAW repo`
              : "retry once, then report",
          },
          true
        )
      );
    }
  }
  if (method === "ping") return reply(id, {});
  if (id !== undefined && id !== null) return replyError(id, -32601, `method not found: ${method}`);
  return undefined; // notifications (e.g. notifications/initialized) need no reply
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let inFlight = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && inFlight === 0) process.exit(0);
}

rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (_) {
    return;
  }
  if (msg.jsonrpc !== "2.0") return;
  const isRequest = msg.id !== undefined && msg.id !== null;
  if (isRequest) inFlight++;
  Promise.resolve(handleRequest(msg))
    .catch((err) => {
      if (isRequest) replyError(msg.id, -32603, (err && err.message) || "internal error");
    })
    .then(() => {
      if (isRequest) inFlight--;
      maybeExit();
    });
});
// Piped usage (printf ... | node mcp.mjs) closes stdin while requests are still
// running: finish them, then exit. A hard cap keeps a stuck fetch from hanging.
rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
  setTimeout(() => process.exit(0), 10000).unref();
});
