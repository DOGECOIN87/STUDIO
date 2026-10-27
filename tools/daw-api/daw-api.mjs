#!/usr/bin/env node
/**
 * daw-api — command line for the STUDIO DAW API, shaped like
 * api-anything (github.com/DOGECOIN87/api-anything):
 *
 *   daw-api sites                                  list_sites
 *   daw-api ops [site] [--writes]                  list_operations with params
 *   daw-api call <op> [k=v ...] [--session <id>]   call_operation
 *   daw-api call <site> <op> [k=v ...]             (api-anything arg order)
 *   daw-api status                                 server + bridge sessions
 *
 * Every call prints the api-anything envelope:
 *   {"ok":true,"class":"ok","tier":1|3,"data":...,"ms":N}
 *   {"ok":false,"class":"blocked|input|error|...","reason":"...","next":"..."}
 * and exits non-zero when ok is false.
 *
 * k=v values are parsed as JSON when possible (numbers, booleans, arrays,
 * objects), else kept as strings; k=@file.txt sends the file's text (handy
 * for base64= audio payloads). Zero dependencies (Node >= 18).
 */
import fs from "node:fs";

const API = (process.env.DAW_API_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");

function usage(code = 1) {
  console.log(`daw-api — the STUDIO DAW as an API (api-anything style)

Usage:
  daw-api sites
  daw-api ops [site] [--writes]
  daw-api call <op> [k=v ...] [--session <id>] [--json]
  daw-api call <site> <op> [k=v ...]
  daw-api status

Options:
  --api <url>     server base url (default ${API}, or DAW_API_URL)
  --session <id>  target one connected DAW tab (default: newest)
  --json          print the raw envelope only

Examples:
  daw-api call getClips
  daw-api call setTempo bpm=140
  daw-api call chopClips preset=1bar clipIds='["clip-101"]'
  daw-api call exportWav mode=stems bitDepth=16
  daw-api call importAudio name=kick.wav url=/api/imports/kick.wav

Binary audio goes in over plain HTTP first, then the call references it:
  curl -s --data-binary @kick.wav '${API}/api/imports/upload?name=kick.wav'`);
  process.exit(code);
}

function parseArgs(argv) {
  const rest = [];
  const opts = { api: API, session: "", json: false, writes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api") opts.api = String(argv[++i] || "").replace(/\/+$/, "");
    else if (a === "--session") opts.session = String(argv[++i] || "");
    else if (a === "--json") opts.json = true;
    else if (a === "--writes") opts.writes = true;
    else if (a === "--help" || a === "-h") usage(0);
    else rest.push(a);
  }
  if (!opts.api) opts.api = API;
  return { opts, rest };
}

function parseValue(raw) {
  if (raw.startsWith("@")) {
    const file = raw.slice(1);
    return fs.readFileSync(file, "utf8").replace(/\r?\n/g, "");
  }
  const t = raw.trim();
  if (t !== "" && /^[{\[]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch (_) {}
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  return raw;
}

function parseKv(list) {
  const args = {};
  for (const item of list) {
    const eq = item.indexOf("=");
    if (eq <= 0) {
      console.error(`daw-api: expected k=v, got "${item}"`);
      process.exit(1);
    }
    args[item.slice(0, eq)] = parseValue(item.slice(eq + 1));
  }
  return args;
}

async function get(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  return await r.json();
}

async function callOp(api, site, op, args, session) {
  const body = { op, args };
  if (site) body.site = site;
  if (session) body.session = session;
  const r = await fetch(`${api}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

function printEnvelope(env, json) {
  if (json) {
    console.log(JSON.stringify(env));
  } else {
    console.log(JSON.stringify(env, null, 2));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(0);
  const { opts, rest } = parseArgs(argv);
  const cmd = rest[0];

  try {
    if (cmd === "sites") {
      const j = await get(`${opts.api}/api/sites`);
      for (const s of j.sites || []) {
        console.log(
          `${s.name}  ${s.operations} operations (${s.readOnlyOperations} read-only)  ${s.sessions} session(s)  ${s.baseUrl}`
        );
        if (s.description) console.log(`  ${s.description}`);
      }
      return;
    }

    if (cmd === "ops") {
      const site = rest[1] && !rest[1].startsWith("--") ? rest[1] : "";
      const url = `${opts.api}/api/operations${site ? `?site=${encodeURIComponent(site)}` : ""}`;
      const j = await get(url);
      console.log(`# ${j.site.displayName} (${j.site.name}) — api ${j.apiVersion}`);
      for (const op of j.operations || []) {
        if (!opts.writes && !op.readOnly) continue;
        const params = (op.params || [])
          .map((p) => `${p.name}${p.required ? "" : "?"}:${p.type}${p.pattern ? ` ~/${p.pattern}/` : ""}`)
          .join(" ");
        console.log(`\n${op.name}  [tier ${op.tier}${op.readOnly ? ", read-only" : ""}]${params ? `  ${params}` : ""}`);
        if (op.description) console.log(`  ${op.description}`);
      }
      if (!opts.writes) console.log("\n(write operations hidden; pass --writes to list them)");
      return;
    }

    if (cmd === "status") {
      const h = await get(`${opts.api}/api/health`);
      const s = await get(`${opts.api}/api/sessions`);
      console.log(JSON.stringify({ health: h, sessions: s.sessions }, null, 2));
      return;
    }

    if (cmd === "call") {
      let site = "";
      let op = rest[1];
      if (rest.length > 2 && !rest[2].includes("=")) {
        // api-anything arg order: call <site> <op> k=v...
        site = op;
        op = rest[2];
        rest.splice(1, 1);
      }
      if (!op) usage();
      const args = parseKv(rest.slice(rest.indexOf(op) + 1));
      const env = await callOp(opts.api, site, op, args, opts.session);
      printEnvelope(env, opts.json);
      process.exit(env && env.ok ? 0 : 1);
    }

    usage();
  } catch (err) {
    const env = {
      ok: false,
      class: "error",
      reason: err && err.message ? err.message : String(err),
      next: `is the DAW server running? (npm start, then ${opts.api}/api/health)`,
    };
    printEnvelope(env, opts.json);
    process.exit(1);
  }
}

main();
