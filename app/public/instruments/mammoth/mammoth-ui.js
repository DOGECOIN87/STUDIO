/**
 * Mammoth — editor window.
 *
 * One floating window (a full-screen sheet on phones) that edits the patch of
 * the instrument it is bound to. The window never owns the patch: every read
 * goes through binding.getInstrument(), so undo / redo in the DAW (which
 * replaces the project objects) is picked up by refresh().
 *
 * Modulation works like this: every source (envelopes 1–4, slots 5–8,
 * macros, velocity, key track, aftertouch, trigger random) has a handle (+).
 * Drag it onto a knob — or press it, then press a knob — and the knob gets a
 * modulation slot. Drag a slot up or down to set its depth, double-click it to
 * remove it, or press the slots to edit them in a popover (keyboard and touch
 * friendly). Depth rings around each knob show what the engine does.
 *
 * Touch screens: a vertical swipe always scrolls the page, even when it starts
 * on a knob, a handle or a slot. A sideways drag turns a knob. A clean tap on a
 * knob opens its sheet (slider, fine steps, typed value, Reset, modulation).
 * Tap a source, then a clean tap on a knob, to assign it (two taps). The
 * window is a full-screen sheet with a bottom page bar on phones and touch
 * tablets; the keyboard stays docked on every page.
 */
import {
  MAMMOTH_PARAMS,
  PARAM_INDEX,
  MAMMOTH_ENUMS,
  ENUM_INDEX,
  MOD_SOURCES,
  MOD_SOURCE_INDEX,
  MAX_MODS_PER_PARAM,
  MAX_MODS,
  FILTER_TYPES,
  INSERT_TYPES,
  FX_TYPES,
  PERF_SHAPES,
  MAMMOTH_CATEGORIES,
  formatParam,
  normFor,
  mapValue,
  sanitizePatch,
  clonePatch,
  makeInitPatch,
  clamp01,
} from "./params.js?v=1";
import { TABLE_NAMES, buildWavetable, framePreview } from "./wavetables.js?v=1";
import { FACTORY_PRESETS } from "./presets.js?v=3";
import { applySkin, knobParts, skinSelect, SKINS, getSkin, setSkin } from "../analog.js?v=1";

export const USER_PRESETS_KEY = "audius_studio_mammoth_presets_v1";
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/* Breakpoints. Phone: the compact one-row header and a one-octave keyboard.
 * Sheet: the full-screen window with the bottom page bar (every phone, and touch
 * tablets up to 1366px wide). The same queries are read by mammoth.css. */
const Q_PHONE = "(max-width: 760px), (max-width: 900px) and (max-height: 520px)";
const Q_SHEET = `${Q_PHONE}, (pointer: coarse) and (max-width: 1366px)`;
const PAGES = [
  ["play", "Play"],
  ["osc1", "Osc 1"],
  ["osc2", "Osc 2"],
  ["osc3", "Osc 3"],
  ["filter", "Filter"],
  ["mod", "Mod"],
  ["fx", "FX"],
];
const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
export const isTouchUI = () => mq("(pointer: coarse), (hover: none)");
const isPhoneUI = () => mq(Q_PHONE);
const isSheetUI = () => mq(Q_SHEET);
export function noteName(n) {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

// Same layout as the DAW's typing keyboard: z = C, q = C an octave up.
const PIANO_KEYS = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ",": 12, l: 13, ".": 14, ";": 15, "/": 16,
  q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28,
};

// Short names for the performer's step curves (shown under each step).
const SHAPE_SHORT = ["Flat", "Up", "Down", "Tri", "Sine", "eUp", "eDn", "Sq", "Off"];
const SLOT_SHORT = ["LFO", "Perf", "Step"];

const KIND_VAR = { env: "var(--mmth-env)", lfo: "var(--mmth-lfo)", macro: "var(--mmth-macro)", perf: "var(--mmth-perf)" };
const srcInfo = (id) => MOD_SOURCES[MOD_SOURCE_INDEX[id]];
const srcColor = (id) => KIND_VAR[(srcInfo(id) || {}).kind] || "var(--mmth-env)";
const spec = (id) => MAMMOTH_PARAMS[PARAM_INDEX[id]];
const enumSpec = (id) => MAMMOTH_ENUMS[ENUM_INDEX[id]];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
  return e;
}
function iconSvg(name) {
  return `<svg class="icon icon-solo" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
/** Icon followed by text (the app's .icon keeps a small gap after it). */
function iconText(name, text) {
  const frag = document.createDocumentFragment();
  const holder = document.createElement("span");
  holder.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  frag.appendChild(holder.firstChild);
  frag.appendChild(document.createTextNode(text));
  return frag;
}

/* knob geometry: 270° sweep from -135° (min) to +135° (max) */
function knobPoint(r, t) {
  const a = ((-135 + 270 * t) * Math.PI) / 180;
  return [30 + r * Math.sin(a), 30 - r * Math.cos(a)];
}
function arcPath(r, t0, t1) {
  let a = clamp01(t0);
  let b = clamp01(t1);
  if (b < a) [a, b] = [b, a];
  if (b - a < 0.002) return "";
  const [x0, y0] = knobPoint(r, a);
  const [x1, y1] = knobPoint(r, b);
  const large = (b - a) * 270 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/* ------------------------------------------------------- user presets */

export function loadUserPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_PRESETS_KEY) || "[]");
    return Array.isArray(raw) ? raw.slice(0, 500).map((p) => sanitizePatch(p)) : [];
  } catch (_) {
    return [];
  }
}
function saveUserPresets(list) {
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list));
    return true;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------ editor */

let singleton = null;

/**
 * Opens (or re-targets) the editor window.
 * binding = {
 *   instrumentId, getInstrument() → {name, root, patch} | null, live() → MammothInstance | null,
 *   replacePatch(patch), setRoot(note), rename(name), beginEdit(label), commit(text),
 *   setStatus(text, kind), onClose(), liveSupported: boolean
 * }
 */
export function openMammothEditor(binding) {
  if (!singleton) singleton = createEditor();
  singleton.bind(binding);
  return singleton.api;
}

export function currentMammothEditor() {
  return singleton ? singleton.api : null;
}

function createEditor() {
  let binding = null;
  const knobs = new Map();
  const enumCtl = new Map();
  const powerCtl = new Map();
  const dynamic = [];
  let armed = null;
  let tab = "env1";
  let view = "synth";
  let kbBase = 48;
  const heldNotes = new Map();
  let popover = null;
  let popoverAnchor = null;
  let dragGhost = null;
  let dropTarget = null;
  let clipboard = null;
  let lastLive = new Map();
  let page = "play";
  const pagedNodes = [];
  let sheetId = null;
  let sheetEditing = false;
  let sheetSig = "";
  let holdOn = false;
  let holdBtn = null;
  const latched = new Set();
  let keysCount = 24;
  let kbRows = 1; // two stacked octaves on the big phone keyboard
  let kbBig = false; // Play page on phones and touch tablets: the keyboard fills the free space
  let keysRender = null;
  let flashTimer = 0;

  const inst = () => (binding ? binding.getInstrument() : null);
  const patch = () => {
    const i = inst();
    return i ? i.patch : makeInitPatch();
  };
  const synth = () => (binding ? binding.live() : null);

  /* ------------------------------------------------------- skeleton */
  const root = el("div", "mmth-window");
  root.hidden = true;
  applySkin(root);
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.tabIndex = -1;

  const bar = el("div", "mmth-titlebar");
  const brand = el("div", "mmth-brand");
  const logo = el("span", "mmth-logo", "MAMMOTH");
  const title = el("span", "mmth-title");
  brand.append(logo, title);

  const presetGroup = el("div", "mmth-presetbar");
  presetGroup.setAttribute("role", "group");
  presetGroup.setAttribute("aria-label", "Presets");
  const btnPrev = button("", "mmth-btn mmth-icon-btn", "Previous preset");
  btnPrev.innerHTML = iconSvg("chevron-left");
  const presetName = button("Init", "mmth-btn mmth-preset-name", "Open the preset browser");
  const btnNext = button("", "mmth-btn mmth-icon-btn", "Next preset");
  btnNext.innerHTML = iconSvg("chevron-right");
  const btnSave = button("", "mmth-btn", "Save as a user preset");
  btnSave.innerHTML = `${iconSvg("save")}<span>Save</span>`;
  btnSave.classList.add("mmth-save");
  presetGroup.append(btnPrev, presetName, btnNext, btnSave);

  const readout = el("span", "mmth-readout", "Voices 0 · CPU 0%");
  readout.setAttribute("aria-live", "off");
  const viewTabs = el("div", "mmth-views");
  viewTabs.setAttribute("role", "tablist");
  viewTabs.setAttribute("aria-label", "View");
  const viewSynth = button("Synth", "mmth-btn mmth-view-tab", "Synth view");
  const viewBrowser = button("Browser", "mmth-btn mmth-view-tab", "Preset browser");
  for (const b of [viewSynth, viewBrowser]) b.setAttribute("role", "tab");
  viewTabs.append(viewSynth, viewBrowser);
  const btnMenu = button("", "mmth-btn mmth-icon-btn mmth-menu-btn", "More: init, randomize, copy, paste, import, export");
  btnMenu.innerHTML = iconSvg("ellipsis");
  btnMenu.setAttribute("aria-haspopup", "menu");
  const btnClose = button("", "mmth-btn mmth-icon-btn mmth-close", "Close the synth");
  btnClose.innerHTML = iconSvg("x");
  bar.append(brand, presetGroup, readout, viewTabs, skinSelect("mmth-skin"), btnMenu, btnClose);

  // Messages hang off the header's bottom edge (never over the keyboard). Status lines
  // fade after a few seconds; the armed banner stays until the assign is done or cancelled.
  const flashEl = el("div", "mmth-flash");
  flashEl.setAttribute("role", "status");
  flashEl.setAttribute("aria-live", "polite");
  flashEl.hidden = true;
  const banner = el("div", "mmth-banner");
  banner.hidden = true;
  const bannerText = el("span", "mmth-banner-text");
  const bannerCancel = button("Cancel", "mmth-btn", "Cancel modulation assign");
  banner.append(bannerText, bannerCancel);
  bar.append(flashEl, banner);

  const notice = el("p", "mmth-notice");
  notice.hidden = true;
  notice.setAttribute("role", "status");

  const body = el("div", "mmth-body");
  const synthView = el("div", "mmth-synth");
  const browserView = el("div", "mmth-browser");
  browserView.hidden = true;
  body.append(synthView, browserView);

  // Bottom page bar (sheet mode only) and the docked keyboard, which is on every page.
  const pageBar = el("nav", "mmth-pagebar");
  pageBar.setAttribute("aria-label", "Synth pages");
  const pageTabs = new Map();
  for (const [key, text] of PAGES) {
    const b = button(text, "mmth-pagetab", `${text} page`);
    b.dataset.page = key;
    b.addEventListener("click", () => setPage(key));
    pageTabs.set(key, b);
    pageBar.appendChild(b);
  }
  const dock = el("div", "mmth-dock");

  // Knob sheet: a bottom sheet for one knob (slider, steps, typed value, Reset, modulation).
  const scrim = el("div", "mmth-ks-scrim");
  scrim.hidden = true;
  scrim.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    closeKnobSheet();
  });
  const sheetEl = el("div", "mmth-ksheet");
  sheetEl.hidden = true;
  sheetEl.setAttribute("role", "dialog");
  sheetEl.setAttribute("aria-modal", "false");
  const sheetHead = el("div", "mmth-ks-head");
  const sheetTitle = el("strong", "mmth-ks-title");
  const sheetValue = el("span", "mmth-ks-value");
  const sheetClose = button("", "mmth-btn mmth-icon-btn", "Close knob sheet");
  sheetClose.innerHTML = iconSvg("x");
  sheetClose.dataset.act = "close";
  sheetHead.append(sheetTitle, sheetValue, sheetClose);
  const sheetRow = el("div", "mmth-ks-row");
  const sMinus = button("", "mmth-btn mmth-icon-btn", "Down 1%");
  sMinus.innerHTML = iconSvg("minus");
  sMinus.dataset.act = "minus";
  const sSlider = el("input", "mmth-ks-slider");
  sSlider.type = "range";
  sSlider.min = "0";
  sSlider.max = "1000";
  sSlider.step = "1";
  const sPlus = button("", "mmth-btn mmth-icon-btn", "Up 1%");
  sPlus.innerHTML = iconSvg("plus");
  sPlus.dataset.act = "plus";
  sheetRow.append(sMinus, sSlider, sPlus);
  const sEntry = el("div", "mmth-ks-row");
  const sInput = el("input", "mmth-input mmth-ks-input");
  sInput.type = "text";
  sInput.inputMode = "decimal";
  sInput.setAttribute("aria-label", "Type a value from 0 to 100 percent of the range");
  sInput.placeholder = "0–100 %";
  const sSet = button("Set", "mmth-btn", "Set the typed value");
  sSet.dataset.act = "set";
  const sReset = button("Reset", "mmth-btn", "Reset to the default value");
  sReset.dataset.act = "reset";
  sEntry.append(sInput, sSet, sReset);
  const sModsLabel = el("span", "mmth-field-label", "Modulation");
  const sMods = el("div", "mmth-ks-mods");
  sheetEl.append(sheetHead, sheetRow, sEntry, sModsLabel, sMods);

  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;

  root.append(bar, notice, body, pageBar, dock, scrim, sheetEl, fileInput);
  document.body.appendChild(root);

  function button(text, cls, label) {
    const b = el("button", cls, text);
    b.type = "button";
    if (label) {
      b.title = label;
      b.setAttribute("aria-label", label);
    }
    return b;
  }

  /* ------------------------------------------------------- editing */
  function begin(label) {
    if (binding && binding.beginEdit) binding.beginEdit(label);
  }
  function commit(text) {
    if (binding && binding.commit) binding.commit(text);
    if (text) status(text);
  }
  /** Editor messages: a line anchored to the header, gone after a few seconds. */
  function status(text, kind) {
    if (!text) return;
    flashEl.textContent = text;
    flashEl.dataset.kind = kind || "info";
    flashEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashEl.hidden = true;
    }, kind === "error" ? 5000 : 3000);
  }
  const touchHint = (phrase) => (isTouchUI() ? phrase.touch : phrase.mouse);

  function setParam(id, n) {
    const p = patch();
    const v = clamp01(n);
    p.params[id] = v;
    const s = synth();
    if (s) s.setParam(id, v);
    updateId(id);
    paramSideEffects(id);
  }

  function paramSideEffects(id) {
    if (/^env\d\./.test(id)) drawEnvGraph();
    else if (/^mod\d\./.test(id)) drawSlotGraph();
    else if (/^osc\d\.(pos|int)$/.test(id)) drawOscPreview(Number(id[3]));
  }

  function setEnum(id, v) {
    const p = patch();
    p.enums[id] = v | 0;
    const s = synth();
    if (s) s.setEnum(id, v | 0);
    if (/^mod[5-8]\.type$/.test(id) || /^mod[5-8]\.sync$/.test(id)) {
      if (tab === `mod${id[3]}`) renderTab();
    }
    refreshStatic();
  }

  function modsFor(id) {
    return patch().mods.filter((m) => m.dst === id);
  }

  function pushMods() {
    const s = synth();
    if (s) s.setMods(patch().mods);
  }

  function addMod(src, dst) {
    const sp = spec(dst);
    if (!sp) return;
    const p = patch();
    const name = srcInfo(src).name;
    if (!sp.mod) {
      status(`${labelFor(dst)} can't be modulated.`, "error");
      return;
    }
    if (p.mods.some((m) => m.src === src && m.dst === dst)) {
      status(`${name} already modulates ${labelFor(dst)} — drag its slot to change the depth.`);
      return;
    }
    if (modsFor(dst).length >= MAX_MODS_PER_PARAM) {
      status(`${labelFor(dst)} already has ${MAX_MODS_PER_PARAM} modulation sources.`, "error");
      return;
    }
    if (p.mods.length >= MAX_MODS) {
      status(`This patch already uses ${MAX_MODS} modulation routings.`, "error");
      return;
    }
    begin(`Modulate ${labelFor(dst)}`);
    const amt = /pitch$/.test(dst) ? 0.125 : 0.3;
    p.mods.push({ src, dst, amt });
    pushMods();
    updateId(dst);
    commit(`${name} → ${groupOf(dst)} ${labelFor(dst)} (${touchHint({ touch: "open the slot to set depth", mouse: "drag the slot to set depth" })})`);
  }

  function setModAmt(src, dst, amt) {
    const m = patch().mods.find((x) => x.src === src && x.dst === dst);
    if (!m) return;
    m.amt = Math.max(-1, Math.min(1, Math.round(amt * 1000) / 1000));
    pushMods();
    updateId(dst);
  }

  function removeMod(src, dst) {
    const p = patch();
    const i = p.mods.findIndex((m) => m.src === src && m.dst === dst);
    if (i < 0) return;
    begin("Remove modulation");
    p.mods.splice(i, 1);
    pushMods();
    updateId(dst);
    commit(`Removed ${srcInfo(src).name} from ${labelFor(dst)}`);
  }

  /* ------------------------------------------------------- labels */
  function fmtCtx(id) {
    const p = patch();
    let m = /^filter([12])\./.exec(id);
    if (m) return { filterType: p.enums[`filter${m[1]}.type`] };
    m = /^mod([5-8])\.rate$/.exec(id);
    if (m) return { synced: !!p.enums[`mod${m[1]}.sync`] };
    return {};
  }

  function labelFor(id) {
    const p = patch();
    let m = /^filter([12])\.(cutoff|b|res)$/.exec(id);
    if (m) {
      const t = FILTER_TYPES[p.enums[`filter${m[1]}.type`]] || FILTER_TYPES[0];
      return t.knobs[{ cutoff: 0, b: 1, res: 2 }[m[2]]];
    }
    m = /^ins([12])\.(a|b)$/.exec(id);
    if (m) {
      const t = INSERT_TYPES[p.enums[`ins${m[1]}.type`]] || INSERT_TYPES[0];
      return t.knobs[m[2] === "a" ? 0 : 1];
    }
    m = /^fx([12])\.(a|b|c)$/.exec(id);
    if (m) {
      const t = FX_TYPES[p.enums[`fx${m[1]}.type`]] || FX_TYPES[0];
      return t.knobs["abc".indexOf(m[2])];
    }
    m = /^osc([123])\.int$/.exec(id);
    if (m) return ["Intensity", "Bend", "Bend", "Bend", "Formant", "Sync"][p.enums[`osc${m[1]}.mode`]] || "Intensity";
    m = /^macro([1-8])$/.exec(id);
    if (m) return p.macroNames[Number(m[1]) - 1] || `Macro ${m[1]}`;
    m = /^env([1-4])\.sustain$/.exec(id);
    if (m) return "Sustain";
    return spec(id).label;
  }

  function groupOf(id) {
    let m = /^osc([123])\./.exec(id);
    if (m) return `OSC ${m[1]}`;
    if (/^modosc\./.test(id)) return "Mod OSC";
    m = /^filter([12])\./.exec(id);
    if (m) return `Filter ${m[1]}`;
    m = /^ins([12])\./.exec(id);
    if (m) return `Insert ${m[1]}`;
    m = /^fx([12])\./.exec(id);
    if (m) return `FX ${m[1]}`;
    m = /^env([1-4])\./.exec(id);
    if (m) return `Env ${m[1]}`;
    m = /^mod([5-8])\./.exec(id);
    if (m) return `Slot ${m[1]}`;
    const g = id.split(".")[0];
    return { noise: "Noise", fb: "Feedback", filters: "Filters", amp: "Amp", byp: "Bypass", master: "Master", eq: "EQ", voice: "Voicing", global: "Global" }[g] || "";
  }

  /* ------------------------------------------------------- knobs */
  function knob(id, opts = {}) {
    const sp = spec(id);
    const wrap = el("div", `mmth-knob${opts.small ? " mmth-knob-sm" : ""}`);
    wrap.dataset.param = id;
    if (sp.mod) wrap.dataset.mod = "1";
    const dial = el("div", "mmth-dial");
    dial.tabIndex = 0;
    dial.setAttribute("role", "slider");
    dial.setAttribute("aria-valuemin", "0");
    dial.setAttribute("aria-valuemax", "100");
    const svg = svgEl("svg", { viewBox: "0 0 60 60", "aria-hidden": "true", focusable: "false" });
    const track = svgEl("path", { class: "mmth-track", d: arcPath(20, 0, 1) });
    const modArcs = [0, 1, 2].map(() => svgEl("path", { class: "mmth-modarc" }));
    const valArc = svgEl("path", { class: "mmth-valarc" });
    const cap = svgEl("circle", { class: "mmth-cap", cx: 30, cy: 30, r: 14 });
    const ptr = svgEl("line", { class: "mmth-ptr", x1: 30, y1: 30, x2: 30, y2: 19 });
    const liveDot = svgEl("circle", { class: "mmth-live", r: 2.8, cx: 30, cy: 10 });
    svg.append(...knobParts(), track, ...modArcs, valArc, cap, ptr, liveDot);
    dial.appendChild(svg);
    const label = el("span", "mmth-knob-label");
    const value = el("span", "mmth-knob-value");
    wrap.append(dial, label, value);
    let slots = null;
    if (sp.mod) {
      slots = button("", "mmth-slots", "");
      for (let k = 0; k < MAX_MODS_PER_PARAM; k++) slots.appendChild(el("span", "mmth-slot"));
      wrap.appendChild(slots);
    }
    const rec = { id, wrap, dial, label, value, valArc, modArcs, ptr, liveDot, slots, group: opts.group || groupOf(id) };
    const list = knobs.get(id) || [];
    list.push(rec);
    knobs.set(id, list);
    bindKnob(rec);
    updateKnob(rec);
    return wrap;
  }

  /** Redraws every copy of a parameter's knob (some appear on two pages). */
  function updateId(id) {
    const list = knobs.get(id);
    if (list) for (const rec of list) updateKnob(rec);
    if (sheetId === id) refreshSheet();
  }

  function updateKnob(rec) {
    if (!rec) return;
    const p = patch();
    const sp = spec(rec.id);
    const n = clamp01(Number(p.params[rec.id]));
    const bip = sp.min < 0 && sp.max > 0;
    const origin = bip ? normFor(sp, 0) : 0;
    rec.valArc.setAttribute("d", arcPath(20, origin, n));
    // The pointer is a line printed on the knob's cap, from near its centre to its rim.
    const [qx, qy] = knobPoint(4.5, n);
    const [px, py] = knobPoint(13, n);
    rec.ptr.setAttribute("x1", qx.toFixed(2));
    rec.ptr.setAttribute("y1", qy.toFixed(2));
    rec.ptr.setAttribute("x2", px.toFixed(2));
    rec.ptr.setAttribute("y2", py.toFixed(2));
    const lbl = labelFor(rec.id);
    const txt = formatParam(rec.id, n, fmtCtx(rec.id));
    rec.label.textContent = lbl;
    rec.value.textContent = txt;
    const na = lbl === "n.a.";
    rec.wrap.classList.toggle("mmth-na", na);
    rec.dial.setAttribute("aria-label", `${rec.group} ${lbl}`.trim());
    rec.dial.setAttribute("aria-valuenow", String(Math.round(n * 100)));
    rec.dial.setAttribute("aria-valuetext", txt);
    if (na) rec.dial.setAttribute("aria-disabled", "true");
    else rec.dial.removeAttribute("aria-disabled");
    const mods = rec.slots ? modsFor(rec.id) : [];
    for (let k = 0; k < rec.modArcs.length; k++) {
      const m = mods[k];
      const arc = rec.modArcs[k];
      if (m) {
        arc.setAttribute("d", arcPath(28.2 - k * 2.9, n, n + m.amt));
        arc.style.stroke = srcColor(m.src);
      } else arc.setAttribute("d", "");
    }
    if (rec.slots) {
      const spans = rec.slots.children;
      for (let k = 0; k < spans.length; k++) {
        const m = mods[k];
        spans[k].textContent = m ? srcInfo(m.src).label : "";
        spans[k].classList.toggle("on", !!m);
        spans[k].style.borderColor = m ? srcColor(m.src) : "";
        spans[k].style.color = m ? srcColor(m.src) : "";
        spans[k].title = m ? `${srcInfo(m.src).name}: ${Math.round(m.amt * 100)}% (drag up/down, double-click to remove)` : "";
      }
      rec.slots.classList.toggle("mmth-empty", !mods.length);
      const desc = mods.length
        ? `Modulation of ${rec.group} ${lbl}: ${mods.map((m) => `${srcInfo(m.src).name} ${Math.round(m.amt * 100)}%`).join(", ")}`
        : `Add modulation to ${rec.group} ${lbl}`;
      rec.slots.setAttribute("aria-label", desc);
      rec.slots.title = mods.length ? desc : `${desc} — drag a source handle here, or press to choose`;
    }
    const lv = lastLive.get(rec.id);
    if (lv == null || !mods.length) rec.liveDot.style.display = "none";
    else {
      const [lx, ly] = knobPoint(20, lv);
      rec.liveDot.setAttribute("cx", lx.toFixed(2));
      rec.liveDot.setAttribute("cy", ly.toFixed(2));
      rec.liveDot.style.display = "";
    }
  }

  /**
   * Touch: a vertical swipe scrolls the page and changes nothing. A sideways drag
   * (past an 8px axis lock) turns the knob and reverts if the browser cancels it.
   * A clean tap (no movement, short press) either commits a pending assign or opens
   * the knob sheet.
   */
  /**
   * After a tap opens the sheet, the browser sends mouse events for the same touch to whatever
   * is now under the finger (a range input would jump to that spot). Swallow them briefly.
   */
  function swallowGhostTap() {
    const types = ["mousedown", "mouseup", "click"];
    // Only the browser's own events for this touch (trusted, and not from a script).
    const stop = (ev) => {
      if (!ev.isTrusted) return;
      if (ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents === false) return;
      ev.stopPropagation();
      ev.preventDefault();
    };
    for (const t of types) document.addEventListener(t, stop, true);
    setTimeout(() => {
      for (const t of types) document.removeEventListener(t, stop, true);
    }, 500);
  }

  function touchKnob(rec, e) {
    const { id, dial } = rec;
    const sx = e.clientX;
    const sy = e.clientY;
    const t0 = Date.now();
    const startVal = clamp01(Number(patch().params[id]));
    const label = () => `${rec.group} ${labelFor(id)}`;
    let mode = "press"; // press → turn | scroll
    let anchorX = sx;
    try {
      dial.focus({ preventScroll: true });
    } catch (_) {}
    const move = (ev) => {
      if (mode === "scroll") return;
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (mode === "press") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          mode = "scroll";
          return;
        }
        mode = "turn";
        anchorX = ev.clientX;
        begin(label());
        try {
          dial.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      // 200px of sideways drag sweeps the whole range.
      setParam(id, startVal + (ev.clientX - anchorX) / 200);
    };
    const finish = (ev) => {
      dial.removeEventListener("pointermove", move);
      dial.removeEventListener("pointerup", finish);
      dial.removeEventListener("pointercancel", finish);
      if (ev.type === "pointercancel") {
        if (mode === "turn") setParam(id, startVal);
        return;
      }
      if (mode === "turn") {
        commit(`${label()}: ${formatParam(id, patch().params[id], fmtCtx(id))}`);
        return;
      }
      if (mode === "press") {
        if (armed) {
          if (Date.now() - t0 < 600) {
            const src = armed;
            disarm();
            addMod(src, id);
          }
          return;
        }
        // The sheet appears under the finger; the browser's click for this same tap must not reach it.
        swallowGhostTap();
        openKnobSheet(id);
      }
    };
    dial.addEventListener("pointermove", move);
    dial.addEventListener("pointerup", finish);
    dial.addEventListener("pointercancel", finish);
  }

  function bindKnob(rec) {
    const { id, dial } = rec;
    dial.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (e.pointerType !== "mouse") {
        touchKnob(rec, e);
        return;
      }
      e.preventDefault();
      if (armed) {
        const src = armed;
        disarm();
        addMod(src, id);
        return;
      }
      try {
        dial.focus({ preventScroll: true });
      } catch (_) {
        dial.focus();
      }
      begin(`${rec.group} ${labelFor(id)}`);
      try {
        dial.setPointerCapture(e.pointerId);
      } catch (_) {}
      const startY = e.clientY;
      const startX = e.clientX;
      const start = clamp01(Number(patch().params[id]));
      const move = (ev) => {
        const fine = ev.shiftKey ? 5 : 1;
        const delta = (startY - ev.clientY + (ev.clientX - startX)) / (180 * fine);
        setParam(id, start + delta);
      };
      const up = () => {
        dial.removeEventListener("pointermove", move);
        dial.removeEventListener("pointerup", up);
        dial.removeEventListener("pointercancel", up);
        commit(`${rec.group} ${labelFor(id)}: ${formatParam(id, patch().params[id], fmtCtx(id))}`);
      };
      dial.addEventListener("pointermove", move);
      dial.addEventListener("pointerup", up);
      dial.addEventListener("pointercancel", up);
    });
    dial.addEventListener("dblclick", () => {
      begin(`Reset ${labelFor(id)}`);
      setParam(id, spec(id).def);
      commit(`${rec.group} ${labelFor(id)} reset`);
    });
    dial.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        openKnobSheet(id);
        return;
      }
      const n = clamp01(Number(patch().params[id]));
      let next = null;
      const step = e.shiftKey ? 0.002 : 0.01;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = n + step;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = n - step;
      else if (e.key === "PageUp") next = n + 0.1;
      else if (e.key === "PageDown") next = n - 0.1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = 1;
      else if (e.key === "Delete" || e.key === "Backspace") next = spec(id).def;
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      begin(`${rec.group} ${labelFor(id)}`);
      setParam(id, next);
      commit(`${rec.group} ${labelFor(id)}: ${formatParam(id, patch().params[id], fmtCtx(id))}`);
    });
    if (rec.slots) {
      let dragged = false;
      Array.from(rec.slots.children).forEach((slotEl, k) => {
        slotEl.addEventListener("pointerdown", (e) => {
          const m = modsFor(id)[k];
          if (!m || e.pointerType !== "mouse" || e.button !== 0) return;
          e.preventDefault();
          dragged = false;
          const startY = e.clientY;
          const start = m.amt;
          let began = false;
          try {
            slotEl.setPointerCapture(e.pointerId);
          } catch (_) {}
          const move = (ev) => {
            const dy = startY - ev.clientY;
            if (!began && Math.abs(dy) < 3) return;
            if (!began) {
              began = true;
              dragged = true;
              begin("Modulation depth");
            }
            setModAmt(m.src, id, start + dy / (ev.shiftKey ? 600 : 140));
            status(`${srcInfo(m.src).name} → ${labelFor(id)}: ${Math.round(patch().mods.find((x) => x.src === m.src && x.dst === id).amt * 100)}%`, "value");
          };
          const up = () => {
            slotEl.removeEventListener("pointermove", move);
            slotEl.removeEventListener("pointerup", up);
            slotEl.removeEventListener("pointercancel", up);
            if (began) commit(`${srcInfo(m.src).name} → ${labelFor(id)} depth set`);
          };
          slotEl.addEventListener("pointermove", move);
          slotEl.addEventListener("pointerup", up);
          slotEl.addEventListener("pointercancel", up);
        });
        slotEl.addEventListener("dblclick", (e) => {
          const m = modsFor(id)[k];
          if (!m) return;
          e.preventDefault();
          dragged = true;
          removeMod(m.src, id);
        });
      });
      rec.slots.addEventListener("click", () => {
        if (dragged) {
          dragged = false;
          return;
        }
        if (armed) {
          const src = armed;
          disarm();
          addMod(src, id);
          return;
        }
        openModPopover(id, rec.slots);
      });
    }
  }

  /* --------------------------------------------- menus and toggles */
  function select(id, opts = {}) {
    const e = enumSpec(id);
    const s = el("select", `mmth-select${opts.cls ? ` ${opts.cls}` : ""}`);
    const label = opts.label || e.label;
    s.setAttribute("aria-label", opts.aria || label);
    s.title = opts.aria || label;
    const names = opts.names || e.options;
    names.forEach((name, i) => {
      const o = el("option", null, name);
      o.value = String(i);
      s.appendChild(o);
    });
    s.addEventListener("change", () => {
      begin(label);
      setEnum(id, Number(s.value));
      commit(`${opts.aria || label}: ${names[Number(s.value)]}`);
    });
    const list = enumCtl.get(id) || [];
    list.push(s);
    enumCtl.set(id, list);
    s.value = String(patch().enums[id] | 0);
    if (opts.caption) {
      const wrap = el("label", "mmth-field");
      wrap.append(el("span", "mmth-field-label", opts.caption), s);
      return wrap;
    }
    return s;
  }

  function power(id, name) {
    const b = button("", "mmth-power", `${name} on/off`);
    b.innerHTML = '<span class="mmth-led" aria-hidden="true"></span>';
    b.addEventListener("click", () => {
      const on = !patch().enums[id];
      begin(`${name} ${on ? "on" : "off"}`);
      setEnum(id, on ? 1 : 0);
      commit(`${name} ${on ? "on" : "off"}`);
    });
    const list = powerCtl.get(id) || [];
    list.push(b);
    powerCtl.set(id, list);
    return b;
  }

  function toggleEnum(id, text, aria) {
    const b = button(text, "mmth-btn mmth-toggle", aria);
    b.addEventListener("click", () => {
      const on = !patch().enums[id];
      begin(aria);
      setEnum(id, on ? 1 : 0);
      commit(`${aria}: ${on ? "on" : "off"}`);
    });
    const list = powerCtl.get(id) || [];
    list.push(b);
    powerCtl.set(id, list);
    return b;
  }

  function section(titleText, opts = {}) {
    const sec = el("section", `mmth-sec${opts.cls ? ` ${opts.cls}` : ""}`);
    const head = el("div", "mmth-sec-head");
    if (opts.powerId) {
      head.appendChild(power(opts.powerId, titleText));
      sec.dataset.power = opts.powerId;
    }
    const h = el("h3", "mmth-sec-title", titleText);
    head.appendChild(h);
    sec.dataset.kind = opts.kind || sectionKind(titleText);
    if (opts.extra) for (const x of opts.extra) head.appendChild(x);
    const content = el("div", "mmth-sec-body");
    sec.append(head, content);
    sec.setAttribute("aria-label", titleText);
    return { sec, head, content };
  }

  /** Which colour bar a section wears in the analog look. */
  function sectionKind(t) {
    const s = String(t).toUpperCase();
    if (/^MOD/.test(s)) return "mod";
    if (/^OSC|NOISE|FEEDBACK/.test(s)) return "osc";
    if (/FILTER/.test(s)) return "filter";
    if (/^FX|INSERT/.test(s)) return "fx";
    if (/^EQ/.test(s)) return "eq";
    if (/ENV|LFO|PERF|STEP/.test(s)) return "env";
    if (/MACRO/.test(s)) return "macro";
    return "amp";
  }

  function knobRow(ids, opts) {
    const row = el("div", "mmth-knobs");
    for (const id of ids) row.appendChild(knob(id, opts));
    return row;
  }

  /* ------------------------------------------------------ sources */
  function sourceHandle(srcId, text) {
    const info = srcInfo(srcId);
    const b = button("", "mmth-src", `${info.name}: drag onto a knob, or press and then press a knob`);
    b.appendChild(iconText("plus", text || info.label));
    b.dataset.src = srcId;
    b.style.setProperty("--src", srcColor(srcId));
    let moved = false;
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      // Touch: a source is tapped, not dragged, so a swipe that starts here scrolls.
      if (e.pointerType !== "mouse") return;
      moved = false;
      const sx = e.clientX;
      const sy = e.clientY;
      try {
        b.setPointerCapture(e.pointerId);
      } catch (_) {}
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!moved) {
          moved = true;
          dragGhost = el("div", "mmth-ghost");
          dragGhost.appendChild(iconText("plus", info.name));
          dragGhost.style.setProperty("--src", srcColor(srcId));
          document.body.appendChild(dragGhost);
          root.classList.add("mmth-dragging");
        }
        dragGhost.style.left = `${ev.clientX + 12}px`;
        dragGhost.style.top = `${ev.clientY + 12}px`;
        // Near the top or bottom edge the panel scrolls, so far-away knobs stay reachable.
        const br = body.getBoundingClientRect();
        if (ev.clientY < br.top + 48) body.scrollTop -= 14;
        else if (ev.clientY > br.bottom - 48) body.scrollTop += 14;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = hit && hit.closest ? hit.closest(".mmth-knob[data-mod]") : null;
        if (target !== dropTarget) {
          if (dropTarget) dropTarget.classList.remove("mmth-drop");
          dropTarget = target;
          if (dropTarget) dropTarget.classList.add("mmth-drop");
        }
      };
      const up = () => {
        b.removeEventListener("pointermove", move);
        b.removeEventListener("pointerup", up);
        b.removeEventListener("pointercancel", up);
        root.classList.remove("mmth-dragging");
        if (dragGhost) {
          dragGhost.remove();
          dragGhost = null;
        }
        if (dropTarget) {
          const dst = dropTarget.dataset.param;
          dropTarget.classList.remove("mmth-drop");
          dropTarget = null;
          addMod(srcId, dst);
        }
      };
      b.addEventListener("pointermove", move);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
    });
    b.addEventListener("click", () => {
      if (moved) {
        moved = false;
        return;
      }
      if (armed === srcId) disarm();
      else arm(srcId);
    });
    return b;
  }

  function arm(srcId) {
    armed = srcId;
    root.classList.add("mmth-arming");
    root.querySelectorAll(".mmth-src").forEach((h) => h.setAttribute("aria-pressed", String(h.dataset.src === srcId)));
    bannerText.textContent = `${touchHint({ touch: "Tap", mouse: "Click" })} a knob to modulate with ${srcInfo(srcId).name}`;
    banner.hidden = false;
  }
  function disarm() {
    armed = null;
    root.classList.remove("mmth-arming");
    banner.hidden = true;
    root.querySelectorAll(".mmth-src").forEach((h) => h.setAttribute("aria-pressed", "false"));
  }
  bannerCancel.addEventListener("click", () => {
    disarm();
    status("Modulation assign cancelled");
  });

  /* -------------------------------------------------- mod popover */
  function closePopover() {
    if (popover) {
      popover.remove();
      popover = null;
      if (popoverAnchor && document.contains(popoverAnchor)) {
        try {
          popoverAnchor.focus({ preventScroll: true });
        } catch (_) {}
      }
      popoverAnchor = null;
    }
  }

  function placePopover(pop, anchor) {
    root.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.left - rr.left + r.width / 2 - w / 2;
    let top = r.bottom - rr.top + 6;
    left = Math.max(8, Math.min(rr.width - w - 8, left));
    if (top + h > rr.height - 8) top = Math.max(8, r.top - rr.top - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  /** The modulation list for one parameter: depth sliders, remove, and add. Shared by the popover and the knob sheet. */
  function modEditor(id, onChange) {
    const wrap = el("div", "mmth-modedit");
    const list = el("div", "mmth-pop-list");
    const mods = modsFor(id);
    if (!mods.length) {
      list.appendChild(
        el(
          "p",
          "mmth-pop-empty",
          touchHint({
            touch: "No modulation yet. Pick a source below.",
            mouse: "No modulation yet. Add a source below, or drag a source handle (+) onto the knob.",
          })
        )
      );
    }
    for (const m of mods) {
      const row = el("div", "mmth-pop-row");
      const chip = el("span", "mmth-chip", srcInfo(m.src).name);
      chip.style.setProperty("--src", srcColor(m.src));
      const range = el("input", "mmth-range");
      range.type = "range";
      range.min = "-100";
      range.max = "100";
      range.step = "1";
      range.value = String(Math.round(m.amt * 100));
      range.setAttribute("aria-label", `${srcInfo(m.src).name} depth`);
      const val = el("span", "mmth-pop-val", `${Math.round(m.amt * 100)}%`);
      range.addEventListener("pointerdown", () => begin("Modulation depth"));
      range.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (/^(Arrow|Page|Home|End)/.test(e.key)) begin("Modulation depth");
      });
      range.addEventListener("input", () => {
        setModAmt(m.src, id, Number(range.value) / 100);
        val.textContent = `${range.value}%`;
      });
      range.addEventListener("change", () => commit(`${srcInfo(m.src).name} → ${labelFor(id)}: ${range.value}%`));
      const del = button("", "mmth-btn mmth-icon-btn", `Remove ${srcInfo(m.src).name}`);
      del.innerHTML = iconSvg("trash-2");
      del.addEventListener("click", () => {
        removeMod(m.src, id);
        onChange();
      });
      row.append(chip, range, val, del);
      list.appendChild(row);
    }
    wrap.appendChild(list);
    if (mods.length < MAX_MODS_PER_PARAM) {
      const add = el("div", "mmth-pop-add");
      const sel = el("select", "mmth-select");
      sel.setAttribute("aria-label", "Source to add");
      for (const s of MOD_SOURCES) {
        if (mods.some((m) => m.src === s.id)) continue;
        const o = el("option", null, s.name);
        o.value = s.id;
        sel.appendChild(o);
      }
      sel.addEventListener("keydown", (e) => e.stopPropagation());
      const go = button("Add", "mmth-btn", "Add this source");
      go.dataset.act = "add";
      go.addEventListener("click", () => {
        addMod(sel.value, id);
        onChange();
      });
      add.append(sel, go);
      wrap.appendChild(add);
    }
    return wrap;
  }

  function openModPopover(id, anchor) {
    closePopover();
    popoverAnchor = anchor;
    const pop = el("div", "mmth-popover");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", `Modulation · ${groupOf(id)} ${labelFor(id)}`);
    const head = el("div", "mmth-pop-head");
    head.appendChild(el("strong", null, `${groupOf(id)} ${labelFor(id)}`));
    const x = button("", "mmth-btn mmth-icon-btn", "Close");
    x.innerHTML = iconSvg("x");
    x.addEventListener("click", closePopover);
    head.appendChild(x);
    pop.appendChild(head);
    pop.appendChild(modEditor(id, () => openModPopover(id, anchor)));
    popover = pop;
    placePopover(pop, anchor);
    const first = pop.querySelector("input, select, button");
    if (first) first.focus({ preventScroll: true });
  }

  /* -------------------------------------------------- knob sheet */
  const sheetName = (id) => `${groupOf(id)} ${labelFor(id)}`;
  function openKnobSheet(id) {
    if (!binding || !spec(id) || !inst()) return;
    closePopover();
    sheetId = id;
    sheetEditing = false;
    sheetSig = "\u0000";
    scrim.hidden = false;
    sheetEl.hidden = false;
    refreshSheet();
    try {
      sSlider.focus({ preventScroll: true });
    } catch (_) {}
  }
  function closeKnobSheet() {
    if (sheetId == null) return;
    const id = sheetId;
    if (sheetEditing) {
      sheetEditing = false;
      commit(`${sheetName(id)}: ${formatParam(id, patch().params[id], fmtCtx(id))}`);
    }
    sheetId = null;
    sheetEl.hidden = true;
    scrim.hidden = true;
    const rec = (knobs.get(id) || [])[0];
    if (rec) {
      try {
        rec.dial.focus({ preventScroll: true });
      } catch (_) {}
    }
  }
  function refreshSheet() {
    if (sheetId == null) return;
    const id = sheetId;
    const n = clamp01(Number(patch().params[id]));
    const txt = formatParam(id, n, fmtCtx(id));
    sheetTitle.textContent = sheetName(id);
    sheetValue.textContent = txt;
    if (!sheetEditing) sSlider.value = String(Math.round(n * 1000));
    sSlider.dataset.default = String(Math.round(clamp01(spec(id).def) * 1000));
    sSlider.setAttribute("aria-label", sheetName(id));
    sSlider.setAttribute("aria-valuetext", txt);
    const sig = modsFor(id).map((m) => m.src).join(",");
    if (sig !== sheetSig) {
      sheetSig = sig;
      sMods.replaceChildren(modEditor(id, () => refreshSheet()));
    }
  }
  function sheetBegin() {
    if (sheetId == null) return;
    if (!sheetEditing) {
      begin(sheetName(sheetId));
      sheetEditing = true;
    }
  }
  function sheetCommit() {
    if (sheetId == null || !sheetEditing) return;
    sheetEditing = false;
    commit(`${sheetName(sheetId)}: ${formatParam(sheetId, patch().params[sheetId], fmtCtx(sheetId))}`);
  }
  sSlider.addEventListener("pointerdown", () => sheetBegin());
  sSlider.addEventListener("input", () => {
    if (sheetId == null) return;
    sheetBegin();
    setParam(sheetId, Number(sSlider.value) / 1000);
  });
  sSlider.addEventListener("change", () => sheetCommit());
  sSlider.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closeKnobSheet();
  });
  const nudge = (d) => {
    if (sheetId == null) return;
    begin(sheetName(sheetId));
    setParam(sheetId, clamp01(Number(patch().params[sheetId]) + d));
    commit(`${sheetName(sheetId)}: ${formatParam(sheetId, patch().params[sheetId], fmtCtx(sheetId))}`);
  };
  sMinus.addEventListener("click", () => nudge(-0.01));
  sPlus.addEventListener("click", () => nudge(0.01));
  sReset.addEventListener("click", () => {
    if (sheetId == null) return;
    begin(`Reset ${labelFor(sheetId)}`);
    setParam(sheetId, spec(sheetId).def);
    commit(`${sheetName(sheetId)} reset to ${formatParam(sheetId, spec(sheetId).def, fmtCtx(sheetId))}`);
  });
  const setTyped = () => {
    if (sheetId == null) return;
    const v = parseFloat(String(sInput.value).replace(",", "."));
    if (!Number.isFinite(v)) {
      status("Type a number from 0 to 100.", "error");
      return;
    }
    begin(sheetName(sheetId));
    setParam(sheetId, clamp01(v / 100));
    commit(`${sheetName(sheetId)}: ${formatParam(sheetId, patch().params[sheetId], fmtCtx(sheetId))}`);
    sInput.value = "";
  };
  sSet.addEventListener("click", setTyped);
  sInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") setTyped();
  });
  sheetClose.addEventListener("click", () => closeKnobSheet());

  /* -------------------------------------------------- osc preview */
  const oscCanvases = [null, null, null, null];
  function drawOscPreview(i) {
    const cv = oscCanvases[i];
    if (!cv) return;
    const p = patch();
    const w = cv.width;
    const h = cv.height;
    const g = cv.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(root);
    g.strokeStyle = cs.getPropertyValue("--mmth-wave").trim() || "#7cc4ff";
    g.lineWidth = 2;
    let pts;
    try {
      pts = framePreview(buildWavetable(p.enums[`osc${i}.table`] | 0), p.params[`osc${i}.pos`], 64);
    } catch (_) {
      return;
    }
    g.beginPath();
    for (let k = 0; k < pts.length; k++) {
      const x = (k / (pts.length - 1)) * (w - 4) + 2;
      const y = h / 2 - pts[k] * (h / 2 - 4);
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  }

  /* ------------------------------------------------------- layout */
  function buildSynth() {
    synthView.replaceChildren();
    dock.replaceChildren();
    knobs.clear();
    enumCtl.clear();
    powerCtl.clear();
    dynamic.length = 0;
    pagedNodes.length = 0;
    const tag = (node, pg) => {
      node.dataset.page = pg;
      pagedNodes.push(node);
      return node;
    };

    const top = el("div", "mmth-top");
    const colOsc = el("div", "mmth-col mmth-col-osc");
    const colFlt = el("div", "mmth-col mmth-col-flt");
    const colOut = el("div", "mmth-col mmth-col-out");

    for (let i = 1; i <= 3; i++) {
      const cv = el("canvas", "mmth-wave");
      cv.width = 72;
      cv.height = 32;
      cv.setAttribute("aria-hidden", "true");
      oscCanvases[i] = cv;
      const tableSel = select(`osc${i}.table`, { aria: `OSC ${i} wavetable`, cls: "mmth-select-table" });
      const modeSel = select(`osc${i}.mode`, { aria: `OSC ${i} mode` });
      const s = section(`OSC ${i}`, { powerId: `osc${i}.on`, cls: "mmth-osc", extra: [tableSel, modeSel, cv] });
      s.content.appendChild(knobRow([`osc${i}.pitch`, `osc${i}.pos`, `osc${i}.int`, `osc${i}.amp`, `osc${i}.route`]));
      colOsc.appendChild(tag(s.sec, `osc${i}`));
    }
    {
      const s = section("MODULATION OSC", { powerId: "modosc.on", cls: "mmth-modosc" });
      const row = el("div", "mmth-osc-row");
      row.appendChild(knobRow(["modosc.pitch", "modosc.rm"]));
      const grid = el("div", "mmth-fields");
      grid.append(
        select("modosc.ring", { caption: "Ring Mod", aria: "Ring mod target oscillator" }),
        select("modosc.phase", { caption: "Phase", aria: "Phase mod target oscillator" }),
        select("modosc.pos", { caption: "Position", aria: "Position mod target oscillator" }),
        select("modosc.ffm", { caption: "Filter FM", aria: "Filter FM target filter" })
      );
      row.appendChild(grid);
      s.content.appendChild(row);
      colOsc.appendChild(tag(s.sec, "osc3"));
    }

    for (let j = 1; j <= 2; j++) {
      const s = section(`FILTER ${j}`, { powerId: `filter${j}.on`, cls: "mmth-filter", extra: [select(`filter${j}.type`, { aria: `Filter ${j} type` })] });
      s.content.appendChild(knobRow([`filter${j}.cutoff`, `filter${j}.b`, `filter${j}.res`]));
      colFlt.appendChild(tag(s.sec, "filter"));
      if (j === 1) {
        const r = el("div", "mmth-routing-strip");
        r.setAttribute("aria-label", "Filter routing");
        r.appendChild(knob("filters.serpar", { small: true }));
        r.appendChild(el("p", "mmth-hint", "Serial feeds Filter 1 into Filter 2; parallel keeps them apart."));
        colFlt.appendChild(tag(r, "filter"));
      }
    }
    {
      const r = el("div", "mmth-routing-strip");
      r.appendChild(knob("filters.mix", { small: true }));
      r.appendChild(el("p", "mmth-hint", "Mix blends the two filter outputs."));
      colFlt.appendChild(tag(r, "filter"));
    }

    {
      const amp = section("AMP", { cls: "mmth-amp" });
      amp.content.appendChild(knobRow(["amp.mod", "amp.pan"]));
      const byp = section("BYPASS", { powerId: "byp.on", cls: "mmth-byp" });
      byp.content.appendChild(knobRow(["byp.mod"]));
      const master = section("MASTER", { cls: "mmth-master" });
      const meter = el("div", "mmth-meter");
      meter.setAttribute("aria-hidden", "true");
      meter.innerHTML = '<span class="mmth-meter-fill" data-ch="l"></span><span class="mmth-meter-fill" data-ch="r"></span>';
      master.content.append(knobRow(["master.vol"]), meter);
      const outRow = el("div", "mmth-out-row");
      outRow.append(tag(amp.sec, "fx"), tag(byp.sec, "fx"), tag(master.sec, "play"));
      colOut.appendChild(outRow);
      for (let m = 1; m <= 2; m++) {
        const s = section(`FX ${m}`, { powerId: `fx${m}.on`, cls: "mmth-fx", extra: [select(`fx${m}.type`, { aria: `FX ${m} type` })] });
        s.content.appendChild(knobRow([`fx${m}.a`, `fx${m}.b`, `fx${m}.c`]));
        const divs = el("div", "mmth-fields mmth-delay-divs");
        divs.dataset.fx = String(m);
        divs.append(
          select(`fx${m}.ldiv`, { caption: "Left", aria: `FX ${m} delay left` }),
          select(`fx${m}.rdiv`, { caption: "Right", aria: `FX ${m} delay right` })
        );
        s.content.appendChild(divs);
        colOut.appendChild(tag(s.sec, "fx"));
      }
      const eq = section("EQ", { powerId: "eq.on", cls: "mmth-eq" });
      eq.content.appendChild(knobRow(["eq.low", "eq.mid", "eq.midf", "eq.high"]));
      colOut.appendChild(tag(eq.sec, "fx"));
    }
    top.append(colOsc, colFlt, colOut);

    // Modulation area: source tabs with their drag handles, then the panel.
    const modArea = el("div", "mmth-modarea");
    const tabs = el("div", "mmth-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Modulation and settings pages");
    const tabDefs = [
      ["env1", "1 Env"],
      ["env2", "2 Env"],
      ["env3", "3 Env"],
      ["env4", "4 Env"],
      ["mod5", "5"],
      ["mod6", "6"],
      ["mod7", "7"],
      ["mod8", "8"],
      ["osc", "OSC"],
      ["ktr", "KTR"],
      ["voicing", "Voicing"],
      ["routing", "Routing"],
      ["global", "Global"],
    ];
    for (const [key, text] of tabDefs) {
      const cell = el("div", "mmth-tabcell");
      const t = button(text, "mmth-tab", null);
      t.setAttribute("role", "tab");
      t.dataset.tab = key;
      t.addEventListener("click", () => {
        tab = key;
        renderTab();
      });
      cell.appendChild(t);
      if (/^(env|mod)/.test(key)) cell.appendChild(sourceHandle(key, key.replace(/\D/g, "")));
      tabs.appendChild(cell);
    }
    const panel = el("div", "mmth-tabpanel");
    panel.setAttribute("role", "tabpanel");
    modArea.append(tabs, panel);

    const bottom = el("div", "mmth-bottom");
    {
      const s = section("NOISE", { powerId: "noise.on", cls: "mmth-noise", extra: [select("noise.type", { aria: "Noise type" })] });
      s.content.appendChild(knobRow(["noise.color", "noise.amp", "noise.route"]));
      bottom.appendChild(tag(s.sec, "osc2"));
      const f = section("FEEDBACK", { powerId: "fb.on", cls: "mmth-fb", extra: [select("fb.tap", { aria: "Feedback tap" })] });
      f.content.appendChild(knobRow(["fb.amp", "fb.route"]));
      bottom.appendChild(tag(f.sec, "osc2"));
      for (let k = 1; k <= 2; k++) {
        const ins = section(`INSERT ${k}`, {
          powerId: `ins${k}.on`,
          cls: "mmth-ins",
          extra: [select(`ins${k}.type`, { aria: `Insert ${k} type` }), select(`ins${k}.pos`, { aria: `Insert ${k} position` })],
        });
        ins.content.appendChild(knobRow([`ins${k}.a`, `ins${k}.b`]));
        bottom.appendChild(tag(ins.sec, "filter"));
      }
    }
    const macros = section("MACRO CONTROL", { cls: "mmth-macros" });
    const mgrid = el("div", "mmth-macro-grid");
    for (let q = 1; q <= 8; q++) {
      const cell = el("div", "mmth-macro");
      cell.append(sourceHandle(`macro${q}`, String(q)), knob(`macro${q}`, { group: `Macro ${q}` }));
      mgrid.appendChild(cell);
    }
    const perf = el("div", "mmth-perf-src");
    perf.append(el("span", "mmth-field-label", "Sources"), sourceHandle("ktr", "KTr"), sourceHandle("vel", "Vel"), sourceHandle("at", "AT"), sourceHandle("trr", "TrR"));
    macros.content.append(mgrid, perf);

    tag(modArea, "mod");
    tag(macros.sec, "play");
    dock.appendChild(buildKeyboard());
    synthView.append(top, modArea, bottom, macros.sec);
    renderTab();
    refreshStatic();
  }

  /* ------------------------------------------------------ tab pages */
  let envSvg = null;
  let slotSvg = null;
  let slotIndexShown = -1;
  let stepRefs = null;

  function renderTab() {
    const panel = synthView.querySelector(".mmth-tabpanel");
    if (!panel) return;
    for (const [id, list] of knobs) knobs.set(id, list.filter((r) => !panel.contains(r.wrap)));
    for (const [id, list] of enumCtl) enumCtl.set(id, list.filter((s) => !panel.contains(s)));
    for (const [id, list] of powerCtl) powerCtl.set(id, list.filter((s) => !panel.contains(s)));
    panel.replaceChildren();
    envSvg = null;
    slotSvg = null;
    slotIndexShown = -1;
    stepRefs = null;
    synthView.querySelectorAll(".mmth-tab").forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    const own = (wrapEl) => wrapEl;
    let m;
    if ((m = /^env([1-4])$/.exec(tab))) {
      const e = Number(m[1]);
      const head = el("div", "mmth-tab-head");
      head.append(
        el("h3", "mmth-sec-title", e === 4 ? "Envelope 4 · Amplitude" : `Envelope ${e}`),
        select(`env${e}.mode`, { caption: "Mode", aria: `Envelope ${e} mode` })
      );
      envSvg = svgEl("svg", { class: "mmth-envgraph", viewBox: "0 0 320 90", preserveAspectRatio: "none", "aria-hidden": "true" });
      panel.append(
        head,
        own(knobRow([`env${e}.delay`, `env${e}.attack`, `env${e}.decay`, `env${e}.sustain`, `env${e}.release`, `env${e}.curve`, `env${e}.vel`, `env${e}.ktr`])),
        envSvg
      );
      if (e === 4) panel.appendChild(el("p", "mmth-hint", "Envelope 4 always shapes the volume of every note. Envelopes 1-3 are free for modulation: drag the + handle next to their tab onto any knob."));
      drawEnvGraph();
    } else if ((m = /^mod([5-8])$/.exec(tab))) {
      renderSlotPage(Number(m[1]), panel, own);
    } else if (tab === "osc") {
      const grid = el("div", "mmth-page-grid");
      for (let i = 1; i <= 3; i++) {
        const s = section(`OSC ${i}`, { cls: "mmth-sub" });
        s.content.append(own(knobRow([`osc${i}.fine`, `osc${i}.phase`, `osc${i}.ktr`])), select(`osc${i}.restart`, { caption: "Phase", aria: `OSC ${i} phase restart` }));
        grid.appendChild(s.sec);
      }
      panel.appendChild(grid);
      panel.appendChild(el("p", "mmth-hint", "Restart starts each note at the Start Phase; Free keeps running for an analogue feel. Key Track 0% holds a fixed pitch."));
    } else if (tab === "ktr") {
      const grid = el("div", "mmth-page-grid");
      for (let j = 1; j <= 2; j++) {
        const s = section(`FILTER ${j} KEY TRACK`, { cls: "mmth-sub" });
        s.content.appendChild(own(knobRow([`filter${j}.ktr`])));
        grid.appendChild(s.sec);
      }
      panel.appendChild(grid);
      panel.appendChild(el("p", "mmth-hint", "At 100% the cutoff follows the keyboard exactly (centred on C4) — useful for the comb filter, which then plays in tune."));
    } else if (tab === "voicing") {
      const grid = el("div", "mmth-page-grid");
      const s1 = section("VOICES", { cls: "mmth-sub" });
      const f = el("div", "mmth-fields");
      f.append(
        select("voice.poly", { caption: "Voices", aria: "Polyphony" }),
        select("voice.mode", { caption: "Mode", aria: "Voice mode" }),
        select("voice.unison", { caption: "Unison", aria: "Unison voices" }),
        select("voice.glidemode", { caption: "Glide", aria: "Glide mode" })
      );
      s1.content.appendChild(f);
      const s2 = section("UNISON & GLIDE", { cls: "mmth-sub" });
      s2.content.appendChild(own(knobRow(["voice.detune", "voice.spread", "voice.posspread", "voice.glide"])));
      grid.append(s1.sec, s2.sec);
      panel.appendChild(grid);
    } else if (tab === "routing") {
      const grid = el("div", "mmth-page-grid");
      const s1 = section("OSC → FILTER", { cls: "mmth-sub" });
      s1.content.appendChild(own(knobRow(["osc1.route", "osc2.route", "osc3.route", "noise.route", "fb.route"], { small: true })));
      const s2 = section("FILTERS & INSERTS", { cls: "mmth-sub" });
      const f = el("div", "mmth-fields");
      f.append(
        select("ins1.pos", { caption: "Insert 1", aria: "Insert 1 position" }),
        select("ins2.pos", { caption: "Insert 2", aria: "Insert 2 position" }),
        select("fb.tap", { caption: "Feedback tap", aria: "Feedback tap" })
      );
      s2.content.append(own(knobRow(["filters.serpar", "filters.mix"], { small: true })), f);
      grid.append(s1.sec, s2.sec);
      panel.appendChild(grid);
      panel.appendChild(el("p", "mmth-hint", "Signal: OSC 1–3, noise and feedback → Filter 1 / Filter 2 (Ser/Par) → Mix → inserts → Amp → Bypass split → FX 1 → FX 2 → EQ → Master."));
    } else if (tab === "global") {
      const grid = el("div", "mmth-page-grid");
      const s1 = section("ENGINE", { cls: "mmth-sub" });
      const f = el("div", "mmth-fields");
      f.append(select("global.quality", { caption: "Quality", aria: "Engine quality" }), select("global.bpmsrc", { caption: "Tempo", aria: "Tempo source" }));
      s1.content.append(f, own(knobRow(["global.tune", "global.bpm"])));
      if (isTouchUI()) {
        s1.content.appendChild(
          el("p", "mmth-hint", "On touch screens, live playing uses the High engine with up to 12 voices to save battery. Renders always use this patch's own settings.")
        );
      }
      const s2 = section("CHANNEL", { cls: "mmth-sub" });
      const rootRow = el("div", "mmth-root-row");
      const rDown = button("", "mmth-btn mmth-icon-btn", "Root note down");
      rDown.innerHTML = iconSvg("minus");
      const rText = el("span", "mmth-root-text");
      const rUp = button("", "mmth-btn mmth-icon-btn", "Root note up");
      rUp.innerHTML = iconSvg("plus");
      const setRootText = () => {
        const i = inst();
        rText.textContent = `Root ${noteName(i ? i.root : 72)}`;
      };
      const bump = (d) => {
        const i = inst();
        if (!i || !binding.setRoot) return;
        binding.setRoot(Math.max(24, Math.min(96, (i.root || 72) + d)));
        setRootText();
      };
      rDown.addEventListener("click", () => bump(-1));
      rUp.addEventListener("click", () => bump(1));
      rootRow.append(rDown, rText, rUp);
      setRootText();
      dynamic.push(setRootText);
      s2.content.append(
        rootRow,
        el("p", "mmth-hint", "The root note is what the Step Rack plays and where the Piano Roll's C5 row lands (C5 = play as written).")
      );
      const s3 = section("PATCH INFO", { cls: "mmth-sub mmth-info" });
      const nameIn = el("input", "mmth-input");
      nameIn.type = "text";
      nameIn.maxLength = 48;
      nameIn.setAttribute("aria-label", "Patch name");
      nameIn.value = patch().name;
      nameIn.addEventListener("change", () => {
        begin("Rename patch");
        patch().name = nameIn.value.trim().slice(0, 48) || "Untitled";
        refreshStatic();
        commit(`Patch renamed to "${patch().name}"`);
      });
      const catSel = el("select", "mmth-select");
      catSel.setAttribute("aria-label", "Patch category");
      for (const c of MAMMOTH_CATEGORIES) {
        const o = el("option", null, c);
        o.value = c;
        catSel.appendChild(o);
      }
      catSel.value = patch().category;
      catSel.addEventListener("change", () => {
        begin("Patch category");
        patch().category = catSel.value;
        commit(`Category: ${catSel.value}`);
      });
      const notes = el("textarea", "mmth-input mmth-notes");
      notes.maxLength = 400;
      notes.rows = 2;
      notes.setAttribute("aria-label", "Patch notes");
      notes.value = patch().notes || "";
      notes.addEventListener("change", () => {
        begin("Patch notes");
        patch().notes = notes.value.slice(0, 400);
        commit("Patch notes saved");
      });
      const macroNames = el("div", "mmth-macro-names");
      for (let q = 0; q < 8; q++) {
        const inp = el("input", "mmth-input");
        inp.type = "text";
        inp.maxLength = 14;
        inp.value = patch().macroNames[q];
        inp.setAttribute("aria-label", `Macro ${q + 1} name`);
        inp.addEventListener("change", () => {
          begin("Macro name");
          patch().macroNames[q] = inp.value.trim().slice(0, 14) || `Macro ${q + 1}`;
          updateId(`macro${q + 1}`);
          commit(`Macro ${q + 1} renamed`);
        });
        macroNames.appendChild(inp);
      }
      s3.content.append(
        fieldWrap("Name", nameIn),
        fieldWrap("Category", catSel),
        fieldWrap("Notes", notes),
        el("span", "mmth-field-label", "Macro names"),
        macroNames
      );
      grid.append(s1.sec, s2.sec, s3.sec);
      panel.appendChild(grid);
    }
    for (const [id, list] of enumCtl) for (const s of list) s.value = String(patch().enums[id] | 0);
    refreshPowers();
  }

  function fieldWrap(text, control) {
    const w = el("label", "mmth-field");
    w.append(el("span", "mmth-field-label", text), control);
    return w;
  }

  function renderSlotPage(slot, panel, own) {
    const p = patch();
    const type = p.enums[`mod${slot}.type`] | 0;
    slotIndexShown = slot;
    const head = el("div", "mmth-tab-head");
    head.append(
      el("h3", "mmth-sec-title", `Slot ${slot}`),
      select(`mod${slot}.type`, { caption: "Type", aria: `Slot ${slot} type` }),
      toggleEnum(`mod${slot}.sync`, "Sync", `Slot ${slot} tempo sync`),
      select(`mod${slot}.restart`, { caption: "Restart", aria: `Slot ${slot} restart` }),
      select(`mod${slot}.polarity`, { caption: "Polarity", aria: `Slot ${slot} polarity` })
    );
    panel.appendChild(head);
    const body2 = el("div", "mmth-slot-body");
    if (type === 0) {
      const f = el("div", "mmth-fields");
      f.append(select(`mod${slot}.shapeA`, { caption: "Curve A", aria: `Slot ${slot} curve A` }), select(`mod${slot}.shapeB`, { caption: "Curve B", aria: `Slot ${slot} curve B` }));
      body2.append(own(knobRow([`mod${slot}.rate`, `mod${slot}.amp`, `mod${slot}.xfade`, `mod${slot}.phase`, `mod${slot}.delay`])), f);
      slotSvg = svgEl("svg", { class: "mmth-envgraph", viewBox: "0 0 320 90", preserveAspectRatio: "none", "aria-hidden": "true" });
      body2.appendChild(slotSvg);
    } else {
      const ids = [`mod${slot}.rate`, `mod${slot}.amp`, `mod${slot}.phase`, `mod${slot}.delay`];
      if (type === 2) ids.splice(2, 0, `mod${slot}.glide`);
      body2.append(own(knobRow(ids)), select(`mod${slot}.len`, { caption: "Steps", aria: `Slot ${slot} steps` }), buildStepEditor(slot, type === 1));
    }
    panel.appendChild(body2);
    panel.appendChild(
      el(
        "p",
        "mmth-hint",
        type === 0
          ? "LFO: two curves with a crossfade. Sync locks the rate to the tempo."
          : type === 1
            ? "Performer: each step plays a curve at its level — drag the bars, press a curve name to change it."
            : "Stepper: one level per step; Glide smooths between them. Drag across the bars to draw."
      )
    );
    drawSlotGraph();
  }

  function buildStepEditor(slot, withShapes) {
    const wrap = el("div", "mmth-steps");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", `Slot ${slot} steps`);
    const bars = el("div", "mmth-step-bars");
    const shapes = withShapes ? el("div", "mmth-step-shapes") : null;
    const seq = patch().seq[`mod${slot}`];
    const len = (patch().enums[`mod${slot}.len`] | 0) + 1;
    const barEls = [];
    for (let i = 0; i < 16; i++) {
      const b = el("div", `mmth-step${i >= len ? " mmth-step-off" : ""}`);
      b.tabIndex = 0;
      b.setAttribute("role", "slider");
      b.setAttribute("aria-label", `Step ${i + 1}`);
      b.setAttribute("aria-valuemin", "0");
      b.setAttribute("aria-valuemax", "100");
      b.appendChild(el("span", "mmth-step-fill"));
      b.addEventListener("keydown", (e) => {
        let d = 0;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") d = 0.05;
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") d = -0.05;
        else return;
        e.preventDefault();
        e.stopPropagation();
        begin("Step level");
        seq.steps[i] = clamp01(seq.steps[i] + d);
        sendSeq(slot);
        paintSteps();
        commit(`Step ${i + 1}: ${Math.round(seq.steps[i] * 100)}%`);
      });
      bars.appendChild(b);
      barEls.push(b);
      if (shapes) {
        const sb = button("", "mmth-step-shape", `Step ${i + 1} curve`);
        sb.addEventListener("click", (e) => {
          begin("Step curve");
          const dir = e.shiftKey ? -1 : 1;
          seq.shapes[i] = (seq.shapes[i] + dir + PERF_SHAPES.length) % PERF_SHAPES.length;
          sendSeq(slot);
          paintSteps();
          commit(`Step ${i + 1} curve: ${PERF_SHAPES[seq.shapes[i]]}`);
        });
        shapes.appendChild(sb);
      }
    }
    let drawing = false;
    let lastIdx = -1;
    const setFromPointer = (ev) => {
      const r = bars.getBoundingClientRect();
      const cols = getComputedStyle(bars).getPropertyValue("--cols").trim() === "8" ? 8 : 16;
      const rows = 16 / cols;
      const cx = (ev.clientX - r.left) / r.width;
      const cy = (ev.clientY - r.top) / r.height;
      const col = Math.max(0, Math.min(cols - 1, Math.floor(cx * cols)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor(cy * rows)));
      const idx = row * cols + col;
      const rowTop = row / rows;
      const level = clamp01(1 - (cy - rowTop) * rows);
      if (lastIdx >= 0 && lastIdx !== idx && rows === 1) {
        const a = Math.min(lastIdx, idx);
        const b = Math.max(lastIdx, idx);
        for (let k = a; k <= b; k++) seq.steps[k] = level;
      } else seq.steps[idx] = level;
      lastIdx = idx;
      sendSeq(slot);
      paintSteps();
    };
    bars.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      drawing = true;
      lastIdx = -1;
      begin("Draw steps");
      try {
        bars.setPointerCapture(e.pointerId);
      } catch (_) {}
      setFromPointer(e);
    });
    bars.addEventListener("pointermove", (e) => {
      if (drawing) setFromPointer(e);
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      commit(`Slot ${slot} steps drawn`);
    };
    bars.addEventListener("pointerup", end);
    bars.addEventListener("pointercancel", end);
    wrap.appendChild(bars);
    if (shapes) wrap.appendChild(shapes);
    stepRefs = { slot, barEls, shapes, seq: () => patch().seq[`mod${slot}`] };
    paintSteps();
    return wrap;
  }

  function paintSteps() {
    if (!stepRefs) return;
    const seq = stepRefs.seq();
    const len = (patch().enums[`mod${stepRefs.slot}.len`] | 0) + 1;
    stepRefs.barEls.forEach((b, i) => {
      b.firstChild.style.height = `${Math.round(seq.steps[i] * 100)}%`;
      b.classList.toggle("mmth-step-off", i >= len);
      b.setAttribute("aria-valuenow", String(Math.round(seq.steps[i] * 100)));
      b.setAttribute("aria-valuetext", `${Math.round(seq.steps[i] * 100)}%${stepRefs.shapes ? `, ${PERF_SHAPES[seq.shapes[i]]}` : ""}`);
    });
    if (stepRefs.shapes) {
      Array.from(stepRefs.shapes.children).forEach((sb, i) => {
        sb.textContent = SHAPE_SHORT[seq.shapes[i]] || "?";
        sb.setAttribute("aria-label", `Step ${i + 1} curve: ${PERF_SHAPES[seq.shapes[i]]}`);
      });
    }
  }

  function sendSeq(slot) {
    const seq = patch().seq[`mod${slot}`];
    const s = synth();
    if (s) s.setSeq(slot - 5, seq.steps, seq.shapes);
  }

  function drawEnvGraph() {
    if (!envSvg) return;
    const m = /^env([1-4])$/.exec(tab);
    if (!m) return;
    const e = m[1];
    const p = patch();
    const v = (k) => mapValue(`env${e}.${k}`, p.params[`env${e}.${k}`]);
    const w = (t) => Math.sqrt(Math.max(0, t));
    const d = w(v("delay"));
    const a = w(v("attack"));
    const dc = w(v("decay"));
    const r = w(v("release"));
    const hold = 0.6;
    const total = d + a + dc + hold + r || 1;
    const sx = (t) => (t / total) * 312 + 4;
    const sy = (lv) => 84 - lv * 76;
    const sus = p.params[`env${e}.sustain`];
    const curve = p.params[`env${e}.curve`];
    const pts = [];
    pts.push([sx(0), sy(0)], [sx(d), sy(0)]);
    for (let i = 1; i <= 12; i++) pts.push([sx(d + (a * i) / 12), sy(1 - Math.pow(1 - i / 12, 1 + curve * 3))]);
    for (let i = 1; i <= 12; i++) pts.push([sx(d + a + (dc * i) / 12), sy(sus + (1 - sus) * Math.pow(1 - i / 12, 1 + curve * 4))]);
    pts.push([sx(d + a + dc + hold), sy(sus)]);
    for (let i = 1; i <= 12; i++) pts.push([sx(d + a + dc + hold + (r * i) / 12), sy(sus * Math.pow(1 - i / 12, 1 + curve * 4))]);
    envSvg.replaceChildren(
      svgEl("polyline", { class: "mmth-graph-line", points: pts.map((q) => q.map((x) => x.toFixed(1)).join(",")).join(" ") })
    );
  }

  function drawSlotGraph() {
    if (!slotSvg || slotIndexShown < 0) return;
    const p = patch();
    const s = slotIndexShown;
    const a = p.enums[`mod${s}.shapeA`] | 0;
    const b = p.enums[`mod${s}.shapeB`] | 0;
    const xf = p.params[`mod${s}.xfade`];
    const bi = !!p.enums[`mod${s}.polarity`];
    const shape = (k, ph) => {
      switch (k) {
        case 0:
          return Math.sin(2 * Math.PI * ph);
        case 1:
          return ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
        case 2:
          return 2 * ph - 1;
        case 3:
          return 1 - 2 * ph;
        case 4:
          return ph < 0.5 ? 1 : -1;
        case 5:
          return [0.6, -0.3, 0.9, -0.8, 0.2, -0.5, 0.75, -0.1][Math.floor(ph * 8) % 8];
        case 6:
          return Math.sin(2 * Math.PI * ph * 2) * 0.6 + Math.sin(2 * Math.PI * ph * 3 + 1) * 0.3;
        default:
          return 2 * Math.pow(1 - ph, 3) - 1;
      }
    };
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const ph = (i / 128) * 2 % 1;
      const raw = shape(a, ph) + (shape(b, ph) - shape(a, ph)) * xf;
      const y = bi ? 0.5 + 0.5 * raw : 0.1 + 0.8 * (0.5 + 0.5 * raw);
      pts.push(`${((i / 128) * 312 + 4).toFixed(1)},${(84 - y * 76).toFixed(1)}`);
    }
    slotSvg.replaceChildren(svgEl("polyline", { class: "mmth-graph-line", points: pts.join(" ") }));
  }

  /* ------------------------------------------------------ keyboard */
  function noteOn(note, vel = 0.85) {
    const s = synth();
    if (s) s.noteOn(note, vel);
  }
  function noteOff(note) {
    const s = synth();
    if (s) s.noteOff(note);
  }

  /* Keyboard helpers shared by touch, mouse and the computer keys. */
  function heldByAny(n) {
    return Array.from(heldNotes.values()).includes(n);
  }
  function paintKey(n, cls, on) {
    const k = root.querySelector(`.mmth-key[data-note="${n}"]`);
    if (k) k.classList.toggle(cls, on);
  }
  /** A key was let go. With Hold on, the note keeps sounding and latches. */
  function releaseNote(n) {
    if (holdOn) {
      latched.add(n);
      paintKey(n, "latched", true);
    } else {
      noteOff(n);
      paintKey(n, "latched", false);
    }
    if (!heldByAny(n)) paintKey(n, "down", false);
  }
  function setHold(on) {
    holdOn = !!on;
    if (holdBtn) {
      holdBtn.setAttribute("aria-pressed", String(holdOn));
      holdBtn.classList.toggle("on", holdOn);
    }
    if (!holdOn) {
      for (const n of Array.from(latched)) {
        if (!heldByAny(n)) noteOff(n);
        paintKey(n, "latched", false);
      }
      latched.clear();
    }
  }

  function buildKeyboard() {
    keysCount = isPhoneUI() ? 12 : 24;
    const wrap = el("div", "mmth-keys-wrap");
    const ctl = el("div", "mmth-keys-ctl");
    const oct = el("div", "mmth-keys-oct");
    const down = button("", "mmth-btn mmth-icon-btn", "Octave down");
    down.innerHTML = iconSvg("chevron-left");
    const lbl = el("span", "mmth-oct-label");
    const up = button("", "mmth-btn mmth-icon-btn", "Octave up");
    up.innerHTML = iconSvg("chevron-right");
    oct.append(down, lbl, up);
    const mods = el("div", "mmth-keys-mods");
    const hold = button("Hold", "mmth-btn mmth-hold", "Hold: notes keep sounding after you let go");
    hold.setAttribute("aria-pressed", "false");
    hold.addEventListener("click", () => setHold(!holdOn));
    holdBtn = hold;
    const panic = button("Panic", "mmth-btn mmth-panic", "Stop all sounding notes");
    panic.addEventListener("click", () => {
      releaseAllHeld();
      const s = synth();
      if (s) s.panic();
      status("Mammoth: all notes stopped");
    });
    const collapse = button("", "mmth-btn mmth-icon-btn mmth-kb-collapse", "Show or hide the keyboard");
    collapse.innerHTML = iconSvg("chevron-down");
    collapse.setAttribute("aria-expanded", "true");
    collapse.addEventListener("click", () => {
      const hide = !wrap.classList.contains("collapsed");
      wrap.classList.toggle("collapsed", hide);
      collapse.setAttribute("aria-expanded", String(!hide));
      collapse.innerHTML = iconSvg(hide ? "chevron-up" : "chevron-down");
    });
    mods.append(hold, panic, collapse);
    ctl.append(oct, mods);

    const keys = el("div", "mmth-keys");
    keys.setAttribute("role", "group");
    keys.setAttribute("aria-label", "Keyboard: press keys to play, or use your computer keys Z–M and Q–P");
    const render = () => {
      keys.replaceChildren();
      const count = keysCount;
      lbl.textContent = `${noteName(kbBase)}–${noteName(kbBase + count * kbRows - 1)}`;
      // Rows stack upwards: the lowest octave is the bottom row, as on a two-tier keyboard.
      for (let r = kbRows - 1; r >= 0; r--) {
        const row = el("div", "mmth-keys-row");
        const from = kbBase + r * count;
        let whites = 0;
        for (let n = from; n < from + count; n++) {
          const black = [1, 3, 6, 8, 10].includes(n % 12);
          const k = el("button", `mmth-key ${black ? "mmth-key-b" : "mmth-key-w"}`);
          k.type = "button";
          k.tabIndex = -1;
          k.dataset.note = String(n);
          k.setAttribute("aria-label", noteName(n));
          // C keys show their octave; the big keyboard names every white key.
          if (!black && (n % 12 === 0 || kbBig)) k.appendChild(el("span", "mmth-key-lbl", n % 12 === 0 ? noteName(n) : NOTE_NAMES[n % 12]));
          if (black) k.style.setProperty("--i", String(whites));
          else whites++;
          row.appendChild(k);
        }
        row.style.setProperty("--whites", String(whites));
        keys.appendChild(row);
      }
      // Keep the latched/held paint across a re-render (octave shift while holding).
      for (const n of heldNotes.values()) paintKey(n, "down", true);
      for (const n of latched) paintKey(n, "latched", true);
    };
    keysRender = render;
    render();
    down.addEventListener("click", () => {
      kbBase = Math.max(12, kbBase - 12);
      render();
    });
    up.addEventListener("click", () => {
      kbBase = Math.min(96, kbBase + 12);
      render();
    });

    // Every finger has its own id, so chords and two-thumb playing both work. Sliding
    // a finger from key to key re-strikes the new key; lifting or cancelling releases it.
    const press = (pid, keyEl, ev) => {
      const n = Number(keyEl.dataset.note);
      const prev = heldNotes.get(pid);
      if (prev === n) return;
      if (prev != null) {
        heldNotes.delete(pid);
        releaseNote(prev);
      }
      const r = keyEl.getBoundingClientRect();
      const vel = Math.max(0.3, Math.min(1, 0.35 + ((ev.clientY - r.top) / Math.max(1, r.height)) * 0.65));
      heldNotes.set(pid, n);
      latched.delete(n);
      keyEl.classList.remove("latched");
      keyEl.classList.add("down");
      noteOn(n, vel);
    };
    const release = (pid) => {
      const n = heldNotes.get(pid);
      if (n == null) return;
      heldNotes.delete(pid);
      releaseNote(n);
    };
    keys.addEventListener("pointerdown", (e) => {
      const k = e.target.closest(".mmth-key");
      if (!k) return;
      e.preventDefault();
      if (binding && binding.ensureAudio) binding.ensureAudio();
      try {
        keys.setPointerCapture(e.pointerId);
      } catch (_) {}
      press(`p${e.pointerId}`, k, e);
    });
    keys.addEventListener("pointermove", (e) => {
      if (!heldNotes.has(`p${e.pointerId}`)) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const k = hit && hit.closest ? hit.closest(".mmth-key") : null;
      if (k && keys.contains(k)) press(`p${e.pointerId}`, k, e);
    });
    // A long press must play the note, not open the browser's menu.
    keys.addEventListener("contextmenu", (e) => e.preventDefault());
    const up2 = (e) => release(`p${e.pointerId}`);
    keys.addEventListener("pointerup", up2);
    keys.addEventListener("pointercancel", up2);
    keys.addEventListener("lostpointercapture", up2);
    wrap.append(ctl, keys);
    return wrap;
  }

  function releaseAllHeld() {
    for (const n of heldNotes.values()) noteOff(n);
    heldNotes.clear();
    for (const n of latched) noteOff(n);
    latched.clear();
    root.querySelectorAll(".mmth-key.down, .mmth-key.latched").forEach((k) => k.classList.remove("down", "latched"));
  }

  root.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (e.key === "Escape") {
      e.stopPropagation();
      if (sheetId != null) closeKnobSheet();
      else if (popover) closePopover();
      else if (armed) {
        disarm();
        status("Modulation assign cancelled");
      } else if (menuEl) closeMenu();
      else close();
      return;
    }
    if (typing) {
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (Object.prototype.hasOwnProperty.call(PIANO_KEYS, k)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (binding && binding.ensureAudio) binding.ensureAudio();
      const n = kbBase + PIANO_KEYS[k];
      const id = `k${k}`;
      if (heldNotes.has(id)) return;
      heldNotes.set(id, n);
      latched.delete(n);
      noteOn(n, 0.85);
      paintKey(n, "down", true);
      return;
    }
    // Other plain letters stay in the synth window instead of switching DAW tools; Space still plays.
    if (k.length === 1 && k !== " ") e.stopPropagation();
  });
  root.addEventListener("keyup", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const id = `k${k}`;
    if (!heldNotes.has(id)) return;
    e.stopPropagation();
    const n = heldNotes.get(id);
    heldNotes.delete(id);
    releaseNote(n);
  });
  root.addEventListener("focusout", (e) => {
    if (!root.contains(e.relatedTarget)) {
      for (const [id, n] of Array.from(heldNotes.entries())) {
        if (id[0] === "k") {
          heldNotes.delete(id);
          releaseNote(n);
        }
      }
    }
  });

  /* ------------------------------------------------------- refresh */
  function refreshPowers() {
    const p = patch();
    for (const [id, list] of powerCtl) {
      for (const b of list) {
        const on = !!p.enums[id];
        b.setAttribute("aria-pressed", String(on));
        b.classList.toggle("on", on);
      }
    }
    synthView.querySelectorAll(".mmth-sec[data-power]").forEach((sec) => sec.classList.toggle("mmth-off", !p.enums[sec.dataset.power]));
  }

  function refreshStatic() {
    const p = patch();
    const i = inst();
    title.textContent = i ? i.name : "";
    root.setAttribute("aria-label", `Mammoth synth${i ? ` — ${i.name}` : ""}`);
    presetName.textContent = p.name || "Untitled";
    presetName.title = `${p.name} · ${p.category} — open the preset browser`;
    for (const list of knobs.values()) for (const rec of list) updateKnob(rec);
    for (const [id, list] of enumCtl) for (const s of list) s.value = String(p.enums[id] | 0);
    refreshPowers();
    synthView.querySelectorAll(".mmth-delay-divs").forEach((d) => {
      d.hidden = (p.enums[`fx${d.dataset.fx}.type`] | 0) !== 5;
    });
    for (let k = 1; k <= 3; k++) drawOscPreview(k);
    drawEnvGraph();
    drawSlotGraph();
    paintSteps();
    for (const fn of dynamic) fn();
    refreshSheet();
    // Slot tabs name their current type, e.g. "5 LFO", "6 Perf", "7 Step".
    synthView.querySelectorAll('.mmth-tab[data-tab^="mod"]').forEach((t) => {
      const n = t.dataset.tab.slice(3);
      t.textContent = `${n} ${SLOT_SHORT[p.enums[`mod${n}.type`] | 0] || ""}`.trim();
    });
    viewSynth.setAttribute("aria-selected", String(view === "synth"));
    viewBrowser.setAttribute("aria-selected", String(view === "browser"));
    viewSynth.classList.toggle("active", view === "synth");
    viewBrowser.classList.toggle("active", view === "browser");
  }

  /* ------------------------------------------------------- presets */
  function allPresets() {
    return FACTORY_PRESETS.map((pp) => ({ patch: pp, user: false })).concat(loadUserPresets().map((pp) => ({ patch: pp, user: true })));
  }

  function loadPreset(pp, text) {
    if (!binding || !inst()) return;
    begin(`Load preset ${pp.name}`);
    releaseAllHeld();
    binding.replacePatch(clonePatch(pp));
    closePopover();
    renderTab();
    refreshStatic();
    commit(text || `Mammoth preset: ${pp.name}`);
  }

  function stepPreset(dir) {
    const list = allPresets();
    const p = patch();
    let idx = list.findIndex((x) => x.patch.name === p.name && x.patch.category === p.category);
    idx = idx < 0 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
    loadPreset(list[idx].patch, `Mammoth preset ${idx + 1}/${list.length}: ${list[idx].patch.name}`);
  }

  let browserFilter = "All";
  let browserQuery = "";
  function renderBrowser() {
    browserView.replaceChildren();
    const head = el("div", "mmth-browser-head");
    const search = el("input", "mmth-input");
    search.type = "search";
    search.placeholder = "Search presets";
    search.setAttribute("aria-label", "Search presets");
    search.value = browserQuery;
    search.addEventListener("input", () => {
      browserQuery = search.value;
      renderList();
    });
    const chips = el("div", "mmth-cats");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Categories");
    const cats = ["All"].concat(MAMMOTH_CATEGORIES.filter((c) => allPresets().some((x) => x.patch.category === c)));
    for (const c of cats) {
      const b = button(c, `mmth-btn mmth-cat${c === browserFilter ? " active" : ""}`, `Show ${c}`);
      b.setAttribute("aria-pressed", String(c === browserFilter));
      b.addEventListener("click", () => {
        browserFilter = c;
        renderBrowser();
      });
      chips.appendChild(b);
    }
    head.append(search, chips);
    const list = el("div", "mmth-preset-list");
    list.setAttribute("role", "list");
    const renderList = () => {
      list.replaceChildren();
      const q = browserQuery.trim().toLowerCase();
      const cur = patch();
      const items = allPresets().filter(
        (x) =>
          (browserFilter === "All" || x.patch.category === browserFilter) &&
          (!q || `${x.patch.name} ${x.patch.category} ${x.patch.tags.join(" ")}`.toLowerCase().includes(q))
      );
      if (!items.length) list.appendChild(el("p", "mmth-pop-empty", "No presets match."));
      for (const x of items) {
        const row = el("div", "mmth-preset-row");
        row.setAttribute("role", "listitem");
        const b = button("", `mmth-preset-btn${x.patch.name === cur.name && x.patch.category === cur.category ? " active" : ""}`, `Load ${x.patch.name}`);
        b.append(el("span", "mmth-preset-title", x.patch.name), el("span", "mmth-preset-meta", `${x.patch.category}${x.user ? " · User" : ""}${x.patch.tags.length ? ` · ${x.patch.tags.slice(0, 3).join(", ")}` : ""}`));
        if (x.patch.notes) b.title = x.patch.notes;
        b.addEventListener("click", () => {
          loadPreset(x.patch);
          renderList();
        });
        row.appendChild(b);
        if (x.user) {
          const del = button("", "mmth-btn mmth-icon-btn", `Delete user preset ${x.patch.name}`);
          del.innerHTML = iconSvg("trash-2");
          del.addEventListener("click", () => {
            const left = loadUserPresets().filter((u) => u.name !== x.patch.name);
            saveUserPresets(left);
            status(`Deleted user preset "${x.patch.name}"`);
            renderBrowser();
          });
          row.appendChild(del);
        }
        list.appendChild(row);
      }
    };
    renderList();
    browserView.append(head, list);
  }

  function setView(v) {
    view = v;
    synthView.hidden = v !== "synth";
    browserView.hidden = v !== "browser";
    if (v === "browser") renderBrowser();
    refreshStatic();
  }

  function openSavePopover() {
    closePopover();
    // On phones the Save button lives in the menu, so the popover hangs off the menu button.
    const anchor = btnSave.getClientRects().length ? btnSave : btnMenu;
    popoverAnchor = anchor;
    const pop = el("div", "mmth-popover");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Save preset");
    const p = patch();
    const nameIn = el("input", "mmth-input");
    nameIn.type = "text";
    nameIn.maxLength = 48;
    nameIn.value = p.name === "Init" ? "My Patch" : p.name;
    nameIn.setAttribute("aria-label", "Preset name");
    const cat = el("select", "mmth-select");
    cat.setAttribute("aria-label", "Category");
    for (const c of MAMMOTH_CATEGORIES) {
      const o = el("option", null, c);
      o.value = c;
      cat.appendChild(o);
    }
    cat.value = p.category === "Init" ? "User" : p.category;
    const ok = button("Save preset", "mmth-btn mmth-primary", "Save preset");
    const doSave = () => {
      const name = nameIn.value.trim().slice(0, 48) || "My Patch";
      if (FACTORY_PRESETS.some((f) => f.name === name)) {
        status(`"${name}" is a factory preset name — pick another.`, "error");
        return;
      }
      begin("Save preset");
      p.name = name;
      p.category = cat.value;
      const list = loadUserPresets().filter((u) => u.name !== name);
      list.push(sanitizePatch(clonePatch(p)));
      const stored = saveUserPresets(list);
      closePopover();
      refreshStatic();
      commit(stored ? `Saved Mammoth preset "${name}"` : "Browser storage is full or blocked — use Export to keep a file.");
    };
    ok.addEventListener("click", doSave);
    nameIn.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") doSave();
    });
    cat.addEventListener("keydown", (e) => e.stopPropagation());
    pop.append(el("strong", null, "Save as user preset"), fieldWrap("Name", nameIn), fieldWrap("Category", cat), ok);
    popover = pop;
    placePopover(pop, anchor);
    nameIn.focus();
    nameIn.select();
  }

  /* --------------------------------------------------------- menu */
  let menuEl = null;
  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
      btnMenu.setAttribute("aria-expanded", "false");
    }
  }
  function openMenu() {
    closeMenu();
    closePopover();
    menuEl = el("div", "mmth-menu");
    menuEl.setAttribute("role", "menu");
    // Phones: the header is one row, so Save, the views and the voice readout live here.
    if (isPhoneUI()) {
      menuEl.appendChild(el("div", "mmth-menu-info", readout.textContent || "Voices 0 · CPU 0%"));
    }
    // The Look picker has no room in the phone header, so its choices are here.
    const phoneItems = isPhoneUI()
      ? [
          ["Save as user preset…", openSavePopover],
          ["Synth view", () => setView("synth")],
          ["Preset browser", () => setView("browser")],
          ...SKINS.map((k) => [`Look: ${k.label}${k.id === getSkin() ? " ✓" : ""}`, () => setSkin(k.id)]),
        ]
      : [];
    const items = [
      ...phoneItems,
      ["Init patch", () => loadPreset(FACTORY_PRESETS[0], "Mammoth: Init patch")],
      ["Randomize", () => loadPreset(randomPatch(), "Mammoth: random patch — save it if you like it")],
      ["Copy patch", copyPatch],
      ["Paste patch", pastePatch],
      ["Export patch file…", exportPatch],
      ["Import patch file…", () => fileInput.click()],
      ["All notes off", () => synth() && synth().panic()],
    ];
    for (const [text, fn] of items) {
      const b = button(text, "mmth-menu-item", null);
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", () => {
        closeMenu();
        fn();
      });
      menuEl.appendChild(b);
    }
    root.appendChild(menuEl);
    const r = btnMenu.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    menuEl.style.top = `${r.bottom - rr.top + 4}px`;
    menuEl.style.left = `${Math.max(8, Math.min(rr.width - menuEl.offsetWidth - 8, r.right - rr.left - menuEl.offsetWidth))}px`;
    btnMenu.setAttribute("aria-expanded", "true");
    const first = menuEl.querySelector("button");
    if (first) first.focus();
  }

  function copyPatch() {
    clipboard = clonePatch(patch());
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(JSON.stringify(clipboard)).catch(() => {});
    } catch (_) {}
    status(`Copied patch "${clipboard.name}"`);
  }
  async function pastePatch() {
    let src = clipboard;
    if (!src && navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        const parsed = JSON.parse(text);
        if (parsed && parsed.format === "mammoth-patch") src = parsed;
      } catch (_) {}
    }
    if (!src) {
      status("Nothing to paste — copy a Mammoth patch first.", "error");
      return;
    }
    loadPreset(sanitizePatch(src), `Pasted patch "${src.name}"`);
  }
  function exportPatch() {
    const p = sanitizePatch(patch());
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${String(p.name).replace(/[\\/:*?"<>|]+/g, "-") || "patch"}.mmth.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    status(`Exported "${a.download}"`);
  }
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    if (f.size > 512 * 1024) {
      status("That file is too large to be a Mammoth patch.", "error");
      return;
    }
    try {
      const parsed = JSON.parse(await f.text());
      if (!parsed || parsed.format !== "mammoth-patch") throw new Error("not a Mammoth patch");
      loadPreset(sanitizePatch(parsed), `Imported patch "${parsed.name || f.name}"`);
    } catch (err) {
      status(`Could not import ${f.name}: ${err.message}`, "error");
    }
  });

  function randomPatch() {
    const rnd = Math.random;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const p = makeInitPatch();
    p.name = `Random ${Math.floor(rnd() * 900 + 100)}`;
    p.category = "User";
    for (let i = 1; i <= 3; i++) {
      p.enums[`osc${i}.table`] = Math.floor(rnd() * TABLE_NAMES.length);
      p.enums[`osc${i}.mode`] = rnd() < 0.6 ? 0 : Math.floor(rnd() * 6);
      p.params[`osc${i}.pos`] = rnd();
      p.params[`osc${i}.int`] = 0.4 + rnd() * 0.6;
      p.params[`osc${i}.amp`] = i === 1 ? 0.7 + rnd() * 0.2 : rnd() < 0.6 ? 0.25 + rnd() * 0.4 : 0;
      p.params[`osc${i}.pitch`] = normFor(`osc${i}.pitch`, pick([0, 0, 0, 12, -12, 7, 19]));
      p.params[`osc${i}.fine`] = normFor(`osc${i}.fine`, (rnd() - 0.5) * 20);
    }
    p.enums["filter1.type"] = pick([1, 2, 2, 3, 7, 9, 11]);
    p.params["filter1.cutoff"] = 0.35 + rnd() * 0.5;
    p.params["filter1.res"] = rnd() * 0.6;
    p.params["filter1.b"] = rnd() * 0.5;
    p.params["env4.attack"] = normFor("env4.attack", rnd() < 0.7 ? 0.002 + rnd() * 0.03 : 0.2 + rnd() * 1.2);
    p.params["env4.decay"] = normFor("env4.decay", 0.15 + rnd() * 1.5);
    p.params["env4.sustain"] = rnd() < 0.3 ? 0 : 0.4 + rnd() * 0.6;
    p.params["env4.release"] = normFor("env4.release", 0.05 + rnd() * 1.2);
    p.params["env1.decay"] = normFor("env1.decay", 0.1 + rnd() * 0.8);
    p.params["env1.sustain"] = rnd() * 0.5;
    p.mods.push({ src: "env1", dst: "filter1.cutoff", amt: Math.round((0.1 + rnd() * 0.4) * 100) / 100 });
    p.enums["mod5.sync"] = 1;
    p.params["mod5.rate"] = Math.round(rnd() * 15) / 15;
    p.mods.push({ src: "mod5", dst: pick(["osc1.pos", "osc2.pos", "filter1.cutoff", "osc1.int"]), amt: Math.round((rnd() * 0.5 - 0.25) * 100) / 100 });
    p.enums["fx1.type"] = pick([0, 1, 2, 3, 4, 5, 7]);
    p.params["fx1.a"] = 0.15 + rnd() * 0.25;
    p.enums["fx2.type"] = pick([0, 6, 6, 5]);
    p.params["fx2.a"] = 0.15 + rnd() * 0.2;
    p.params["master.vol"] = 0.62;
    return sanitizePatch(p);
  }

  /* ------------------------------------------------- pages and sheet */
  function setPage(key) {
    if (!pageTabs.has(key)) return;
    page = key;
    applyPages(true);
  }
  /** Sheet mode shows one page at a time; desktop shows every section. Keys are docked on all of them. */
  function applyPages(resetScroll) {
    const sheet = isSheetUI();
    const phone = isPhoneUI();
    const land = phone && window.innerWidth > window.innerHeight;
    root.classList.toggle("mmth-sheet", sheet);
    root.classList.toggle("mmth-phone", phone);
    root.classList.toggle("mmth-land", land);
    const big = sheet && !land && page === "play";
    root.classList.toggle("mmth-playbig", big);
    document.body.classList.toggle("mmth-sheet-open", sheet && !root.hidden);
    for (const node of pagedNodes) node.hidden = sheet && node.dataset.page !== page;
    for (const [key, b] of pageTabs) {
      const on = key === page;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    // One octave per row on phones (12 keys; two rows on the Play page), two octaves on tablets and desktops (24 keys).
    const want = phone ? 12 : 24;
    const wantRows = big && phone ? 2 : 1;
    if ((want !== keysCount || wantRows !== kbRows || big !== kbBig) && keysRender) {
      keysCount = want;
      kbRows = wantRows;
      kbBig = big;
      keysRender();
    }
    if (resetScroll) {
      const bd = root.querySelector(".mmth-body");
      if (bd) bd.scrollTop = 0;
    }
  }

  /* ---------------------------------------------------- window move */
  let pos = null;
  function placeWindow() {
    if (isSheetUI()) {
      root.style.left = "";
      root.style.top = "";
      return;
    }
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    if (!pos) pos = { x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2 };
    // Always fully on screen (the window is never wider or taller than the viewport minus 16px).
    pos.x = Math.max(8, Math.min(window.innerWidth - w - 8, pos.x));
    pos.y = Math.max(8, Math.min(window.innerHeight - h - 8, pos.y));
    root.style.left = `${Math.round(pos.x)}px`;
    root.style.top = `${Math.round(pos.y)}px`;
  }
  bar.addEventListener("pointerdown", (e) => {
    if (isSheetUI() || e.target.closest("button, select, input")) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = pos ? { x: pos.x, y: pos.y } : { x: root.offsetLeft, y: root.offsetTop };
    try {
      bar.setPointerCapture(e.pointerId);
    } catch (_) {}
    const move = (ev) => {
      pos = { x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy };
      placeWindow();
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  });
  window.addEventListener("resize", () => {
    if (!root.hidden) {
      applyPages(false);
      placeWindow();
    }
  });

  /* ---------------------------------------------------- outside */
  document.addEventListener("pointerdown", (e) => {
    if (popover && !popover.contains(e.target) && !(popoverAnchor && popoverAnchor.contains(e.target))) closePopover();
    if (menuEl && !menuEl.contains(e.target) && !btnMenu.contains(e.target)) closeMenu();
  });

  btnPrev.addEventListener("click", () => stepPreset(-1));
  btnNext.addEventListener("click", () => stepPreset(1));
  presetName.addEventListener("click", () => setView(view === "browser" ? "synth" : "browser"));
  btnSave.addEventListener("click", openSavePopover);
  viewSynth.addEventListener("click", () => setView("synth"));
  viewBrowser.addEventListener("click", () => setView("browser"));
  btnMenu.addEventListener("click", () => (menuEl ? closeMenu() : openMenu()));
  btnClose.addEventListener("click", () => close());

  /* ---------------------------------------------------------- api */
  function show() {
    root.hidden = false;
    document.body.classList.add("mmth-open");
    applyPages(true);
    placeWindow();
    const s = synth();
    if (s) s.setMeter(true);
    try {
      root.focus({ preventScroll: true });
    } catch (_) {}
  }

  function close() {
    if (root.hidden) return;
    releaseAllHeld();
    disarm();
    closeKnobSheet();
    closePopover();
    closeMenu();
    flashEl.hidden = true;
    const s = synth();
    if (s) s.setMeter(false);
    root.hidden = true;
    document.body.classList.remove("mmth-open");
    document.body.classList.remove("mmth-sheet-open");
    lastLive = new Map();
    const b = binding;
    if (b && b.onClose) b.onClose();
  }

  function bind(b) {
    const same = binding && b && binding.instrumentId === b.instrumentId;
    if (binding && !same) {
      releaseAllHeld();
      const old = binding.live();
      if (old) old.setMeter(false);
    }
    binding = b;
    lastLive = new Map();
    if (!same || !synthView.firstChild) buildSynth();
    if (view === "browser") renderBrowser();
    notice.hidden = !!b.liveSupported;
    notice.textContent = b.liveSupported
      ? ""
      : "This browser can't play the synth live (it needs AudioWorklet — Chrome 66+, Safari 14.1+, Firefox 76+). You can still edit the patch and render it to the playlist.";
    refreshStatic();
    show();
  }

  function onStatus(m) {
    if (root.hidden || !m) return;
    readout.textContent = `Voices ${m.voices} · CPU ${Math.round((m.cpu || 0) * 100)}%`;
    const fills = root.querySelectorAll(".mmth-meter-fill");
    if (fills.length === 2) {
      fills[0].style.transform = `scaleY(${Math.min(1, m.peakL || 0).toFixed(3)})`;
      fills[1].style.transform = `scaleY(${Math.min(1, m.peakR || 0).toFixed(3)})`;
    }
    const next = new Map();
    if (Array.isArray(m.mod)) {
      for (let k = 0; k + 1 < m.mod.length; k += 2) {
        const p = MAMMOTH_PARAMS[m.mod[k]];
        if (p) next.set(p.id, m.mod[k + 1]);
      }
    }
    const changed = new Set([...lastLive.keys(), ...next.keys()]);
    lastLive = next;
    for (const id of changed) updateId(id);
  }

  const api = {
    get instrumentId() {
      return binding ? binding.instrumentId : null;
    },
    isOpen: () => !root.hidden,
    refresh() {
      if (root.hidden || !binding) return;
      if (!inst()) {
        close();
        return;
      }
      renderTab();
      refreshStatic();
      if (view === "browser") renderBrowser();
    },
    close,
    onStatus,
    element: root,
  };

  return { api, bind, show };
}
