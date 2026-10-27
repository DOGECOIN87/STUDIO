/**
 * STUDIO — DAW API Bridge (browser side)
 *
 * Connects the live DAW tab to the local server (app/server.mjs) over a
 * WebSocket so the whole workstation can be driven through the HTTP API in
 * the style of api-anything (github.com/DOGECOIN87/api-anything):
 *
 *   POST /api/call {"op":"chopClips","args":{"preset":"1bar"}}
 *     -> the server routes the call here -> a handler in app.js runs it
 *        against the real session and Web Audio engine
 *     -> {"ok":true,"class":"ok","tier":3,"data":{...},"ms":42}
 *
 * On static hosting (Cloudflare Pages) there is no /api, the probe fails and
 * the bridge stays dormant: the DAW itself never depends on this module.
 *
 * Handler contract: `handlers[opName](args) -> data | Promise<data>`.
 * A handler that throws `apiError("input", "...")` reports a classified
 * failure; any other throw becomes class "error".
 *
 * Kept compatible with old browsers (Galaxy Note 3 / Chrome 95, Safari 14):
 * no structuredClone, no findLast, no top-level await.
 */

/** An error with an api-anything failure class (input, blocked, error, ...). */
export function apiError(cls, reason) {
  const err = new Error(reason);
  err.apiClass = cls;
  return err;
}

const OP_CLASSES = ["drift", "auth", "rate", "blocked", "input", "error"];

// A server started after the tab can only appear on the developer's own machine.
const LOOPBACK_HOST = /^(localhost|127(\.\d+){3}|\[::1\])$/;

/**
 * Ask whether `path` is the local server's health endpoint. Static hosting
 * (Cloudflare Pages) answers unknown paths with index.html and a 200, so only
 * a JSON body naming the API counts.
 */
async function probeHealth(path) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok || !/json/i.test(r.headers.get("content-type") || "")) return false;
    const j = await r.json();
    return !!(j && j.api && j.api.name);
  } catch (_) {
    return false;
  }
}

let localApiProbe = null;

/** Resolves true when the local server's /api is present. Probed once per page. */
export function hasLocalApi() {
  if (!localApiProbe) localApiProbe = probeHealth("/api/health");
  return localApiProbe;
}

export function initApiBridge(handlers, options) {
  const opts = options || {};
  if (typeof WebSocket === "undefined" || typeof fetch === "undefined") return null;
  if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return null;

  const ops = Object.keys(handlers || {});
  const sessionId =
    "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const probePath = opts.probePath || "/api/health";
  const wsPath = opts.wsPath || "/api/ws";
  const version = String(opts.version || "1");
  const onLog = typeof opts.onLog === "function" ? opts.onLog : function () {};

  let ws = null;
  let connected = false;
  let attempt = 0;
  let retryTimer = 0;
  let probeTimer = 0;
  let closed = false;

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + wsPath;
  }

  function send(obj) {
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(obj));
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  async function runCall(msg) {
    const started = Date.now();
    let out;
    try {
      const fn = handlers[msg.op];
      if (typeof fn !== "function") {
        out = {
          type: "result",
          id: msg.id,
          ok: false,
          class: "input",
          reason: 'unknown operation "' + msg.op + '" in this DAW build',
          next: "GET /api/operations lists every operation this build serves",
          ms: Date.now() - started,
        };
      } else {
        const data = await fn(msg.args || {});
        out = { type: "result", id: msg.id, ok: true, data: data === undefined ? null : data, ms: Date.now() - started };
      }
    } catch (err) {
      const cls = err && OP_CLASSES.indexOf(err.apiClass) !== -1 ? err.apiClass : "error";
      out = {
        type: "result",
        id: msg.id,
        ok: false,
        class: cls,
        reason: String((err && err.message) || err || "the DAW handler failed"),
        ms: Date.now() - started,
      };
    }
    send(out);
  }

  function scheduleReconnect() {
    if (closed || retryTimer) return;
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 400);
    attempt += 1;
    retryTimer = setTimeout(function () {
      retryTimer = 0;
      connect();
    }, delay);
  }

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(wsUrl());
    } catch (_) {
      scheduleReconnect();
      return;
    }
    ws.onopen = function () {
      attempt = 0;
      send({
        type: "hello",
        sessionId: sessionId,
        app: "audius-studio",
        version: version,
        url: location.href,
        ops: ops,
      });
    };
    ws.onmessage = function (ev) {
      let msg = null;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "hello-ok") {
        connected = true;
        onLog("api-bridge connected as " + msg.sessionId);
        return;
      }
      if (msg.type === "call" && msg.id && msg.op) {
        runCall(msg);
        return;
      }
    };
    ws.onclose = function () {
      const was = connected;
      connected = false;
      ws = null;
      if (was) onLog("api-bridge disconnected");
      scheduleReconnect();
    };
    ws.onerror = function () {
      // onclose follows and schedules the retry.
      try {
        ws.close();
      } catch (_) {}
    };
  }

  // Static hosting has no /api: probe once and stay dormant. Only on a loopback
  // host keep probing slowly, so a server started after the tab is picked up.
  (async function boot(first) {
    const has =
      first && probePath === "/api/health" ? await hasLocalApi() : await probeHealth(probePath);
    if (closed) return;
    if (has) {
      connect();
    } else if (LOOPBACK_HOST.test(String(location.hostname || ""))) {
      probeTimer = setTimeout(boot, 60000);
    }
  })(true);

  return {
    get connected() {
      return connected;
    },
    get sessionId() {
      return sessionId;
    },
    get operations() {
      return ops.slice();
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (probeTimer) clearTimeout(probeTimer);
      retryTimer = 0;
      probeTimer = 0;
      connected = false;
      if (ws) {
        try {
          ws.close();
        } catch (_) {}
      }
      ws = null;
    },
  };
}
