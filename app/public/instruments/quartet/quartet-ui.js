/**
 * Quartet's editor window, in the studio's analog look (analog.js / analog.css):
 * a centre LCD (lcd.js) flanked by a VU meter and status lights, the four oscillators, filter, both envelopes
 * and the LFO, each with its own screen (screens.js), and a dock with the master
 * section, an analog VU meter and a playable keyboard.
 * Same binding as the Mammoth editor (instrument-manager.js):
 *   { instrumentId, getInstrument, live, ensureAudio, replacePatch, setRoot,
 *     beginEdit, commit, setStatus, onClose }
 *
 * Knobs: drag up/down with a mouse or pen (Shift for fine moves), sideways with a
 * finger (an up/down swipe scrolls the window), arrow keys / Page keys / Home / End,
 * the wheel while focused, double-click to reset. Every gesture is one undo step.
 * 15px text floor, 44px touch targets on touch screens, no sideways page scroll.
 */
import { WAVES, FILTER_TYPES, LFO_TARGETS, LFO_SHAPES, RANGES, clonePatch, defaultPatch } from "./params.js?v=1";
import { FACTORY_PRESETS } from "./presets.js?v=1";
import { applySkin, knobParts, knobGloss, ringPath, skinSelect, RING_R } from "../analog.js?v=4";
import { makeScreen, drawWave, drawFilter, drawEnv, drawLfo, shapeAt } from "../screens.js?v=2";
import { createCenterDisplay } from "../lcd.js?v=1";

const NS = "http://www.w3.org/2000/svg";
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

const fmt = {
  st: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} st`,
  ct: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} ct`,
  oct: (v) => (v > 0 ? `+${v}` : String(v)),
  pct: (v) => `${Math.round(v * 100)}%`,
  bipct: (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`,
  pan: (v) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `${Math.round(-v * 100)} L` : `${Math.round(v * 100)} R`),
  hz: (v) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(v < 10000 ? 2 : 1)}k`),
  lfoHz: (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} Hz`,
  time: (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  q: (v) => v.toFixed(1),
  db: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`,
  voices: (v) => (v === 1 ? "Off" : `×${v}`),
  ct0: (v) => `${Math.round(v)} ct`,
};

// A knob's position (0..1000) <-> value; "log" for frequencies and times.
function toPos(v, [lo, hi], log) {
  return Math.round(log ? (Math.log(v / lo) / Math.log(hi / lo)) * 1000 : ((v - lo) / (hi - lo)) * 1000);
}
function fromPos(pos, [lo, hi], log, step) {
  const t = Math.max(0, Math.min(1000, pos)) / 1000;
  let v = log ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t;
  if (step) v = Math.round(v / step) * step;
  return Math.max(lo, Math.min(hi, Number(v.toFixed(6))));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
const knobPoint = (r, t) => {
  const a = ((-135 + 270 * t) * Math.PI) / 180;
  return [30 + r * Math.sin(a), 30 - r * Math.cos(a)];
};

// Little drawings for the wave and shape switches (24×16).
const ICONS = {
  sine: "M1 8 Q6 -3 11 8 T21 8",
  triangle: "M1 8 L6 2 L16 14 L21 8",
  sawtooth: "M1 14 L11 2 L11 14 L21 2",
  square: "M1 14 L1 3 L11 3 L11 14 L21 14 L21 3",
  noise: "M1 8 L3 3 L5 12 L7 5 L9 13 L11 2 L13 11 L15 4 L17 13 L19 6 L21 9",
};

let singleton = null;

export function openQuartetEditor(binding) {
  if (!singleton) singleton = createEditor();
  singleton.bind(binding);
  return singleton.api;
}

function createEditor() {
  let binding = null;
  const controls = []; // { sync(patch) }
  const DEFAULTS = defaultPatch();

  const root = el("div", "qrt-window");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Quartet synth");
  root.tabIndex = -1;
  root.hidden = true;
  applySkin(root);

  // Title bar: name, preset, look, play, close
  const bar = el("div", "qrt-titlebar");
  const brand = el("div", "qrt-brand");
  brand.append(el("span", "qrt-logo", "QUARTET"));
  const title = el("span", "qrt-title");
  brand.append(title);
  const presetSel = el("select", "qrt-select qrt-preset");
  presetSel.setAttribute("aria-label", "Preset");
  presetSel.append(new Option("Presets…", ""));
  FACTORY_PRESETS.forEach((p, i) => presetSel.append(new Option(p.name, String(i))));
  const playBtn = el("button", "qrt-btn qrt-play");
  playBtn.type = "button";
  playBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-play"/></svg><span>Play</span>';
  playBtn.title = "Hear the sound";
  const closeBtn = el("button", "qrt-btn qrt-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = '<svg class="icon icon-solo" aria-hidden="true"><use href="#i-x"/></svg>';
  const presetPrev = el("button", "qrt-btn qrt-step");
  presetPrev.type = "button";
  presetPrev.setAttribute("aria-label", "Previous preset");
  presetPrev.innerHTML = '<svg class="icon icon-solo" aria-hidden="true"><use href="#i-chevron-left"/></svg>';
  const presetNext = el("button", "qrt-btn qrt-step");
  presetNext.type = "button";
  presetNext.setAttribute("aria-label", "Next preset");
  presetNext.innerHTML = '<svg class="icon icon-solo" aria-hidden="true"><use href="#i-chevron-right"/></svg>';
  const presetGroup = el("div", "qrt-presetbar");
  presetGroup.append(presetPrev, presetSel, presetNext);
  bar.append(brand, presetGroup, playBtn, skinSelect("qrt-skin"), closeBtn);
  const status = el("div", "qrt-status");
  status.setAttribute("aria-live", "polite");
  const body = el("div", "qrt-body");
  root.append(bar, status, body);
  document.body.appendChild(root);

  const inst = () => (binding ? binding.getInstrument() : null);
  const patch = () => (inst() ? inst().patch : null);
  const get = (p, path) => path.reduce((o, k) => (o == null ? o : o[k]), p);

  /** Applies one change to a copy of the patch and hands it to the synth. */
  function change(path, value) {
    const cur = patch();
    if (!cur) return;
    const next = clonePatch(cur);
    let o = next;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = value;
    binding.replacePatch(next);
    drawStatic();
  }

  function card(titleText, kind, extra) {
    const c = el("section", "qrt-card");
    c.dataset.kind = kind;
    const h = el("div", "qrt-card-head");
    h.append(el("h4", "qrt-card-title", titleText));
    if (extra) h.append(extra);
    c.append(h);
    body.append(c);
    return c;
  }

  function knobs(parent) {
    const row = el("div", "qrt-knobs");
    parent.append(row);
    return row;
  }

  function knob(parent, group, label, path, range, { log = false, step = 0, format, full = label, bipolar = false } = {}) {
    const wrap = el("div", "qrt-knob");
    const dial = el("div", "qrt-dial");
    dial.tabIndex = 0;
    dial.setAttribute("role", "slider");
    dial.setAttribute("aria-label", `${group} ${full}`);
    dial.title = full;
    dial.setAttribute("aria-valuemin", "0");
    dial.setAttribute("aria-valuemax", "1000");
    const svg = svgEl("svg", { viewBox: "0 0 60 60", "aria-hidden": "true", focusable: "false" });
    const track = svgEl("path", { class: "an-track", d: ringPath(RING_R, 0, 1) });
    const glow = svgEl("path", { class: "an-valglow" });
    const ring = svgEl("path", { class: "an-valarc" });
    const cap = svgEl("circle", { class: "an-cap", cx: 30, cy: 30, r: 14 });
    const ptr = svgEl("line", { class: "an-ptr", x1: 30, y1: 30, x2: 30, y2: 17 });
    svg.append(...knobParts(), track, glow, ring, cap, knobGloss(), ptr);
    // Two-sided knobs (tuning, pan, envelope amount) light their ring from the middle.
    const origin = bipolar ? toPos(0, range, false) / 1000 : 0;
    dial.append(svg);
    const val = el("span", "qrt-knob-value");
    wrap.append(dial, el("span", "qrt-knob-label", label), val);
    parent.append(wrap);

    let value = get(DEFAULTS, path);
    const draw = () => {
      const t = Math.max(0, Math.min(1000, toPos(value, range, log))) / 1000;
      const [x1, y1] = knobPoint(4.5, t);
      const [x2, y2] = knobPoint(13, t);
      ptr.setAttribute("x1", x1.toFixed(2));
      ptr.setAttribute("y1", y1.toFixed(2));
      ptr.setAttribute("x2", x2.toFixed(2));
      ptr.setAttribute("y2", y2.toFixed(2));
      const d = ringPath(RING_R, origin, t);
      ring.setAttribute("d", d);
      glow.setAttribute("d", d);
      val.textContent = format(value);
      dial.setAttribute("aria-valuenow", String(Math.round(t * 1000)));
      dial.setAttribute("aria-valuetext", val.textContent);
    };
    const set = (v) => {
      if (v === value) return;
      value = v;
      draw();
      change(path, v);
      showParam(`${group} ${full}`, val.textContent, toPos(v, range, log) / 1000, viewFor(path));
    };
    const coarse = step && (range[1] - range[0]) / step <= 48; // stepped knobs move one step per key

    dial.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      const touch = e.pointerType === "touch";
      const sx = e.clientX;
      const sy = e.clientY;
      const p0 = toPos(value, range, log);
      let turning = !touch;
      let began = false;
      if (!touch) {
        e.preventDefault();
        dial.focus({ preventScroll: true });
        try {
          dial.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (!turning) {
          // A finger turns the knob sideways; an up/down swipe is left to scroll the window.
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            turning = true;
            try {
              dial.setPointerCapture(ev.pointerId);
            } catch (_) {}
          } else {
            if (Math.abs(dy) > 10) end();
            return;
          }
        }
        if (!began) {
          began = true;
          binding.beginEdit();
        }
        const px = touch ? dx : -dy;
        set(fromPos(p0 + px * (ev.shiftKey ? 1.4 : 5.6), range, log, step));
      };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        end();
      };
      const end = () => {
        dial.removeEventListener("pointermove", move);
        dial.removeEventListener("pointerup", up);
        dial.removeEventListener("pointercancel", up);
        if (began) binding.commit();
        began = false;
      };
      dial.addEventListener("pointermove", move);
      dial.addEventListener("pointerup", up);
      dial.addEventListener("pointercancel", up);
    });

    let keyEdit = false;
    dial.addEventListener("keydown", (e) => {
      const keys = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10, Home: "min", End: "max" };
      const k = keys[e.key];
      if (k == null || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (!keyEdit) {
        keyEdit = true;
        binding.beginEdit();
      }
      if (k === "min") set(range[0]);
      else if (k === "max") set(range[1]);
      else if (coarse) set(Math.max(range[0], Math.min(range[1], value + k * step)));
      else set(fromPos(toPos(value, range, log) + k * 10, range, log, step));
    });
    dial.addEventListener("keyup", () => {
      if (keyEdit) {
        keyEdit = false;
        binding.commit();
      }
    });
    dial.addEventListener(
      "wheel",
      (e) => {
        if (document.activeElement !== dial) return;
        e.preventDefault();
        binding.beginEdit();
        const dir = e.deltaY < 0 ? 1 : -1;
        if (coarse) set(Math.max(range[0], Math.min(range[1], value + dir * step)));
        else set(fromPos(toPos(value, range, log) + dir * 10, range, log, step));
        binding.commit();
      },
      { passive: false }
    );
    dial.addEventListener("dblclick", () => {
      binding.beginEdit();
      set(get(DEFAULTS, path));
      binding.commit();
    });

    controls.push({
      sync(p) {
        value = get(p, path);
        draw();
      },
    });
    return wrap;
  }

  function select(parent, label, path, options, { number = false } = {}) {
    const row = el("label", "qrt-row");
    row.append(el("span", "qrt-label", label));
    const sel = el("select", "qrt-select");
    options.forEach((o) => sel.append(new Option(o.label, String(o.id))));
    row.append(sel);
    parent.append(row);
    sel.addEventListener("change", () => {
      binding.beginEdit();
      change(path, number ? Number(sel.value) : sel.value);
      binding.commit();
    });
    controls.push({
      sync(p) {
        sel.value = String(get(p, path));
      },
    });
    return sel;
  }

  /** A row of lit switches (one is on), e.g. the wave shapes. */
  function switches(parent, group, path, options, { icons = false } = {}) {
    const row = el("div", "an-switches");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", group);
    const btns = options.map((o) => {
      const b = el("button", "an-sw");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", o.label);
      b.title = o.label;
      b.append(el("span", "an-sw-led"));
      if (icons && ICONS[o.id]) {
        const svg = svgEl("svg", { viewBox: "0 0 22 16", "aria-hidden": "true", focusable: "false" });
        svg.append(svgEl("path", { d: ICONS[o.id] }));
        b.append(svg);
      } else {
        b.append(el("span", "an-sw-text", o.short || o.label));
      }
      b.addEventListener("click", () => {
        if (b.getAttribute("aria-checked") === "true") return;
        binding.beginEdit();
        change(path, o.id);
        binding.commit();
        sync(patch());
        showParam(group, o.label, null, viewFor(path));
      });
      row.append(b);
      return [o.id, b];
    });
    const sync = (p) => {
      const v = get(p, path);
      btns.forEach(([id, b]) => b.setAttribute("aria-checked", String(id === v)));
    };
    controls.push({ sync });
    parent.append(row);
    return row;
  }

  // Centre display: the LCD (live scope, preset, last move) between the VU meter and status lights.
  const center = createCenterDisplay({
    brand: "QUARTET",
    leds: [
      { id: "osc0", label: "Osc 1" },
      { id: "osc1", label: "Osc 2" },
      { id: "osc2", label: "Osc 3" },
      { id: "osc3", label: "Osc 4" },
      { id: "lfo", label: "LFO" },
    ],
  });
  const main = el("section", "qrt-main");
  main.append(center.el);
  body.append(main);
  /** What the LCD pictures while a control of this part of the patch moves. */
  const viewFor = (path) => {
    const k = path[0];
    if (k === "oscs") return (cv) => patch() && drawWave(cv, patch().oscs[path[1]]);
    if (k === "filter") return (cv) => patch() && drawFilter(cv, binding.ensureAudio(), patch().filter);
    if (k === "ampEnv" || k === "filterEnv") return (cv) => patch() && drawEnv(cv, patch()[k]);
    if (k === "lfo") return (cv) => patch() && drawLfo(cv, patch().lfo, performance.now() / 1000);
    return null;
  };
  function showParam(name, text, frac = null, draw = null) {
    center.showParam(name, text, frac, draw);
  }

  // Oscillators
  const screens = []; // { draw(patch) } for the static screens
  for (let i = 0; i < 4; i++) {
    const power = el("button", "qrt-led-btn");
    power.type = "button";
    power.setAttribute("aria-label", `Oscillator ${i + 1} on`);
    power.append(el("span", "qrt-led"), el("span", null, "On"));
    const c = card(`Osc ${i + 1}`, "osc", power);
    power.addEventListener("click", () => {
      const on = power.getAttribute("aria-pressed") !== "true";
      binding.beginEdit();
      change(["oscs", i, "on"], on);
      binding.commit();
      power.setAttribute("aria-pressed", String(on));
      c.classList.toggle("is-off", !on);
      showParam(`Osc ${i + 1}`, on ? "on" : "off", null, viewFor(["oscs", i]));
    });
    controls.push({
      sync(p) {
        power.setAttribute("aria-pressed", String(p.oscs[i].on));
        c.classList.toggle("is-off", !p.oscs[i].on);
      },
    });
    const g = `Oscillator ${i + 1}`;
    const scr = makeScreen("qrt-wave");
    c.append(scr.wrap);
    screens.push({ draw: (p) => drawWave(scr.canvas, p.oscs[i]) });
    switches(c, `${g} wave`, ["oscs", i, "wave"], WAVES, { icons: true });
    const k = knobs(c);
    knob(k, g, "Octave", ["oscs", i, "octave"], RANGES.octave, { step: 1, format: fmt.oct, bipolar: true });
    knob(k, g, "Semi", ["oscs", i, "semi"], RANGES.semi, { step: 1, format: fmt.st, bipolar: true });
    knob(k, g, "Fine", ["oscs", i, "fine"], RANGES.fine, { step: 1, format: fmt.ct, bipolar: true });
    knob(k, g, "Level", ["oscs", i, "level"], RANGES.level, { step: 0.01, format: fmt.pct });
    knob(k, g, "Pan", ["oscs", i, "pan"], RANGES.pan, { step: 0.01, format: fmt.pan, bipolar: true });
    knob(k, g, "Unison", ["oscs", i, "unison"], RANGES.unison, { step: 1, format: fmt.voices });
    knob(k, g, "Spread", ["oscs", i, "spread"], RANGES.spread, { step: 1, format: fmt.ct0 });
  }

  const f = card("Filter", "filter");
  const fScr = makeScreen("qrt-curve");
  f.append(fScr.wrap);
  screens.push({ draw: (p) => drawFilter(fScr.canvas, binding && binding.ensureAudio(), p.filter) });
  switches(f, "Filter type", ["filter", "type"], [
    { id: "lowpass", label: "Low-pass", short: "LP" },
    { id: "highpass", label: "High-pass", short: "HP" },
    { id: "bandpass", label: "Band-pass", short: "BP" },
  ]);
  const fk = knobs(f);
  knob(fk, "Filter", "Cutoff", ["filter", "cutoff"], RANGES.cutoff, { log: true, format: fmt.hz });
  knob(fk, "Filter", "Reso", ["filter", "reso"], RANGES.reso, { log: true, format: fmt.q, full: "Resonance" });
  knob(fk, "Filter", "Env", ["filter", "env"], RANGES.env, { step: 0.01, format: fmt.bipct, bipolar: true, full: "Envelope" });
  knob(fk, "Filter", "Key", ["filter", "keytrack"], RANGES.keytrack, { step: 0.01, format: fmt.pct, full: "Key follow" });

  for (const [key, name, kind] of [["ampEnv", "Level env", "amp"], ["filterEnv", "Filter env", "env"]]) {
    const e = card(name, kind);
    const eScr = makeScreen("qrt-env");
    e.append(eScr.wrap);
    screens.push({ draw: (p) => drawEnv(eScr.canvas, p[key]) });
    const ek = knobs(e);
    // Short names as printed on hardware; screen readers hear the full ones.
    knob(ek, name, "Att", [key, "a"], RANGES.a, { log: true, format: fmt.time, full: "Attack" });
    knob(ek, name, "Dec", [key, "d"], RANGES.d, { log: true, format: fmt.time, full: "Decay" });
    knob(ek, name, "Sus", [key, "s"], RANGES.s, { step: 0.01, format: fmt.pct, full: "Sustain" });
    knob(ek, name, "Rel", [key, "r"], RANGES.r, { log: true, format: fmt.time, full: "Release" });
  }

  const l = card("LFO", "mod");
  const lScr = makeScreen("qrt-lfo");
  l.append(lScr.wrap);
  switches(l, "LFO shape", ["lfo", "shape"], LFO_SHAPES, { icons: true });
  // What the LFO moves sits in the section's bar, keeping the four sections level.
  const moves = select(l, "Moves", ["lfo", "target"], LFO_TARGETS);
  moves.parentElement.remove();
  moves.classList.add("qrt-head-select");
  moves.setAttribute("aria-label", "LFO moves");
  moves.title = "What the LFO moves";
  l.querySelector(".qrt-card-head").append(moves);
  const lk = knobs(l);
  knob(lk, "LFO", "Rate", ["lfo", "rate"], RANGES.rate, { log: true, format: fmt.lfoHz });
  knob(lk, "LFO", "Depth", ["lfo", "depth"], RANGES.depth, { step: 0.01, format: fmt.pct });

  // Dock: master section with the VU meter, and a keyboard to play the sound on.
  const dock = el("div", "qrt-dock");
  const m = el("section", "qrt-card qrt-master");
  m.dataset.kind = "amp";
  const mh = el("div", "qrt-card-head");
  mh.append(el("h4", "qrt-card-title", "Master"));
  m.append(mh);
  const mrow = el("div", "qrt-master-row");
  const mk = knobs(mrow);
  knob(mk, "Master", "Volume", ["volume"], RANGES.volume, { step: 0.5, format: fmt.db });
  knob(mk, "Master", "Velocity", ["velocity"], RANGES.velocity, { step: 0.01, format: fmt.pct });
  m.append(mrow);
  const rootRow = el("label", "qrt-row qrt-root");
  rootRow.append(el("span", "qrt-label", "Step note"));
  const rootSel = el("select", "qrt-select");
  rootSel.title = "The note the Step Rack plays";
  for (let n = 24; n <= 96; n++) rootSel.append(new Option(noteName(n), String(n)));
  rootRow.append(rootSel);
  rootSel.addEventListener("change", () => binding.setRoot(Number(rootSel.value)));

  // Keyboard: two octaves (one on phones); slide a finger across to glide between keys.
  const kb = el("div", "qrt-kb");
  const kbBar = el("div", "qrt-kb-bar");
  const octDown = el("button", "qrt-btn qrt-oct");
  octDown.type = "button";
  octDown.setAttribute("aria-label", "Keyboard down an octave");
  octDown.innerHTML = '<svg class="icon icon-solo" aria-hidden="true"><use href="#i-chevron-left"/></svg>';
  const octLabel = el("span", "qrt-oct-label");
  const octUp = el("button", "qrt-btn qrt-oct");
  octUp.type = "button";
  octUp.setAttribute("aria-label", "Keyboard up an octave");
  octUp.innerHTML = '<svg class="icon icon-solo" aria-hidden="true"><use href="#i-chevron-right"/></svg>';
  kbBar.append(octDown, octLabel, octUp, rootRow);
  const keys = el("div", "qrt-keys");
  keys.setAttribute("aria-label", "Keyboard");
  kb.append(kbBar, keys);
  dock.append(m, kb);
  root.append(dock);
  // Phones: the dock keeps only the keyboard; the master section scrolls with the panel.
  const phoneQ = window.matchMedia("(max-width: 760px), (max-width: 900px) and (max-height: 520px)");
  const placeMaster = () => (phoneQ.matches ? body.append(m) : dock.prepend(m));
  placeMaster();
  if (phoneQ.addEventListener) phoneQ.addEventListener("change", placeMaster);

  let kbBase = 60;
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const keyEls = [];
  for (let n = 0; n <= 24; n++) {
    const black = BLACK.has(n % 12);
    const k = el("div", `qrt-key ${black ? "qrt-key-b" : "qrt-key-w"}${n >= 12 ? " qrt-oct2" : ""}`);
    k.dataset.n = String(n);
    if (!black && n % 12 === 0) k.append(el("span", "qrt-key-lbl"));
    keys.append(k);
    keyEls.push(k);
  }
  // Black keys sit over the gap after their white key (quartet.css places them by --wi,
  // out of --whites: 15 white keys, or 7 when phones show one octave).
  let whiteIndex = 0;
  keyEls.forEach((k) => {
    if (k.classList.contains("qrt-key-w")) whiteIndex++;
    else k.style.setProperty("--wi", String(whiteIndex));
  });
  const labelKeys = () => {
    octLabel.textContent = `${noteName(kbBase)}–${noteName(kbBase + 24)}`;
    keyEls.forEach((k) => {
      const lbl = k.querySelector(".qrt-key-lbl");
      if (lbl) lbl.textContent = noteName(kbBase + Number(k.dataset.n));
    });
  };
  labelKeys();
  octDown.addEventListener("click", () => {
    kbBase = Math.max(24, kbBase - 12);
    labelKeys();
  });
  octUp.addEventListener("click", () => {
    kbBase = Math.min(84, kbBase + 12);
    labelKeys();
  });
  const held = new Map(); // pointerId -> { note, el }
  const keyAt = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    return hit && hit.closest ? hit.closest(".qrt-key") : null;
  };
  const press = (pointerId, keyEl, y) => {
    const s = binding && binding.live();
    const prev = held.get(pointerId);
    if (prev && prev.el === keyEl) return;
    if (prev) release(pointerId);
    if (!keyEl) return;
    const note = Math.max(0, Math.min(127, kbBase + Number(keyEl.dataset.n)));
    const r = keyEl.getBoundingClientRect();
    const vel = Math.max(0.35, Math.min(1, 0.4 + 0.6 * ((y - r.top) / Math.max(1, r.height))));
    if (s) s.noteOn(note, vel, 0);
    keyEl.classList.add("down");
    held.set(pointerId, { note, el: keyEl });
    showParam("Note", noteName(note));
  };
  const release = (pointerId) => {
    const h = held.get(pointerId);
    if (!h) return;
    held.delete(pointerId);
    const s = binding && binding.live();
    if (s) s.noteOff(h.note, 0);
    h.el.classList.remove("down");
  };
  keys.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    binding.ensureAudio();
    press(e.pointerId, keyAt(e.clientX, e.clientY), e.clientY);
  });
  keys.addEventListener("pointermove", (e) => {
    if (held.has(e.pointerId)) press(e.pointerId, keyAt(e.clientX, e.clientY), e.clientY);
  });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) keys.addEventListener(t, (e) => release(e.pointerId));

  // Live screens: the scope, the VU needle and the LFO dot move while the window is open.
  let raf = 0;
  let lastFrame = 0;
  const slow = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  function frame(now) {
    raf = 0;
    if (root.hidden) return;
    raf = requestAnimationFrame(frame);
    if (slow && now - lastFrame < 32) return; // about 30 frames a second on touch devices
    lastFrame = now;
    const s = binding && binding.live();
    center.frame(s, now);
    const p = patch();
    if (p) {
      drawLfo(lScr.canvas, p.lfo, now / 1000);
      const lv = p.lfo.target === "off" ? 0 : (shapeAt(p.lfo.shape, (now / 1000) * p.lfo.rate) + 1) / 2;
      center.setLedLevel("lfo", 0.15 + 0.85 * lv * Math.max(0.3, p.lfo.depth));
    }
  }
  function startScreens() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function drawStatic() {
    const p = patch();
    if (!p) return;
    screens.forEach((x) => x.draw(p));
    const i = inst();
    center.setName(p.name || "Init", i ? i.name.toUpperCase() : "QUARTET");
    const on = p.oscs.map((o, n) => (o.on ? n + 1 : null)).filter(Boolean);
    const ft = p.filter.type === "lowpass" ? "LP" : p.filter.type === "highpass" ? "HP" : "BP";
    center.setIdle(`Osc ${on.join(" ") || "–"} · ${ft} ${fmt.hz(p.filter.cutoff)} · Step ${i ? noteName(i.root) : ""}`);
    p.oscs.forEach((o, n) => center.setLed(`osc${n}`, o.on));
    center.setLed("lfo", p.lfo.target !== "off");
  }
  for (const ev of ["resize", "an-skin"]) {
    window.addEventListener(ev, () => {
      if (!root.hidden) drawStatic();
    });
  }

  // Title bar actions
  const loadPreset = (p) => {
    binding.beginEdit();
    binding.replacePatch(clonePatch(p));
    binding.commit();
    refresh();
    onStatus(`Preset: ${p.name}`);
    audition();
  };
  presetSel.addEventListener("change", () => {
    const p = FACTORY_PRESETS[Number(presetSel.value)];
    presetSel.value = "";
    if (p) loadPreset(p);
  });
  const stepPreset = (dir) => {
    const cur = patch();
    const at = FACTORY_PRESETS.findIndex((x) => cur && x.name === cur.name);
    const n = FACTORY_PRESETS.length;
    loadPreset(FACTORY_PRESETS[(((at < 0 ? (dir > 0 ? -1 : 0) : at) + dir) % n + n) % n]);
  };
  presetPrev.addEventListener("click", () => stepPreset(-1));
  presetNext.addEventListener("click", () => stepPreset(1));
  function audition() {
    const s = binding && binding.live();
    const i = inst();
    if (!s || !i) return;
    const ctx = binding.ensureAudio();
    const t0 = ctx.currentTime + 0.03;
    [[0, 0, 0.3], [0.2, 4, 0.3], [0.4, 7, 0.3], [0.6, 12, 0.8]].forEach(([t, st, d]) => {
      const n = Math.max(0, Math.min(127, i.root + st));
      s.noteOn(n, 0.85, t0 + t);
      s.noteOff(n, t0 + t + d);
    });
  }
  playBtn.addEventListener("click", audition);
  closeBtn.addEventListener("click", () => close());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });

  function onStatus(text) {
    status.textContent = text || "";
  }

  function refresh() {
    const p = patch();
    const i = inst();
    if (!p || !i) return;
    title.textContent = `${i.name} · ${p.name}`;
    controls.forEach((c) => c.sync(p));
    rootSel.value = String(i.root);
    drawStatic();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    for (const id of Array.from(held.keys())) release(id);
    const b = binding;
    if (b && b.onClose) b.onClose();
  }

  function bind(b) {
    if (binding && binding !== b && !root.hidden && binding.onClose) binding.onClose();
    binding = b;
    root.hidden = false;
    onStatus("");
    refresh();
    startScreens();
    root.focus({ preventScroll: true });
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
      refresh();
    },
    close,
    onStatus,
    element: root,
  };
  return { api, bind };
}
