/**
 * Audius Studio — WASM effect host (main thread).
 *
 * Turns a plugin (an AudioWorklet module + a WebAssembly DSP core) into an
 * AudioWorkletNode that can be inserted into a track or the master bus.
 *
 *   • Built-in reference effects come from ./plugins/registry.js (same-origin).
 *   • Your own effects are loaded only through an explicit file picker or drop:
 *     a `.js` module that exports PLUGIN, plus a `.wasm` file. Nothing is ever
 *     fetched from a remote URL, and no VST/VST3/DLL binary can run in a
 *     browser — those are native plugins. See tools/wasm-plugins/README.md.
 *
 * Zero dependencies, no build step for the page itself.
 */
import { BUILTIN_PLUGINS, findBuiltin } from "./plugins/registry.js?v=2";

export const MAX_PLUGIN_JS_BYTES = 1_500_000;
export const MAX_PLUGIN_WASM_BYTES = 8_000_000;
export const MAX_PLUGIN_SLOTS = 10;

/** FNV-1a over bytes → short, stable type id for a user plugin. */
function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function bytesToBase64(bytes) {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

export function base64ToBytes(text) {
  const bin = atob(String(text || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const DRIVER_URL = "/plugins/wasm-fx-processor.js";
let driverTextCache = null;

async function getDriverText() {
  if (driverTextCache) return driverTextCache;
  const res = await fetch(DRIVER_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error(`the effect driver (${DRIVER_URL}) could not be loaded`);
  driverTextCache = await res.text();
  return driverTextCache;
}

/**
 * Composes the AudioWorklet module for one plugin: the driver, the plugin
 * source, and the registration call. Imported on the main thread for its
 * metadata and added to every AudioContext that needs it.
 */
function composeModuleSource(driver, processorName, pluginSource) {
  return [
    `const PROCESSOR_NAME = ${JSON.stringify(processorName)};`,
    "// ---- Audius Studio WASM effect driver ----",
    driver,
    "// ---- plugin source ----",
    pluginSource,
    "// ---- registration ----",
    "if (typeof registerProcessor === 'function') {",
    "  registerProcessor(PROCESSOR_NAME, createWasmFxProcessor());",
    "}",
    "",
  ].join("\n");
}

export class WasmFxHost {
  constructor({ onStatus = () => {}, onSlotError = () => {} } = {}) {
    this.definitions = new Map(); // type -> definition
    this.contextModules = new WeakMap(); // AudioContext -> Map(type -> Promise<name>)
    this.onStatus = onStatus;
    this.onSlotError = onSlotError;
    this.objectUrls = new Set();
    for (const entry of BUILTIN_PLUGINS) {
      this.definitions.set(entry.type, { ...entry, builtin: true, loaded: false });
    }
  }

  listBuiltins() {
    return BUILTIN_PLUGINS.map((p) => ({ ...p }));
  }

  getDefinition(type) {
    return this.definitions.get(type) || null;
  }

  /** Loads a built-in plugin's JS/WASM from the app's own origin. */
  async loadBuiltin(type) {
    const def = this.definitions.get(type);
    if (!def) throw new Error(`unknown effect type "${type}"`);
    if (def.loaded) return def;
    if (!def.loading) {
      def.loading = (async () => {
        // Plain-JavaScript effects have no WebAssembly core.
        const [jsRes, wasmRes] = await Promise.all([
          fetch(`${def.js}?v=2`, { cache: "force-cache" }),
          def.wasm ? fetch(`${def.wasm}?v=2`, { cache: "force-cache" }) : Promise.resolve(null),
        ]);
        if (!jsRes.ok) throw new Error(`${def.name}: the plugin module could not be loaded`);
        if (wasmRes && !wasmRes.ok) throw new Error(`${def.name}: the WebAssembly core could not be loaded`);
        const jsText = await jsRes.text();
        const wasmBytes = wasmRes ? new Uint8Array(await wasmRes.arrayBuffer()) : null;
        const resolved = await this.#resolvePlugin({
          type: def.type,
          name: def.name,
          jsText,
          wasmBytes,
          builtin: true,
          extra: def,
        });
        return resolved;
      })()
        .then((resolved) => {
          this.definitions.set(type, resolved);
          return resolved;
        })
        .catch((err) => {
          def.loading = null;
          throw err;
        });
      }
    return def.loading;
  }

  /** Registers a user's plugin from an explicit file choice. */
  async loadUserPlugin({ jsText, wasmBytes, name }) {
    if (typeof jsText !== "string" || !jsText.trim()) throw new Error("the plugin .js file is empty");
    if (jsText.length > MAX_PLUGIN_JS_BYTES) {
      throw new Error(`the plugin .js file is larger than ${(MAX_PLUGIN_JS_BYTES / 1e6).toFixed(1)} MB`);
    }
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes || []);
    if (!bytes.length) throw new Error("the plugin .wasm file is empty");
    if (bytes.length > MAX_PLUGIN_WASM_BYTES) {
      throw new Error(`the .wasm file is larger than ${(MAX_PLUGIN_WASM_BYTES / 1e6).toFixed(0)} MB`);
    }
    const type = `user-${hashBytes(bytes)}-${hashBytes(new TextEncoder().encode(jsText))}`;
    const existing = this.definitions.get(type);
    if (existing && existing.loaded) return existing;
    const resolved = await this.#resolvePlugin({
      type,
      name: String(name || "User effect").slice(0, 60),
      jsText,
      wasmBytes: bytes,
      builtin: false,
    });
    // Keep it by type so the engine's chain builder can find it without the
    // project slot having to carry the source around.
    this.definitions.set(type, resolved);
    return resolved;
  }

  /** Re-registers a user plugin that was saved inside a project. */
  async restoreUserPlugin(saved) {
    const jsText = saved && saved.jsB64 ? new TextDecoder().decode(base64ToBytes(saved.jsB64)) : "";
    const wasm = saved && saved.wasmB64 ? base64ToBytes(saved.wasmB64) : new Uint8Array();
    const def = await this.loadUserPlugin({ jsText, wasmBytes: wasm, name: saved && saved.name });
    return def;
  }

  async #resolvePlugin({ type, name, jsText, wasmBytes, builtin, extra = {} }) {
    // A plugin module may not pull code from anywhere: no static or dynamic
    // imports. Everything it needs is in the two files the user chose.
    if (/(^|[^.\w])import\s*[({'"]/m.test(jsText) || /\brequire\s*\(/.test(jsText)) {
      throw new Error(`${name}: plugin modules cannot use import or require — everything must live in the .js + .wasm pair`);
    }
    if (!/\bPLUGIN\b/.test(jsText)) {
      throw new Error(`${name}: the module does not define PLUGIN (see tools/wasm-plugins/README.md)`);
    }
    const driver = await getDriverText();
    const processorName = `wasm-fx-${type}-${Math.random().toString(36).slice(2, 8)}`;
    const source = composeModuleSource(driver, processorName, jsText);
    const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    this.objectUrls.add(blobUrl);
    let meta = null;
    try {
      const mod = await import(/* @vite-ignore */ blobUrl);
      const plugin = mod && mod.PLUGIN;
      if (!plugin || typeof plugin.process !== "function") {
        throw new Error(`${name}: PLUGIN.process is missing`);
      }
      let wasmModule = null;
      if (wasmBytes && wasmBytes.length) {
        wasmModule = await WebAssembly.compile(wasmBytes);
      }
      meta = {
        name: String(plugin.name || name),
        version: String(plugin.version || "1.0"),
        params: Array.isArray(plugin.params) ? plugin.params.slice(0, 24) : [],
        presets: Array.isArray(plugin.presets) ? plugin.presets.slice(0, 12) : [],
      };
      return {
        type,
        name: meta.name,
        version: meta.version,
        params: meta.params,
        presets: meta.presets,
        builtin: !!builtin,
        category: (extra && extra.category) || (builtin ? "Built-in" : "Loaded by you"),
        description: (extra && extra.description) || "",
        moduleSource: source,
        blobUrl,
        processorName,
        wasmModule,
        loaded: true,
        custom: builtin ? null : { name, jsB64: bytesToBase64(new TextEncoder().encode(jsText)), wasmB64: bytesToBase64(wasmBytes) },
      };
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      this.objectUrls.delete(blobUrl);
      throw err;
    }
  }

  /** Registers a definition's module with one AudioContext (cached). */
  async registerOnContext(ctx, definition) {
    if (!ctx || !ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function") {
      throw new Error("this browser has no AudioWorklet support, so WASM effects cannot run");
    }
    let map = this.contextModules.get(ctx);
    if (!map) {
      map = new Map();
      this.contextModules.set(ctx, map);
    }
    const key = definition.type;
    if (!map.has(key)) {
      map.set(
        key,
        ctx.audioWorklet.addModule(definition.blobUrl).then(() => definition.processorName)
      );
    }
    return await map.get(key);
  }

  /**
   * Creates the AudioWorkletNode for one slot. `onMeta` fires once the
   * processor has reported its parameter metadata; `onError` fires if the
   * processor throws, so the UI can mark the slot and the engine can bypass it.
   */
  async createSlotNode(ctx, slot, { values = {}, onMeta = null, onError = null } = {}) {
    let def = this.definitions.get(slot.type);
    if (!def || !def.loaded) {
      // A project may be opened before its saved user plugins are registered:
      // restore from the slot's own source, or load the built-in by type.
      if (slot.custom) def = await this.restoreUserPlugin(slot.custom);
      else def = await this.loadBuiltin(slot.type);
    }
    const processorName = await this.registerOnContext(ctx, def);
    const effective = { ...(def.params || []).reduce((acc, p) => ((acc[p.id] = p.default), acc), {}), ...values };
    const node = new AudioWorkletNode(ctx, processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: {
        name: def.name,
        wasmModule: def.wasmModule || null,
        values: effective,
        bypass: !!slot.bypass,
      },
    });
    node.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === "meta" && typeof onMeta === "function") onMeta(msg);
      if (msg.type === "error" && typeof onError === "function") onError(msg.message || "the plugin failed");
    };
    node.onprocessorerror = () => {
      if (typeof onError === "function") onError("the plugin stopped responding and was bypassed");
    };
    return { node, def };
  }

  setParam(node, id, value) {
    try {
      node.port.postMessage({ type: "param", id, value });
    } catch (_) {}
  }

  setBypass(node, on) {
    try {
      node.port.postMessage({ type: "bypass", on: !!on });
    } catch (_) {}
  }

  /** Actually stops a node's processor and drops every reference to it. */
  disposeNode(node) {
    if (!node) return;
    try {
      node.port.postMessage({ type: "dispose" });
    } catch (_) {}
    try {
      node.port.close();
    } catch (_) {}
    try {
      node.onprocessorerror = null;
      node.disconnect();
    } catch (_) {}
  }
}
