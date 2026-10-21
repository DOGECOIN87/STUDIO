#!/usr/bin/env node
/**
 * DAW API smoke test — no browser needed.
 *
 * Boots the real router + WebSocket hub on an ephemeral port with temp
 * storage, then exercises:
 *   1. tier-1 server operations + the api-anything envelope shape
 *   2. input validation classes (unknown op/site/param, required, pattern)
 *   3. exports/imports upload, download, delete and traversal safety
 *   4. the MCP stdio server (initialize, tools/list, tools/call, write gate)
 *   5. the daw-api CLI (sites, ops, call, exit codes)
 *   6. a fake DAW page over a raw WebSocket: fragmented hello, tier-3 call,
 *      a 300 KB result frame, hub timeout, disconnect -> blocked
 *   7. the real app/public/api-bridge.js module driving tier-3 calls in Node
 *
 * Run: node test/api/smoke.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..", "..");

let passed = 0;
let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`FAIL  ${name}\n      ${err && err.message ? err.message : err}`);
    });
}

// ---------- boot the API on an ephemeral port with temp storage ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daw-api-test-"));
const { createApi } = await import(pathToFileURL(path.join(REPO, "app/api/router.mjs")).href);
const api = createApi({
  projectsDir: path.join(tmp, "projects"),
  exportsDir: path.join(tmp, "exports"),
  importsDir: path.join(tmp, "imports"),
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const handled = await api.handle(req, res, url);
  if (!handled) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
api.attachWs(server);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`test server on ${BASE} (temp dir ${tmp})`);

const jget = async (p) => (await fetch(BASE + p)).json();
const jcall = async (body) => {
  const r = await fetch(`${BASE}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, env: await r.json() };
};

// ---------- 1. discovery + tier-1 ----------
console.log("\n[1] discovery and tier-1 server operations");
await check("GET /api/health carries the api block", async () => {
  const h = await jget("/api/health");
  assert.equal(h.status, "ok");
  assert.ok(h.api && h.api.name === "audius-studio" && h.api.operations > 40);
});
await check("GET /api/sites lists one site", async () => {
  const j = await jget("/api/sites");
  assert.equal(j.sites.length, 1);
  assert.equal(j.sites[0].name, "audius-studio");
});
await check("GET /api/operations serves the catalog with params", async () => {
  const j = await jget("/api/operations");
  const names = j.operations.map((o) => o.name);
  for (const need of ["getSession", "exportWav", "chopClips", "getHealth", "putProjectFile"]) {
    assert.ok(names.includes(need), `catalog is missing ${need}`);
  }
  const chop = j.operations.find((o) => o.name === "chopClips");
  assert.equal(chop.tier, 3);
  const preset = chop.params.find((p) => p.name === "preset");
  assert.ok(preset.pattern && preset.hint);
});
await check("GET /api/operations?op=getClips filters", async () => {
  const j = await jget("/api/operations?op=getClips");
  assert.equal(j.operations.length, 1);
});
await check("call getHealth -> api-anything envelope, tier 1", async () => {
  const { env } = await jcall({ op: "getHealth" });
  assert.equal(env.ok, true);
  assert.equal(env.class, "ok");
  assert.equal(env.tier, 1);
  assert.equal(typeof env.ms, "number");
  assert.equal(env.data.status, "ok");
});
await check("call putProjectFile/getProjectFile/listProjectFiles/deleteProjectFile", async () => {
  const project = { name: "Test Song", bpm: 140, tracks: [{ id: "t1", name: "T1" }], clips: [] };
  let { env } = await jcall({ op: "putProjectFile", args: { name: "Test Song", project } });
  assert.equal(env.ok, true, JSON.stringify(env));
  assert.equal(env.data.fileName, "Test Song.dawproj.json");
  ({ env } = await jcall({ op: "getProjectFile", args: { name: "Test Song" } }));
  assert.equal(env.ok, true);
  assert.equal(env.data.bpm, 140);
  ({ env } = await jcall({ op: "listProjectFiles" }));
  assert.equal(env.data.projects.length, 1);
  ({ env } = await jcall({ op: "deleteProjectFile", args: { name: "Test Song" } }));
  assert.equal(env.ok, true);
  ({ env } = await jcall({ op: "getProjectFile", args: { name: "Test Song" } }));
  assert.equal(env.ok, false);
  assert.equal(env.class, "input");
  assert.ok(env.next);
});
await check("call listSessions/listExports/listImports on empty state", async () => {
  for (const op of ["listSessions", "listExports", "listImports"]) {
    const { env } = await jcall({ op });
    assert.equal(env.ok, true, `${op}: ${JSON.stringify(env)}`);
  }
});

// ---------- 2. validation classes ----------
console.log("\n[2] input validation (api-anything classes + next hints)");
await check("unknown operation -> class input", async () => {
  const { status, env } = await jcall({ op: "launchTheMissiles" });
  assert.equal(status, 404);
  assert.equal(env.ok, false);
  assert.equal(env.class, "input");
  assert.match(env.next, /operations/);
});
await check("unknown site -> class input", async () => {
  const { env } = await jcall({ site: "goodreads", op: "getHealth" });
  assert.equal(env.ok, false);
  assert.equal(env.class, "input");
});
await check("missing required param -> class input with hint", async () => {
  const { status, env } = await jcall({ op: "setTempo", args: {} });
  assert.equal(status, 400);
  assert.equal(env.class, "input");
  assert.match(env.reason, /missing required param "bpm"/);
});
await check("unknown param -> refused", async () => {
  const { env } = await jcall({ op: "setTempo", args: { bpmm: 140 } });
  assert.equal(env.class, "input");
  assert.match(env.reason, /unknown param/);
});
await check("pattern violation -> class input", async () => {
  const { env } = await jcall({ op: "exportWav", args: { mode: "banana" } });
  assert.equal(env.class, "input");
  assert.match(env.reason, /master or stems/);
});
await check("type coercion: string numbers and booleans", async () => {
  // putProjectFile with project as a JSON string coerces to object
  const project = JSON.stringify({ tracks: [], clips: [] });
  const { env } = await jcall({ op: "putProjectFile", args: { name: "Coerced", project } });
  assert.equal(env.ok, true, JSON.stringify(env));
  await jcall({ op: "deleteProjectFile", args: { name: "Coerced" } });
});
await check("bad JSON body -> class input", async () => {
  const r = await fetch(`${BASE}/api/call`, { method: "POST", body: "{not json" });
  const env = await r.json();
  assert.equal(env.ok, false);
  assert.equal(env.class, "input");
});
await check("page operation with no session -> class blocked + next", async () => {
  const { status, env } = await jcall({ op: "getClips" });
  assert.equal(status, 503);
  assert.equal(env.ok, false);
  assert.equal(env.class, "blocked");
  assert.equal(env.tier, 3);
  assert.match(env.next, /browser tab/);
});

// ---------- 3. exports / imports ----------
console.log("\n[3] exports and imports storage");
await check("upload, list, download, delete an export", async () => {
  const bytes = crypto.randomBytes(2048);
  const up = await fetch(`${BASE}/api/exports/upload?name=My%20Mix-24bit.wav`, { method: "POST", body: bytes });
  const meta = await up.json();
  assert.equal(meta.ok, true);
  assert.equal(meta.name, "My Mix-24bit.wav");
  assert.equal(meta.bytes, 2048);
  const list = await jget("/api/exports");
  assert.equal(list.exports.length, 1);
  const dl = await fetch(BASE + meta.url);
  assert.equal(dl.headers.get("content-type"), "audio/wav");
  assert.equal(Buffer.compare(Buffer.from(await dl.arrayBuffer()), bytes), 0);
  const del = await fetch(`${BASE}/api/exports/${encodeURIComponent(meta.name)}`, { method: "DELETE" });
  assert.equal((await del.json()).ok, true);
  assert.equal((await jget("/api/exports")).exports.length, 0);
});
await check("upload sanitizes traversal names", async () => {
  const up = await fetch(`${BASE}/api/imports/upload?name=..%2F..%2Fevil.wav`, { method: "POST", body: Buffer.from("x") });
  const meta = await up.json();
  assert.ok(!meta.name.includes("/"), meta.name);
  assert.ok(!meta.name.includes(".."), meta.name);
  assert.ok(fs.existsSync(path.join(tmp, "imports", meta.name)));
  await fetch(`${BASE}/api/imports/${encodeURIComponent(meta.name)}`, { method: "DELETE" });
});
await check("download of unknown file -> 404 input envelope", async () => {
  const r = await fetch(`${BASE}/api/exports/nope.wav`);
  assert.equal(r.status, 404);
  const env = await r.json();
  assert.equal(env.class, "input");
});

// ---------- 4. MCP stdio server ----------
console.log("\n[4] MCP server (tools: list_sites, list_operations, call_operation)");
async function mcpSession(extraArgs, requests) {
  const child = spawn(process.execPath, [path.join(REPO, "app/api/mcp.mjs"), "--api", BASE, ...extraArgs], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = [];
  let buf = "";
  const waiters = [];
  child.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      if (waiters.length) waiters.shift()(line);
      else lines.push(line);
    }
  });
  const collect = async (timeoutMs = 8000) => {
    const line = await Promise.race([
      new Promise((resolve) => {
        if (lines.length) resolve(lines.shift());
        else waiters.push(resolve);
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (line === null) throw new Error("MCP server did not answer in time");
    return JSON.parse(line);
  };
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  const out = {};
  try {
    out.results = await requests({ send, collect });
  } finally {
    child.stdin.end();
    child.kill();
  }
  return out.results;
}

await check("initialize + tools/list + write-gated call_operation", async () => {
  const res = await mcpSession([], async ({ send, collect }) => {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
    const init = await collect();
    assert.equal(init.id, 1);
    assert.equal(init.result.serverInfo.name, "audius-studio-daw");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = await collect();
    assert.deepEqual(tools.result.tools.map((t) => t.name).sort(), ["call_operation", "list_operations", "list_sites"]);
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_sites", arguments: {} } });
    const sites = await collect();
    const siteList = JSON.parse(sites.result.content[0].text);
    assert.equal(siteList[0].name, "audius-studio");
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_operations", arguments: {} } });
    const ops = await collect();
    const opsPayload = JSON.parse(ops.result.content[0].text);
    assert.ok(opsPayload.operations.every((o) => o.readOnly), "writes must be hidden without --allow-writes");
    send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "call_operation", arguments: { op: "getHealth" } } });
    const health = await collect();
    const healthEnv = JSON.parse(health.result.content[0].text);
    assert.equal(healthEnv.ok, true);
    assert.equal(healthEnv.tier, 1);
    send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "call_operation", arguments: { op: "setTempo", args: { bpm: 140 } } } });
    const gated = await collect();
    const gatedEnv = JSON.parse(gated.result.content[0].text);
    assert.equal(gatedEnv.ok, false);
    assert.equal(gatedEnv.class, "blocked");
    assert.match(gatedEnv.next, /--allow-writes/);
    assert.equal(gated.result.isError, true);
    return true;
  });
  assert.ok(res);
});
await check("--allow-writes lets a write through to the hub (blocked: no tab)", async () => {
  await mcpSession(["--allow-writes"], async ({ send, collect }) => {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await collect();
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "call_operation", arguments: { op: "setTempo", args: { bpm: 140 } } } });
    const env = JSON.parse((await collect()).result.content[0].text);
    assert.equal(env.ok, false);
    assert.equal(env.class, "blocked"); // reached the hub; no DAW tab connected
    assert.match(env.reason, /no DAW session/);
    return true;
  });
});

// ---------- 5. CLI ----------
console.log("\n[5] daw-api CLI");
// spawnSync would block this process's event loop and starve the in-process
// test server, so CLI runs are async child processes.
function cli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, "tools/daw-api/daw-api.mjs"), ...args, "--api", BASE], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const killer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => {
      clearTimeout(killer);
      resolve({ status, stdout, stderr });
    });
  });
}
await check("daw-api sites", async () => {
  const r = await cli(["sites"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /audius-studio\s+\d+ operations/);
});
await check("daw-api ops hides writes, --writes shows them", async () => {
  const ro = await cli(["ops"]);
  assert.equal(ro.status, 0);
  assert.ok(!/\nexportWav\b/.test(ro.stdout));
  const all = await cli(["ops", "--writes"]);
  assert.match(all.stdout, /\nexportWav\b/);
  assert.match(all.stdout, /preset.*1beat\|1bar\|halfbar\|eighth/);
});
await check("daw-api call getHealth prints the envelope and exits 0", async () => {
  const r = await cli(["call", "getHealth", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const env = JSON.parse(r.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.class, "ok");
});
await check("daw-api call <site> <op> k=v (api-anything order) + typed values", async () => {
  const r = await cli(["call", "audius-studio", "putProjectFile", "name=CLI Song", 'project={"tracks":[],"clips":[]}', "--json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const env = JSON.parse(r.stdout);
  assert.equal(env.ok, true);
  await cli(["call", "deleteProjectFile", "name=CLI Song", "--json"]);
});
await check("daw-api call exits 1 with a blocked envelope when no tab is open", async () => {
  const r = await cli(["call", "getClips", "--json"]);
  assert.equal(r.status, 1);
  const env = JSON.parse(r.stdout);
  assert.equal(env.ok, false);
  assert.equal(env.class, "blocked");
});
await check("daw-api status shows health + sessions", async () => {
  const r = await cli(["status"]);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(j.health.api && Array.isArray(j.sessions));
});

// ---------- 6. fake DAW page over a raw WebSocket ----------
console.log("\n[6] bridge hub: raw websocket page (fragmented hello, big frames, timeout, disconnect)");

function wsKey() {
  return crypto.randomBytes(16).toString("base64");
}
function maskedFrame(opcode, payload, fin = true) {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = (fin ? 0x80 : 0) | opcode;
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}
function connectRaw() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, "127.0.0.1", () => {
      sock.write(
        [
          "GET /api/ws HTTP/1.1",
          `Host: 127.0.0.1:${PORT}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${wsKey()}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n")
      );
    });
    let handshaken = false;
    let buf = Buffer.alloc(0);
    const messages = [];
    const waiters = [];
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const head = buf.slice(0, idx).toString("utf8");
        if (!head.startsWith("HTTP/1.1 101")) return reject(new Error("bad handshake: " + head.split("\r\n")[0]));
        buf = buf.slice(idx + 4);
        handshaken = true;
        resolve(client);
      }
      // parse unmasked server frames
      for (;;) {
        if (buf.length < 2) return;
        const b0 = buf[0];
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        const opcode = b0 & 0x0f;
        if (opcode === 1) {
          const text = payload.toString("utf8");
          if (waiters.length) waiters.shift()(text);
          else messages.push(text);
        } else if (opcode === 9) {
          sock.write(maskedFrame(10, payload)); // pong
        }
      }
    });
    sock.on("error", reject);
    const nextMsg = (timeoutMs = 5000) =>
      messages.length
        ? Promise.resolve(messages.shift())
        : new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error("no ws message in time")), timeoutMs);
            waiters.push((m) => {
              clearTimeout(t);
              res(m);
            });
          });
    const client = {
      sock,
      send: (obj) => sock.write(maskedFrame(1, Buffer.from(JSON.stringify(obj), "utf8"))),
      sendRaw: (b) => sock.write(b),
      nextMsg,
      close: () => sock.destroy(),
    };
  });
}

await check("fragmented masked hello registers a session", async () => {
  const raw = await connectRaw();
  const hello = JSON.stringify({ type: "hello", sessionId: "raw-1", app: "audius-studio", version: "37", url: "http://fake/", ops: ["getClips", "getTransport"] });
  const bytes = Buffer.from(hello, "utf8");
  const cut = Math.floor(bytes.length / 2);
  raw.sendRaw(maskedFrame(1, bytes.subarray(0, cut), false)); // first fragment, FIN=0
  raw.sendRaw(maskedFrame(0, bytes.subarray(cut), true)); // continuation, FIN=1
  const ack = JSON.parse(await raw.nextMsg());
  assert.equal(ack.type, "hello-ok");
  assert.equal(ack.sessionId, "raw-1");
  const sessions = await jget("/api/sessions");
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.sessions[0].operations, 2);
  globalThis.__raw = raw;
});
await check("tier-3 call routes to the page and envelopes its result", async () => {
  const raw = globalThis.__raw;
  const p = jcall({ op: "getClips", args: { trackId: "trk-1" }, session: "raw-1" });
  const call = JSON.parse(await raw.nextMsg());
  assert.equal(call.type, "call");
  assert.equal(call.op, "getClips");
  assert.deepEqual(call.args, { trackId: "trk-1" });
  raw.send({ type: "result", id: call.id, ok: true, data: { clips: [{ id: "clip-1", startBeat: 0 }] }, ms: 7 });
  const { env } = await p;
  assert.equal(env.ok, true);
  assert.equal(env.class, "ok");
  assert.equal(env.tier, 3);
  assert.equal(env.pageMs, 7);
  assert.equal(env.data.clips[0].id, "clip-1");
});
await check("a 300 KB result survives the frame parser", async () => {
  const raw = globalThis.__raw;
  const big = { clips: Array.from({ length: 3000 }, (_, i) => ({ id: `clip-${i}`, name: "x".repeat(60) })) };
  const p = jcall({ op: "getClips", session: "raw-1" });
  const call = JSON.parse(await raw.nextMsg());
  raw.send({ type: "result", id: call.id, ok: true, data: big, ms: 12 });
  const { env } = await p;
  assert.equal(env.ok, true);
  assert.equal(env.data.clips.length, 3000);
});
await check("page-reported failures keep their class", async () => {
  const raw = globalThis.__raw;
  const p = jcall({ op: "getClips", args: { trackId: "nope" }, session: "raw-1" });
  const call = JSON.parse(await raw.nextMsg());
  raw.send({ type: "result", id: call.id, ok: false, class: "input", reason: "no track with id \"nope\"", ms: 2 });
  const { status, env } = await p;
  assert.equal(status, 400);
  assert.equal(env.ok, false);
  assert.equal(env.class, "input");
  assert.match(env.reason, /no track/);
});
await check("a silent page times out with class error", async () => {
  const raw = globalThis.__raw;
  const p = jcall({ op: "getTransport", session: "raw-1" });
  const call = JSON.parse(await raw.nextMsg());
  assert.equal(call.op, "getTransport");
  // never answer; drive the hub's own timeout instead of waiting 20 s
  const started = Date.now();
  let err = null;
  try {
    await api.hub.call("getTransport", {}, { sessionId: "raw-1", timeoutMs: 300 });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "hub.call should reject on timeout");
  assert.equal(err.cls, "error");
  assert.match(err.reason, /did not answer/);
  assert.ok(Date.now() - started < 5000);
  // answer the HTTP-routed call too so it settles
  raw.send({ type: "result", id: call.id, ok: true, data: { playing: false }, ms: 1 });
  const { env } = await p;
  assert.equal(env.ok, true);
  // drain the direct hub.call's message so the next test reads a fresh one
  const extra = JSON.parse(await raw.nextMsg());
  assert.equal(extra.op, "getTransport");
});
await check("disconnecting the page rejects pending calls and blocks new ones", async () => {
  const raw = globalThis.__raw;
  const p = jcall({ op: "getClips", session: "raw-1" });
  await raw.nextMsg(); // the call arrived
  raw.close();
  const { env } = await p;
  assert.equal(env.ok, false);
  assert.ok(["error", "blocked"].includes(env.class), JSON.stringify(env));
  await new Promise((r) => setTimeout(r, 150));
  const after = await jcall({ op: "getClips" });
  assert.equal(after.env.class, "blocked");
  delete globalThis.__raw;
});

// ---------- 7. the real api-bridge.js module, running in Node ----------
console.log("\n[7] app/public/api-bridge.js end to end");
await check("bridge connects, answers calls and reports classified errors", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, opts) => realFetch(typeof u === "string" && u.startsWith("/") ? BASE + u : u, opts);
  globalThis.location = { protocol: "http:", host: `127.0.0.1:${PORT}`, href: `${BASE}/` };
  const { initApiBridge, apiError } = await import(pathToFileURL(path.join(REPO, "app/public/api-bridge.js")).href);
  const bridge = initApiBridge(
    {
      getClips: async (args) => {
        if (args.trackId === "boom") throw apiError("input", "boom from the page");
        if (args.trackId === "crash") throw new Error("unexpected page crash");
        return { clips: [{ id: "clip-bridge", trackId: args.trackId || null }], via: "api-bridge.js" };
      },
    },
    { version: "test" }
  );
  assert.ok(bridge, "bridge refused to start");
  // wait for the hello to land
  let sessions = null;
  for (let i = 0; i < 50; i++) {
    sessions = await jget("/api/sessions");
    if (sessions.sessions.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(sessions.sessions.length, 1, "bridge never connected");
  assert.equal(sessions.sessions[0].operations, 1);

  let { env } = await jcall({ op: "getClips" });
  assert.equal(env.ok, true);
  assert.equal(env.tier, 3);
  assert.equal(env.data.via, "api-bridge.js");

  ({ env } = await jcall({ op: "getClips", args: { trackId: "boom" } }));
  assert.equal(env.ok, false);
  assert.equal(env.class, "input");
  assert.equal(env.reason, "boom from the page");

  ({ env } = await jcall({ op: "getClips", args: { trackId: "crash" } }));
  assert.equal(env.ok, false);
  assert.equal(env.class, "error");
  assert.match(env.reason, /unexpected page crash/);

  bridge.close();
  globalThis.fetch = realFetch;
  delete globalThis.location;
});

// ---------- 8. static consistency: catalog vs code ----------
console.log("\n[8] catalog consistency");
await check("every page operation has a handler in app.js", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, "app/api/operations.json"), "utf8"));
  const appSrc = fs.readFileSync(path.join(REPO, "app/public/app.js"), "utf8");
  const start = appSrc.indexOf("function buildApiBridgeHandlers()");
  assert.ok(start !== -1, "buildApiBridgeHandlers is missing from app.js");
  const block = appSrc.slice(start);
  const missing = catalog.operations
    .filter((o) => o.executor === "page")
    .map((o) => o.name)
    .filter((name) => !new RegExp(`(^|[\\s{,])${name}:\\s*async`, "m").test(block));
  assert.deepEqual(missing, [], `app.js is missing handlers: ${missing.join(", ")}`);
});
await check("handler block only calls identifiers that exist (no browser needed)", () => {
  const appSrc = fs.readFileSync(path.join(REPO, "app/public/app.js"), "utf8");
  const start = appSrc.indexOf("function buildApiBridgeHandlers()");
  const block = appSrc.slice(start, appSrc.indexOf("// Initialize Application", start));
  const GLOBALS = new Set([
    "fetch", "atob", "btoa", "Number", "String", "Math", "JSON", "Set", "Map", "Array", "Object",
    "Boolean", "Promise", "Date", "RegExp", "Error", "Uint8Array", "ArrayBuffer", "Blob",
    "encodeURIComponent", "decodeURIComponent", "isFinite", "isNaN", "parseInt", "parseFloat",
    "setTimeout", "clearTimeout", "console", "if", "for", "while", "switch", "catch", "return", "typeof", "await", "function", "async", "new", "delete", "void", "in", "of",
  ]);
  const defined = new Set();
  for (const m of appSrc.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of appSrc.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of appSrc.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) defined.add(name.trim());
    }
  }
  // Strip string literals and comments so prose like "segment(s)" is not read
  // as a call, while code inside ${...} template holes is kept.
  const stripStrings = (src) => {
    let out = "";
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"' || ch === "'") {
        const q = ch;
        i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === "\\") i++;
          i++;
        }
        i++;
        out += '""';
      } else if (ch === "`") {
        i++;
        while (i < src.length && src[i] !== "`") {
          if (src[i] === "\\") {
            i += 2;
            continue;
          }
          if (src[i] === "$" && src[i + 1] === "{") {
            const startIdx = i;
            let depth = 0;
            while (i < src.length) {
              if (src[i] === "{") depth++;
              else if (src[i] === "}") {
                depth--;
                if (depth === 0) {
                  i++;
                  break;
                }
              }
              i++;
            }
            out += "$" + src.slice(startIdx + 1, i);
            continue;
          }
          i++;
        }
        i++;
        out += '""';
      } else if (ch === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (ch === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i += 2;
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  };
  const called = new Set();
  for (const m of stripStrings(block).matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[2]);
  const unknown = [...called].filter((n) => !GLOBALS.has(n) && !defined.has(n));
  assert.deepEqual(unknown, [], `handler block calls undefined functions: ${unknown.join(", ")}`);

  // engine.* methods used by the handlers must exist on AudioEngine
  const engineSrc = fs.readFileSync(path.join(REPO, "app/public/audio-engine.js"), "utf8");
  const engineCalls = new Set();
  for (const m of block.matchAll(/engine\.([A-Za-z_$][\w$]*)\s*\(/g)) engineCalls.add(m[1]);
  const missingEngine = [...engineCalls].filter((n) => !new RegExp(`(^|\\n)\\s*(?:async\\s+)?${n}\\s*\\(`, "m").test(engineSrc));
  assert.deepEqual(missingEngine, [], `AudioEngine is missing: ${missingEngine.join(", ")}`);

  // dom.* members used by the handlers must exist in the dom literal
  const domCalls = new Set();
  for (const m of block.matchAll(/\bdom\.([A-Za-z_$][\w$]*)/g)) domCalls.add(m[1]);
  const missingDom = [...domCalls].filter((n) => !new RegExp(`(^|\\n)\\s*${n}:`, "m").test(appSrc));
  assert.deepEqual(missingDom, [], `dom is missing: ${missingDom.join(", ")}`);
});
await check("every server operation has a handler in router.mjs", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, "app/api/operations.json"), "utf8"));
  const src = fs.readFileSync(path.join(REPO, "app/api/router.mjs"), "utf8");
  const start = src.indexOf("const serverOps = {");
  const block = src.slice(start, src.indexOf("function projectFilePath"));
  const missing = catalog.operations
    .filter((o) => o.executor === "server")
    .map((o) => o.name)
    .filter((name) => !new RegExp(`(^|[\\s{,])${name}:`).test(block));
  assert.deepEqual(missing, [], `router.mjs is missing server ops: ${missing.join(", ")}`);
});

// ---------- teardown ----------
server.close();
api.hub.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
