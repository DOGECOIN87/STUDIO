/**
 * Audius Studio — WASM effect UI.
 *
 * Two surfaces, both driven from the project (never from private state):
 *
 *   • the "Plugins" section of the mixer's FX rack, for the selected insert or
 *     the master bus: add, enable, bypass, reorder, remove;
 *   • the effect window: presets, bypass, and one knob per parameter.
 *
 * A slot's values are the project's; a knob drag updates the project, then the
 * running worklet. Rendering is a full rebuild of two small lists, which is
 * cheap (≤10 slots) and keeps the DOM honest.
 */
import { BUILTIN_PLUGINS } from "./plugins/registry.js?v=2";

const MAX_SLOTS = 10;

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function formatValue(param, value) {
  if (!param) return String(value);
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  switch (param.format) {
    case "percent":
      return `${Math.round(((v - param.min) / (param.max - param.min || 1)) * 100)}%`;
    case "ms": {
      // Echo Line's Time control uses the same 20 ms … 1.9 s curve as its DSP.
      const sec = 0.02 + 1.88 * v * v;
      return sec < 1 ? `${Math.round(sec * 1000)} ms` : `${sec.toFixed(2)} s`;
    }
    case "hz":
      return `${v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : Math.round(v) + " Hz"}`;
    case "db":
      return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
    case "time-ms":
      return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
    case "ratio":
      return `${v < 10 ? v.toFixed(1) : Math.round(v)}:1`;
    case "freq": {
      // 0..1 knob on a log curve, 20 Hz … 20 kHz (Sweep Filter).
      const hz = 20 * Math.pow(1000, clamp(v, 0, 1));
      return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
    }
    case "rate": {
      // 0..1 knob on a log curve, 0.05 … 5 Hz (chorus / phaser LFO).
      const hz = 0.05 * Math.pow(100, clamp(v, 0, 1));
      return `${hz < 1 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
    }
    default:
      return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
  }
}

export function initWasmFxUi(deps) {
  const section = $("fx-plugin-section");
  const win = $("plugin-window");
  if (!section || !win) return null;

  const dom = {
    list: $("fx-plugin-list"),
    targetLabel: $("fx-plugin-target"),
    tabInsert: $("fx-target-insert"),
    tabMaster: $("fx-target-master"),
    add: $("btn-fx-add-plugin"),
    note: $("fx-plugin-note"),
    menu: $("fx-plugin-menu"),
    jsInput: $("fx-plugin-js-input"),
    wasmInput: $("fx-plugin-wasm-input"),
    title: $("plugin-title"),
    presetPrev: $("plugin-preset-prev"),
    presetNext: $("plugin-preset-next"),
    presetName: $("plugin-preset-name"),
    bypass: $("plugin-bypass"),
    close: $("btn-close-plugin"),
    knobs: $("plugin-knobs"),
    status: $("plugin-status"),
    source: $("plugin-source"),
    remove: $("btn-plugin-remove"),
  };

  let target = "insert"; // "insert" | "master"
  let openSlotId = null; // slot shown in the effect window
  let menuAnchor = null;

  const project = () => deps.getProject();
  const host = () => deps.host;

  /**
   * Slot changes are user gestures, so this is the moment to bring the audio
   * graph up: without a context the engine has no track nodes to insert into.
   */
  function ensureAudio() {
    try {
      deps.engine.ensureContext();
    } catch (_) {}
  }

  function targetKey() {
    return target === "master" ? "master" : deps.getSelectedTrackId();
  }

  function slotsFor(key = targetKey()) {
    const p = project();
    if (!p) return null;
    if (key === "master") {
      if (!Array.isArray(p.masterFxPlugins)) p.masterFxPlugins = [];
      return p.masterFxPlugins;
    }
    // A selected bus edits its own chain like a track.
    const track = p.tracks.find((t) => t.id === key) || (p.buses || []).find((b) => b.id === key);
    if (!track) return null;
    if (!Array.isArray(track.fxPlugins)) track.fxPlugins = [];
    return track.fxPlugins;
  }

  function targetName() {
    if (target === "master") return "Master";
    const p = project();
    const track = p.tracks.find((t) => t.id === targetKey()) || (p.buses || []).find((b) => b.id === targetKey());
    return track ? track.name.replace(/^\d+\s*·\s*/, "") : "Insert";
  }

  function definitionFor(slot) {
    return host() ? host().getDefinition(slot && slot.type) : null;
  }

  function newSlotId() {
    return `fxp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function defaultsFor(def) {
    const values = {};
    for (const p of def.params || []) values[p.id] = p.default;
    return values;
  }

  /* ------------------------------------------------------------------ rack */

  function renderRack() {
    const key = targetKey();
    const slots = slotsFor(key);
    dom.targetLabel.textContent = targetName();
    dom.tabInsert.setAttribute("aria-pressed", String(target === "insert"));
    dom.tabMaster.setAttribute("aria-pressed", String(target === "master"));
    dom.tabMaster.disabled = false;
    dom.list.replaceChildren();
    if (!slots) {
      dom.list.appendChild(el("p", "fx-plugin-empty", "Select an insert in the mixer to add effects."));
      dom.add.disabled = true;
      renderWindow();
      return;
    }
    dom.add.disabled = slots.length >= MAX_SLOTS;
    dom.add.title = slots.length >= MAX_SLOTS ? `A strip holds at most ${MAX_SLOTS} plugins` : "Add an effect to this strip";

    if (slots.length === 0) {
      dom.list.appendChild(el("p", "fx-plugin-empty", "No plugins on this strip yet. The six built-in slots above stay where they are."));
    }
    slots.forEach((slot, index) => {
      const def = definitionFor(slot);
      const row = el("div", "fx-plugin-row" + (slot.id === openSlotId ? " active" : ""));
      row.dataset.slotId = slot.id;

      const power = el("button", "fx-plugin-led" + (slot.bypass ? "" : " on"));
      power.type = "button";
      power.setAttribute("aria-pressed", String(!slot.bypass));
      power.setAttribute("aria-label", `${slot.bypass ? "Enable" : "Bypass"} ${def ? def.name : slot.name || "plugin"}`);
      power.title = `${slot.bypass ? "Enable" : "Bypass"} ${def ? def.name : slot.name || "plugin"}`;
      power.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleBypass(slot);
      });

      const label = el("button", "fx-plugin-name");
      label.type = "button";
      const name = def ? def.name : slot.name || slot.type || "Plugin";
      label.textContent = name;
      label.title = slot.error ? `${name} — ${slot.error}` : name;
      label.setAttribute("aria-label", `Open ${name}${slot.error ? " (error: " + slot.error + ")" : ""}`);
      if (slot.error) row.classList.add("error");
      label.addEventListener("click", () => openSlot(slot.id));

      const more = el("button", "fx-plugin-more");
      more.type = "button";
      more.textContent = "⋯";
      more.title = `Options for ${name}`;
      more.setAttribute("aria-label", `Options for ${name}`);
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        openSlotMenu(slot, index, more);
      });

      row.append(power, label, more);
      dom.list.appendChild(row);
    });
    renderWindow();
  }

  function closeMenu() {
    dom.menu.hidden = true;
    menuAnchor = null;
  }

  function openSlotMenu(slot, index, anchor) {
    const key = targetKey();
    const slots = slotsFor(key);
    if (!slots) return;
    if (!dom.menu.hidden && menuAnchor === anchor) {
      closeMenu();
      return;
    }
    dom.menu.replaceChildren();
    menuAnchor = anchor;
    const head = el("div", "ctx-head");
    head.appendChild(el("strong", null, definitionFor(slot)?.name || slot.name || "Plugin"));
    dom.menu.appendChild(head);

    const mk = (text, disabled, fn, danger) => {
      const b = el("button", "ctx-btn" + (danger ? " danger" : ""));
      b.type = "button";
      b.textContent = text;
      b.disabled = !!disabled;
      if (!disabled) b.addEventListener("click", () => { closeMenu(); fn(); });
      dom.menu.appendChild(b);
    };
    mk("Move up", index === 0, () => moveSlot(slots, index, -1));
    mk("Move down", index === slots.length - 1, () => moveSlot(slots, index, 1));
    mk(slot.bypass ? "Enable" : "Bypass", false, () => toggleBypass(slot));
    mk("Open controls", false, () => openSlot(slot.id));
    mk("Remove", false, () => removeSlot(slot), true);

    dom.menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const mw = dom.menu.offsetWidth;
    const mh = dom.menu.offsetHeight;
    let left = r.right - mw;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    left = clamp(left, 8, Math.max(8, window.innerWidth - mw - 8));
    dom.menu.style.left = `${Math.round(left)}px`;
    dom.menu.style.top = `${Math.round(top)}px`;
  }

  /* --------------------------------------------------------------- actions */

  function toggleBypass(slot) {
    ensureAudio();
    deps.beginEdit();
    slot.bypass = !slot.bypass;
    if (!slot.bypass) slot.error = null; // re-enabling is also the retry
    deps.commit(`${definitionFor(slot)?.name || slot.name || "Plugin"} ${slot.bypass ? "bypassed" : "enabled"}`);
    refresh();
  }

  function moveSlot(slots, index, delta) {
    const next = index + delta;
    if (next < 0 || next >= slots.length) return;
    ensureAudio();
    deps.beginEdit();
    const [item] = slots.splice(index, 1);
    slots.splice(next, 0, item);
    deps.commit(`Moved ${definitionFor(item)?.name || "plugin"} ${delta < 0 ? "up" : "down"}`);
    refresh();
  }

  function removeSlot(slot) {
    const slots = slotsFor();
    if (!slots) return;
    const index = slots.findIndex((s) => s.id === slot.id);
    if (index === -1) return;
    ensureAudio();
    deps.beginEdit();
    slots.splice(index, 1);
    if (openSlotId === slot.id) {
      openSlotId = null;
      hideWindow();
    }
    deps.commit(`Removed ${definitionFor(slot)?.name || slot.name || "plugin"}${slot.error ? " (it had failed)" : ""}`);
    refresh();
  }

  async function addBuiltin(type) {
    const key = targetKey();
    const slots = slotsFor(key);
    if (!slots) return;
    if (slots.length >= MAX_SLOTS) {
      deps.setStatus(`This strip already holds ${MAX_SLOTS} plugins`, { kind: "error" });
      return;
    }
    ensureAudio();
    deps.setStatus("Loading effect…");
    let def;
    try {
      def = await host().loadBuiltin(type);
    } catch (err) {
      deps.setStatus(`Effect could not load: ${err.message}`, { kind: "error" });
      return;
    }
    deps.beginEdit();
    const slot = {
      id: newSlotId(),
      type: def.type,
      name: def.name,
      bypass: false,
      values: defaultsFor(def),
      presets: def.presets || [],
    };
    slots.push(slot);
    deps.commit(`Added ${def.name} to ${targetName()}`);
    openSlot(slot.id);
    refresh();
  }

  let pendingUserJs = null;
  function requestUserPlugin() {
    pendingUserJs = null;
    dom.jsInput.value = "";
    dom.wasmInput.value = "";
    dom.jsInput.click();
  }

  dom.jsInput.addEventListener("change", async () => {
    const file = dom.jsInput.files && dom.jsInput.files[0];
    if (!file) return;
    if (!/\.m?js$/i.test(file.name)) {
      deps.setStatus("Choose the plugin's .js module first (it defines PLUGIN)", { kind: "error" });
      return;
    }
    try {
      pendingUserJs = { name: file.name.replace(/\.m?js$/i, ""), text: await file.text() };
    } catch (_) {
      deps.setStatus("That .js file could not be read", { kind: "error" });
      return;
    }
    deps.setStatus("Now choose the matching .wasm file");
    dom.wasmInput.value = "";
    dom.wasmInput.click();
  });

  dom.wasmInput.addEventListener("change", async () => {
    const file = dom.wasmInput.files && dom.wasmInput.files[0];
    if (!file || !pendingUserJs) return;
    if (!/\.wasm$/i.test(file.name)) {
      deps.setStatus("The second file must be the plugin's .wasm core", { kind: "error" });
      return;
    }
    await addUserPlugin(pendingUserJs, file);
    pendingUserJs = null;
  });

  async function addUserPlugin(jsFile, wasmFile) {
    const slots = slotsFor();
    if (!slots) return;
    if (slots.length >= MAX_SLOTS) {
      deps.setStatus(`This strip already holds ${MAX_SLOTS} plugins`, { kind: "error" });
      return;
    }
    ensureAudio();
    deps.setStatus("Loading your effect…");
    let def;
    try {
      const wasmBytes = new Uint8Array(await wasmFile.arrayBuffer());
      def = await host().loadUserPlugin({ jsText: jsFile.text, wasmBytes, name: jsFile.name || wasmFile.name });
    } catch (err) {
      deps.setStatus(`Plugin rejected: ${err.message}`, { kind: "error" });
      return;
    }
    deps.beginEdit();
    const slot = {
      id: newSlotId(),
      type: def.type,
      name: def.name,
      bypass: false,
      values: defaultsFor(def),
      presets: def.presets || [],
      // The source is stored with the project so Save/Open keeps working.
      custom: def.custom || null,
    };
    slots.push(slot);
    deps.commit(`Loaded ${def.name} (${def.params.length} parameters)`);
    openSlot(slot.id);
    refresh();
  }

  async function addFromDrop(files) {
    const list = Array.from(files || []);
    const js = list.find((f) => /\.m?js$/i.test(f.name));
    const wasm = list.find((f) => /\.wasm$/i.test(f.name));
    if (!js || !wasm) {
      deps.setStatus("Drop a plugin .js module and its .wasm core together", { kind: "error" });
      return false;
    }
    let text;
    try {
      text = await js.text();
    } catch (_) {
      deps.setStatus("That .js file could not be read", { kind: "error" });
      return false;
    }
    await addUserPlugin({ name: js.name.replace(/\.m?js$/i, ""), text }, wasm);
    return true;
  }

  /* ---------------------------------------------------------- effect window */

  function currentSlot() {
    if (!openSlotId) return null;
    const slots = slotsFor();
    return slots ? slots.find((s) => s.id === openSlotId) || null : null;
  }

  function currentDef() {
    const slot = currentSlot();
    return slot ? definitionFor(slot) : null;
  }

  function showWindow() {
    win.classList.remove("collapsed");
    if (deps.onWindowOpen) deps.onWindowOpen();
  }

  function hideWindow() {
    win.classList.add("collapsed");
    if (deps.onWindowClose) deps.onWindowClose();
  }

  function openSlot(slotId) {
    const slots = slotsFor();
    const slot = slots && slots.find((s) => s.id === slotId);
    if (!slot) return;
    openSlotId = slotId;
    renderRack();
    showWindow();
  }

  function renderWindow() {
    const slot = currentSlot();
    if (!slot) {
      hideWindow();
      return;
    }
    const def = currentDef();
    const params = (def && def.params) || [];
    dom.title.textContent = def ? def.name : slot.name || slot.type || "Effect";
    if (dom.source) {
      dom.source.textContent = def
        ? `${def.name} ${def.version || ""} · ${def.builtin ? (def.wasm ? "built-in WebAssembly effect" : "built-in effect") : "loaded from your files"} · ${params.length} parameters`
        : "Loading the effect…";
    }
    dom.bypass.setAttribute("aria-pressed", String(!!slot.bypass));
    dom.bypass.textContent = slot.bypass ? "Bypassed" : "Bypass";
    dom.bypass.classList.toggle("on", !slot.bypass);

    const presets = (def && def.presets) || slot.presets || [];
    const presetIndex = slot.presetIndex != null ? slot.presetIndex : -1;
    dom.presetName.textContent = presetIndex >= 0 && presets[presetIndex] ? presets[presetIndex].name : "Presets";
    dom.presetPrev.disabled = presets.length === 0;
    dom.presetNext.disabled = presets.length === 0;

    dom.knobs.replaceChildren();
    for (const param of params) {
      const knob = el("div", "fx-knob");
      knob.setAttribute("role", "slider");
      knob.tabIndex = 0;
      knob.setAttribute("aria-label", param.name);
      knob.setAttribute("aria-valuemin", String(param.min));
      knob.setAttribute("aria-valuemax", String(param.max));
      const value = Number.isFinite(slot.values?.[param.id]) ? slot.values[param.id] : param.default;
      const dial = el("div", "fx-knob-dial");
      const pointer = el("div", "fx-knob-pointer");
      dial.appendChild(pointer);
      const name = el("span", "fx-knob-name", param.name);
      const readout = el("span", "fx-knob-value", formatValue(param, value));
      knob.append(dial, name, readout);
      setKnobVisual(knob, param, value);
      knob.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 0.01 : 0.05;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          applyParam(slot, param, Number(knob.dataset.value) + (param.max - param.min) * step, true);
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          applyParam(slot, param, Number(knob.dataset.value) - (param.max - param.min) * step, true);
        } else if (e.key === "Home") {
          e.preventDefault();
          applyParam(slot, param, param.min, true);
        } else if (e.key === "End") {
          e.preventDefault();
          applyParam(slot, param, param.max, true);
        }
      });
      knob.addEventListener("dblclick", () => applyParam(slot, param, param.default, true));
      knob.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        ensureAudio();
        deps.beginEdit();
        try {
          knob.setPointerCapture(e.pointerId);
        } catch (_) {}
        const startY = e.clientY;
        const startX = e.clientX;
        const start = Number(knob.dataset.value);
        const range = param.max - param.min;
        const move = (ev) => {
          const dy = startY - ev.clientY;
          const dx = ev.clientX - startX;
          const delta = (dy + dx) / 160;
          applyParam(slot, param, start + delta * range, false);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          deps.commit(`${param.name}: ${formatValue(param, slot.values[param.id])}`);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      });
      dom.knobs.appendChild(knob);
    }
    if (slot.error) {
      dom.status.textContent = `This plugin failed and was bypassed: ${slot.error}`;
      dom.status.dataset.kind = "error";
    } else if (slot.bypass) {
      dom.status.textContent = "Bypassed: the strip passes through untouched until you enable it.";
      dom.status.dataset.kind = "warn";
    } else {
      dom.status.textContent = `${def ? def.name : "Effect"} is running on ${targetName()}. Parameters save with the project.`;
      dom.status.dataset.kind = "ok";
    }
  }

  function setKnobVisual(knob, param, value) {
    const t = clamp((value - param.min) / (param.max - param.min || 1), 0, 1);
    knob.dataset.value = String(value);
    knob.style.setProperty("--arc", `${Math.round(t * 300)}deg`);
    knob.setAttribute("aria-valuenow", String(Number(value.toFixed(3))));
    knob.setAttribute("aria-valuetext", formatValue(param, value));
    const readout = knob.querySelector(".fx-knob-value");
    if (readout) readout.textContent = formatValue(param, value);
  }

  function applyParam(slot, param, rawValue, commit) {
    const value = clamp(Number(rawValue), param.min, param.max);
    if (!slot.values) slot.values = {};
    slot.values[param.id] = value;
    slot.presetIndex = -1;
    const key = slot === currentSlot() ? targetKey() : targetKey();
    const knob = dom.knobs.querySelector(`[aria-label="${CSS.escape(param.name)}"]`);
    if (knob) setKnobVisual(knob, param, value);
    dom.presetName.textContent = "Presets";
    deps.engine.setPluginParam(key, slot.id, param.id, value);
    if (commit) {
      deps.commit(`${param.name}: ${formatValue(param, value)}`);
      refresh();
    }
  }

  function applyPreset(delta) {
    const slot = currentSlot();
    if (!slot) return;
    const def = currentDef();
    const presets = (def && def.presets) || slot.presets || [];
    if (!presets.length) return;
    const current = slot.presetIndex != null ? slot.presetIndex : -1;
    const next = (current + delta + presets.length) % presets.length;
    const preset = presets[next];
    deps.beginEdit();
    slot.presetIndex = next;
    for (const param of (def && def.params) || []) {
      if (preset.values && Number.isFinite(preset.values[param.id])) {
        slot.values[param.id] = clamp(Number(preset.values[param.id]), param.min, param.max);
      }
    }
    deps.commit(`Preset: ${preset.name}`);
    // Push every value to the running worklet, then redraw.
    for (const param of (def && def.params) || []) {
      deps.engine.setPluginParam(targetKey(), slot.id, param.id, slot.values[param.id]);
    }
    refresh();
  }

  /* ------------------------------------------------------------- wiring */

  dom.tabInsert.addEventListener("click", () => {
    target = "insert";
    openSlotId = null;
    hideWindow();
    refresh();
  });
  dom.tabMaster.addEventListener("click", () => {
    target = "master";
    openSlotId = null;
    hideWindow();
    refresh();
  });
  dom.add.addEventListener("click", () => {
    dom.menu.replaceChildren();
    dom.menu.hidden = false;
    menuAnchor = dom.add;
    const head = el("div", "ctx-head");
    head.appendChild(el("strong", null, `Add to ${targetName()}`));
    dom.menu.appendChild(head);
    for (const entry of BUILTIN_PLUGINS) {
      const b = el("button", "ctx-btn");
      b.type = "button";
      b.textContent = entry.name;
      b.title = `${entry.description} (built-in effect)`;
      b.addEventListener("click", () => {
        closeMenu();
        addBuiltin(entry.type);
      });
      dom.menu.appendChild(b);
    }
    const load = el("button", "ctx-btn");
    load.type = "button";
    load.textContent = "Load effect files… (.js + .wasm)";
    load.title = "A plugin module that exports PLUGIN plus its WebAssembly core";
    load.addEventListener("click", () => {
      closeMenu();
      requestUserPlugin();
    });
    dom.menu.appendChild(load);
    const hint = el("p", "fx-plugin-menu-note", "WebAssembly only: a raw .vst/.vst3/.dll is a native plugin and cannot run in a browser.");
    dom.menu.appendChild(hint);
    const r = dom.add.getBoundingClientRect();
    const mw = dom.menu.offsetWidth;
    const mh = dom.menu.offsetHeight;
    let left = clamp(r.left, 8, Math.max(8, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    dom.menu.style.left = `${Math.round(left)}px`;
    dom.menu.style.top = `${Math.round(top)}px`;
  });

  dom.close.addEventListener("click", () => {
    hideWindow();
    openSlotId = null;
    renderRack();
  });
  dom.bypass.addEventListener("click", () => {
    const slot = currentSlot();
    if (slot) toggleBypass(slot);
  });
  dom.presetPrev.addEventListener("click", () => applyPreset(-1));
  dom.presetNext.addEventListener("click", () => applyPreset(1));
  if (dom.remove) {
    dom.remove.addEventListener("click", () => {
      const slot = currentSlot();
      if (slot) removeSlot(slot);
    });
  }

  // Close the little menu on an outside press or Escape.
  document.addEventListener("pointerdown", (e) => {
    if (dom.menu.hidden) return;
    if (dom.menu.contains(e.target)) return;
    if (menuAnchor && menuAnchor.contains(e.target)) return;
    closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dom.menu.hidden) {
      closeMenu();
      e.stopPropagation();
    }
  });

  // Dropping a plugin pair onto the rack loads it (explicit user action).
  section.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      e.preventDefault();
      section.classList.add("drop-target");
    }
  });
  section.addEventListener("dragleave", () => section.classList.remove("drop-target"));
  section.addEventListener("drop", async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    section.classList.remove("drop-target");
    await addFromDrop(e.dataTransfer.files);
  });

  function refresh() {
    if (win.classList.contains("collapsed")) openSlotId = openSlotId || null;
    renderRack();
  }

  /**
   * Re-registers any user plugins stored inside a project before the mixer
   * asks for their metadata. Malformed entries are skipped, never thrown.
   */
  async function prepareProject(p) {
    const all = [];
    if (Array.isArray(p.masterFxPlugins)) all.push(...p.masterFxPlugins);
    for (const track of [...(Array.isArray(p.tracks) ? p.tracks : []), ...(Array.isArray(p.buses) ? p.buses : [])]) {
      if (Array.isArray(track.fxPlugins)) all.push(...track.fxPlugins);
    }
    for (const slot of all) {
      if (!slot || typeof slot !== "object") continue;
      if (slot.custom && !host().getDefinition(slot.type)) {
        try {
          const def = await host().restoreUserPlugin(slot.custom);
          slot.type = def.type;
          slot.name = slot.name || def.name;
          if (!slot.values || typeof slot.values !== "object") slot.values = defaultsFor(def);
        } catch (err) {
          slot.error = `saved plugin could not be restored: ${err.message}`;
          slot.bypass = true;
        }
      } else if (slot.type && !host().getDefinition(slot.type)) {
        // A built-in that was removed in a later version, or an unknown type.
        try {
          await host().loadBuiltin(slot.type);
        } catch (_) {
          slot.error = "this effect is not available";
          slot.bypass = true;
        }
      }
    }
    return p;
  }

  return {
    refresh,
    prepareProject,
    openSlot,
    closeWindow: () => {
      hideWindow();
      openSlotId = null;
      renderRack();
    },
    get target() {
      return target;
    },
  };
}
