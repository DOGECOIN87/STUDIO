/**
 * Quartet's editor window, in the studio's analog look (analog.js / analog.css):
 * presets, the four oscillators, filter, both envelopes, the LFO and a master strip.
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
import { applySkin, knobParts, skinSelect } from "../analog.js?v=1";

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
  bar.append(brand, presetSel, playBtn, skinSelect("qrt-skin"), closeBtn);
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

  function knob(parent, group, label, path, range, { log = false, step = 0, format, full = label } = {}) {
    const wrap = el("div", "qrt-knob");
    const dial = el("div", "qrt-dial");
    dial.tabIndex = 0;
    dial.setAttribute("role", "slider");
    dial.setAttribute("aria-label", `${group} ${full}`);
    dial.title = full;
    dial.setAttribute("aria-valuemin", "0");
    dial.setAttribute("aria-valuemax", "1000");
    const svg = svgEl("svg", { viewBox: "0 0 60 60", "aria-hidden": "true", focusable: "false" });
    const cap = svgEl("circle", { class: "an-cap", cx: 30, cy: 30, r: 14.5 });
    const ptr = svgEl("line", { class: "an-ptr", x1: 30, y1: 30, x2: 30, y2: 17 });
    svg.append(...knobParts(), cap, ptr);
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
      val.textContent = format(value);
      dial.setAttribute("aria-valuenow", String(Math.round(t * 1000)));
      dial.setAttribute("aria-valuetext", val.textContent);
    };
    const set = (v) => {
      if (v === value) return;
      value = v;
      draw();
      change(path, v);
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

  // Oscillators
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
    });
    controls.push({
      sync(p) {
        power.setAttribute("aria-pressed", String(p.oscs[i].on));
        c.classList.toggle("is-off", !p.oscs[i].on);
      },
    });
    const g = `Oscillator ${i + 1}`;
    select(c, "Wave", ["oscs", i, "wave"], WAVES);
    const k = knobs(c);
    knob(k, g, "Octave", ["oscs", i, "octave"], RANGES.octave, { step: 1, format: fmt.oct });
    knob(k, g, "Semi", ["oscs", i, "semi"], RANGES.semi, { step: 1, format: fmt.st });
    knob(k, g, "Fine", ["oscs", i, "fine"], RANGES.fine, { step: 1, format: fmt.ct });
    knob(k, g, "Level", ["oscs", i, "level"], RANGES.level, { step: 0.01, format: fmt.pct });
    knob(k, g, "Pan", ["oscs", i, "pan"], RANGES.pan, { step: 0.01, format: fmt.pan });
    knob(k, g, "Unison", ["oscs", i, "unison"], RANGES.unison, { step: 1, format: fmt.voices });
    knob(k, g, "Spread", ["oscs", i, "spread"], RANGES.spread, { step: 1, format: fmt.ct0 });
  }

  const f = card("Filter", "filter");
  select(f, "Type", ["filter", "type"], FILTER_TYPES);
  const fk = knobs(f);
  knob(fk, "Filter", "Cutoff", ["filter", "cutoff"], RANGES.cutoff, { log: true, format: fmt.hz });
  knob(fk, "Filter", "Reso", ["filter", "reso"], RANGES.reso, { log: true, format: fmt.q });
  knob(fk, "Filter", "Env", ["filter", "env"], RANGES.env, { step: 0.01, format: fmt.bipct });
  knob(fk, "Filter", "Key", ["filter", "keytrack"], RANGES.keytrack, { step: 0.01, format: fmt.pct });

  for (const [key, name, kind] of [["ampEnv", "Level env", "amp"], ["filterEnv", "Filter env", "env"]]) {
    const e = card(name, kind);
    const ek = knobs(e);
    // Short names as printed on hardware; screen readers hear the full ones.
    knob(ek, name, "Att", [key, "a"], RANGES.a, { log: true, format: fmt.time, full: "Attack" });
    knob(ek, name, "Dec", [key, "d"], RANGES.d, { log: true, format: fmt.time, full: "Decay" });
    knob(ek, name, "Sus", [key, "s"], RANGES.s, { step: 0.01, format: fmt.pct, full: "Sustain" });
    knob(ek, name, "Rel", [key, "r"], RANGES.r, { log: true, format: fmt.time, full: "Release" });
  }

  const l = card("LFO", "mod");
  select(l, "Moves", ["lfo", "target"], LFO_TARGETS);
  select(l, "Shape", ["lfo", "shape"], LFO_SHAPES);
  const lk = knobs(l);
  knob(lk, "LFO", "Rate", ["lfo", "rate"], RANGES.rate, { log: true, format: fmt.lfoHz });
  knob(lk, "LFO", "Depth", ["lfo", "depth"], RANGES.depth, { step: 0.01, format: fmt.pct });

  const m = card("Master", "macro");
  m.classList.add("qrt-master");
  const mk = knobs(m);
  knob(mk, "Master", "Volume", ["volume"], RANGES.volume, { step: 0.5, format: fmt.db });
  knob(mk, "Master", "Velocity", ["velocity"], RANGES.velocity, { step: 0.01, format: fmt.pct });
  const rootRow = el("label", "qrt-row qrt-root");
  rootRow.append(el("span", "qrt-label", "Step note"));
  const rootSel = el("select", "qrt-select");
  rootSel.title = "The note the Step Rack plays";
  for (let n = 24; n <= 96; n++) rootSel.append(new Option(noteName(n), String(n)));
  rootRow.append(rootSel);
  m.append(rootRow);
  rootSel.addEventListener("change", () => binding.setRoot(Number(rootSel.value)));

  // Title bar actions
  presetSel.addEventListener("change", () => {
    const p = FACTORY_PRESETS[Number(presetSel.value)];
    presetSel.value = "";
    if (!p) return;
    binding.beginEdit();
    binding.replacePatch(clonePatch(p));
    binding.commit();
    refresh();
    onStatus(`Preset: ${p.name}`);
    audition();
  });
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
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    const b = binding;
    if (b && b.onClose) b.onClose();
  }

  function bind(b) {
    if (binding && binding !== b && !root.hidden && binding.onClose) binding.onClose();
    binding = b;
    root.hidden = false;
    onStatus("");
    refresh();
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
