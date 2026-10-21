/**
 * Audius Studio DAW API — WebSocket bridge hub.
 *
 * A minimal, zero-dependency RFC 6455 server (handshake, masked client frames,
 * fragmentation, ping/pong, close) plus the session registry that routes
 * /api/call operations into a live DAW browser tab and awaits its result.
 *
 * Wire protocol (JSON text frames):
 *   page -> server  {"type":"hello","sessionId","app","version","url","ops":[...]}
 *   server -> page  {"type":"hello-ok","sessionId","server"}
 *   server -> page  {"type":"call","id","op","args":{...},"timeoutMs"}
 *   page -> server  {"type":"result","id","ok":true,"data":...,"ms"}
 *   page -> server  {"type":"result","id","ok":false,"class":"input","reason":"...","ms"}
 * Protocol-level pings keep idle tabs alive; browsers answer them natively.
 */
import crypto from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const KEEPALIVE_MS = 25000;
const STALE_MS = 75000;

/** An error that carries an api-anything failure class, so callers can envelope it. */
export class HubError extends Error {
  constructor(cls, reason, next) {
    super(reason);
    this.name = "HubError";
    this.cls = cls;
    this.reason = reason;
    this.next = next;
  }
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

export function createBridgeHub({ maxPayloadBytes = 64 * 1024 * 1024, path = "/api/ws" } = {}) {
  /** sessionId -> { sessionId, socket, ops, url, app, version, connectedAt, lastSeen, pending: Map<id, {resolve,reject,timer}> } */
  const sessions = new Map();
  let callCounter = 0;
  let sessionCounter = 0;
  let keepaliveTimer = null;

  function dropSession(session, why) {
    if (!sessions.has(session.sessionId)) return;
    sessions.delete(session.sessionId);
    for (const [, p] of session.pending) {
      clearTimeout(p.timer);
      p.reject(
        new HubError(
          "error",
          `the DAW tab disconnected mid-call (${why || "socket closed"})`,
          "open the DAW in a browser tab again, then retry the call"
        )
      );
    }
    session.pending.clear();
    try {
      session.socket.destroy();
    } catch (_) {}
  }

  function sendJson(socket, obj) {
    if (socket.destroyed) return false;
    try {
      socket.write(encodeFrame(1, Buffer.from(JSON.stringify(obj), "utf8")));
      return true;
    } catch (_) {
      return false;
    }
  }

  function handleMessage(session, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "hello") {
      session.sessionId =
        typeof msg.sessionId === "string" && msg.sessionId ? msg.sessionId : `sess-${++sessionCounter}`;
      session.ops = Array.isArray(msg.ops) ? msg.ops.map(String) : [];
      session.url = typeof msg.url === "string" ? msg.url : "";
      session.app = typeof msg.app === "string" ? msg.app : "audius-studio";
      session.version = String(msg.version || "1");
      session.connectedAt = new Date().toISOString();
      // A reconnect with the same id replaces the old socket.
      const prev = sessions.get(session.sessionId);
      if (prev && prev !== session) dropSession(prev, "replaced by a reconnect");
      sessions.set(session.sessionId, session);
      sendJson(session.socket, {
        type: "hello-ok",
        sessionId: session.sessionId,
        server: "audius-studio-daw-api",
        operations: session.ops.length,
      });
      return;
    }
    if (msg.type === "result") {
      const p = session.pending.get(msg.id);
      if (!p) return;
      session.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve({ data: msg.data === undefined ? null : msg.data, ms: Number(msg.ms) || 0 });
      else {
        const cls = ["drift", "auth", "rate", "blocked", "input", "error"].includes(msg.class) ? msg.class : "error";
        p.reject(new HubError(cls, String(msg.reason || "the DAW tab reported an error"), msg.next || ""));
      }
      return;
    }
    // Unknown message types are ignored on purpose.
  }

  function attachSocket(req, socket) {
    socket.on("error", () => {});
    const session = {
      sessionId: "",
      socket,
      ops: [],
      url: "",
      app: "",
      version: "",
      connectedAt: "",
      lastSeen: Date.now(),
      pending: new Map(),
      // Parser state
      buf: Buffer.alloc(0),
      fragOpcode: 0,
      fragParts: [],
      fragLen: 0,
      closed: false,
    };

    const cleanup = (why) => {
      if (session.closed) return;
      session.closed = true;
      clearInterval(session._kaTimer);
      dropSession(session, why);
    };

    socket.on("close", () => cleanup("socket closed"));
    socket.on("end", () => cleanup("socket ended"));

    socket.on("data", (chunk) => {
      session.lastSeen = Date.now();
      session.buf = session.buf.length ? Buffer.concat([session.buf, chunk]) : chunk;
      for (;;) {
        const buf = session.buf;
        if (buf.length < 2) return;
        const b0 = buf[0];
        const b1 = buf[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          const big = buf.readBigUInt64BE(2);
          if (big > BigInt(maxPayloadBytes)) {
            socket.write(encodeFrame(8, Buffer.from([0x03, 0xf1]))); // 1009 too big
            return cleanup("payload too large");
          }
          len = Number(big);
          offset = 10;
        }
        if (!masked) {
          // Clients must mask frames (RFC 6455 5.1); refuse anything else.
          socket.write(encodeFrame(8, Buffer.from([0x02, 0x6a]))); // 1002 protocol error
          return cleanup("unmasked client frame");
        }
        if (len > maxPayloadBytes) {
          socket.write(encodeFrame(8, Buffer.from([0x03, 0xf1])));
          return cleanup("payload too large");
        }
        if (buf.length < offset + 4 + len) return;
        const mask = buf.subarray(offset, offset + 4);
        const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        session.buf = buf.subarray(offset + 4 + len);

        if (opcode === 8) {
          // Close: echo and end.
          try {
            socket.write(encodeFrame(8, payload.subarray(0, 2)));
          } catch (_) {}
          return cleanup("close frame");
        }
        if (opcode === 9) {
          socket.write(encodeFrame(10, payload)); // pong
          continue;
        }
        if (opcode === 10) continue; // pong: liveness already recorded

        if (opcode === 0) {
          // Continuation of a fragmented message.
          session.fragParts.push(payload);
          session.fragLen += payload.length;
          if (session.fragLen > maxPayloadBytes) {
            socket.write(encodeFrame(8, Buffer.from([0x03, 0xf1])));
            return cleanup("fragmented payload too large");
          }
          if (!fin) continue;
          const whole = Buffer.concat(session.fragParts);
          const msgOpcode = session.fragOpcode;
          session.fragParts = [];
          session.fragLen = 0;
          session.fragOpcode = 0;
          if (msgOpcode === 1) deliverText(session, whole);
          continue;
        }
        if (opcode === 1) {
          if (!fin) {
            session.fragOpcode = 1;
            session.fragParts = [payload];
            session.fragLen = payload.length;
            continue;
          }
          deliverText(session, payload);
          continue;
        }
        if (opcode === 2) {
          // Binary is not part of the bridge protocol; large payloads travel over HTTP.
          socket.write(encodeFrame(8, Buffer.from([0x02, 0x6a])));
          return cleanup("binary frame");
        }
        socket.write(encodeFrame(8, Buffer.from([0x02, 0x6a])));
        return cleanup(`unknown opcode ${opcode}`);
      }
    });

    function deliverText(sess, payload) {
      let msg;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch (_) {
        return; // ignore malformed JSON, same as unknown message types
      }
      try {
        handleMessage(sess, msg);
      } catch (err) {
        // A hub bug must not kill the socket silently; report and keep going.
        console.error("[api-bridge] message handler error:", err && err.message);
      }
    }
  }

  function attach(server) {
    server.on("upgrade", (req, socket, head) => {
      let pathname = "/";
      try {
        pathname = new URL(req.url || "/", "http://localhost").pathname;
      } catch (_) {}
      if (pathname !== path) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const key = req.headers["sec-websocket-key"];
      const version = req.headers["sec-websocket-version"];
      if (!key || String(version) !== "13") {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "\r\n",
        ].join("\r\n")
      );
      socket.setNoDelay(true);
      attachSocket(req, socket);
      if (head && head.length) socket.emit("data", head);
    });

    if (!keepaliveTimer) {
      keepaliveTimer = setInterval(() => {
        const now = Date.now();
        for (const session of Array.from(sessions.values())) {
          if (now - session.lastSeen > STALE_MS) {
            dropSession(session, "keepalive timeout");
            continue;
          }
          try {
            session.socket.write(encodeFrame(9, Buffer.alloc(0))); // ping
          } catch (_) {
            dropSession(session, "ping failed");
          }
        }
      }, KEEPALIVE_MS);
      keepaliveTimer.unref();
    }
  }

  function pickSession(sessionId, op) {
    if (sessionId) {
      const s = sessions.get(sessionId);
      if (!s) {
        throw new HubError(
          "input",
          `no connected session with id "${sessionId}"`,
          "GET /api/sessions (or: daw-api status) lists the connected DAW tabs"
        );
      }
      return s;
    }
    if (sessions.size === 0) return null;
    // Newest session that serves the operation; else simply the newest session.
    let best = null;
    let bestAny = null;
    for (const s of sessions.values()) {
      if (!bestAny || (s.connectedAt || "") > (bestAny.connectedAt || "")) bestAny = s;
      if (op && s.ops.includes(op)) {
        if (!best || (s.connectedAt || "") > (best.connectedAt || "")) best = s;
      }
    }
    return best || bestAny;
  }

  /**
   * Run one operation inside a connected DAW tab.
   * @returns {Promise<{data:any, ms:number, sessionId:string}>}
   */
  function call(op, args, { sessionId = "", timeoutMs = 20000 } = {}) {
    const opName = typeof op === "string" ? op : op && op.name;
    const session = pickSession(sessionId, opName);
    if (!session) {
      throw new HubError(
        "blocked",
        "no DAW session is connected: page operations run inside a live Audius Studio browser tab",
        "open the DAW (npm start, then http://127.0.0.1:3000/) in a browser tab and keep it open, then retry; GET /api/sessions shows connected tabs"
      );
    }
    const id = `c${++callCounter}-${Date.now().toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(
          new HubError(
            "error",
            `the DAW tab did not answer "${opName}" within ${timeoutMs} ms`,
            "retry once; if it times out again the tab may be busy rendering or suspended — GET /api/sessions shows connected tabs"
          )
        );
      }, timeoutMs);
      session.pending.set(id, { resolve, reject, timer });
      const sent = sendJson(session.socket, { type: "call", id, op: opName, args: args || {}, timeoutMs });
      if (!sent) {
        clearTimeout(timer);
        session.pending.delete(id);
        reject(new HubError("error", "the DAW tab socket is gone", "retry the call once"));
      }
    });
  }

  function listSessions() {
    return Array.from(sessions.values())
      .map((s) => ({
        sessionId: s.sessionId,
        app: s.app,
        version: s.version,
        url: s.url,
        operations: s.ops.length,
        connectedAt: s.connectedAt,
        lastSeen: new Date(s.lastSeen).toISOString(),
        pendingCalls: s.pending.size,
      }))
      .sort((a, b) => (b.connectedAt || "").localeCompare(a.connectedAt || ""));
  }

  function close() {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    for (const session of Array.from(sessions.values())) dropSession(session, "hub closed");
  }

  return { attach, call, listSessions, close, get sessionCount() { return sessions.size; } };
}
