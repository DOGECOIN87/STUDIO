/**
 * Minimal Chrome DevTools Protocol harness (no dependencies).
 * Used by tools/browser/layout-audit.mjs; see the CHROME_* env vars below.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

// Chromium binary and its shared libraries/fontconfig are not vendored here.
// Point these at any headless Chromium 120+ build:
//   CHROME_BIN=/path/to/chrome CHROME_LIBS=/path/to/lib //   CHROME_FONTS=/path/to/fonts.conf node tools/browser/layout-audit.mjs
const CHROME = process.env.CHROME_BIN || "/tmp/chrome153/chromium";
const LIBS = process.env.CHROME_LIBS || "/tmp/chrome153/x/lib";
const FONTS = process.env.CHROME_FONTS || "/tmp/chrome153/fonts-good.conf";
// Full Chromium uses "--headless=new". A headless-shell build (the
// @sparticuz/chromium 153 npm artifact this sandbox family uses) only accepts
// "--headless=shell" and needs the single-process/zygote flags.
const HEADLESS = process.env.CHROME_HEADLESS || "new";
const SHELL = HEADLESS === "shell";

export async function launch({ port = 9222, width = 1361, height = 900 } = {}) {
  const userDir = `/tmp/cdp-profile-${port}`;
  fs.rmSync(userDir, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    `--headless=${HEADLESS}`,
    ...(SHELL ? ["--single-process", "--no-zygote"] : []),
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--font-render-hinting=none",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ], {
    env: { ...process.env, LD_LIBRARY_PATH: LIBS, FONTCONFIG_FILE: FONTS },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  const started = Date.now();
  let version = null;
  while (Date.now() - started < 25000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!version) throw new Error("Chromium did not start:\n" + stderr.slice(-2000));
  return { proc, port, version, stop: () => proc.kill("SIGKILL") };
}

export class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];
    this.onEvent = null;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message + " " + JSON.stringify(msg.error.data || "")));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.pageErrors.push(d.exception?.description || d.text);
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.consoleErrors.push(msg.params.entry.text);
      }
      if (this.onEvent) this.onEvent(msg);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 45000);
    });
  }
}

export async function newPage(server, { width = 1361, height = 900 } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${server.port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const page = new Page(ws);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  await page.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  return page;
}

export async function setViewport(page, width, height, { touch = false, mobile = false } = {}) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: !!touch, maxTouchPoints: touch ? 5 : 1 });
}

export async function goto(page, url, { waitMs = 2000 } = {}) {
  await page.send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, waitMs));
}

export async function evalIn(page, expression) {
  const res = await page.send("Runtime.evaluate", {
    expression: `(async () => { return eval(${JSON.stringify(expression)}); })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error("Eval failed: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text) + "\nExpr: " + expression.slice(0, 300));
  }
  return res.result.value;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function shot(page, file) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}
