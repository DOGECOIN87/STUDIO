/**
 * Quartet's editor window: presets, the four oscillators, filter, both envelopes,
 * the LFO and the output. Same binding as the Mammoth editor (instrument-manager.js):
 *   { instrumentId, getInstrument, live, ensureAudio, replacePatch, setRoot,
 *     beginEdit, commit, setStatus, onClose }
 * Every slider gesture is one undo step (beginEdit on press, commit on release).
 * 15px text floor, 44px touch targets on touch screens, no sideways page scroll.
 */
import { WAVES, FILTER_TYPES, LFO_TARGETS, LFO_SHAPES, RANGES, clonePatch } from "./params.js?v=1";
import { FACTORY_PRESETS } from "./presets.js?v=1";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

const fmt = {
  st: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} st`,
  ct: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} ct`,
  pct: (v) => `${Math.round(v * 100)}%`,
  bipct: (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`,
  pan: (v) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `${Math.round(-v * 100)} L` : `${Math.round(v * 100)} R`),
  hz: (v) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(v < 10000 ? 2 : 1)} kHz`),
  lfoHz: (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} Hz`,
  time: (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  q: (v) => v.toFixed(1),
  db: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`,
};

// A slider's position (0..1000) <-> value; "log" for frequencies and times.
function toPos(v, [lo, hi], log) {
  return Math.round(log ? (Math.log(v / lo) / Math.log(hi / lo)) * 1000 : ((v - lo) / (hi - lo)) * 1000);
}
function fromPos(pos, [lo, hi], log, step) {
  const t = Math.max(0, Math.min(1000, pos)) / 1000;
  let v = log ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t;
  if (step) v = Math.round(v / step) * step;
  return Math.max(lo, Math.min(hi, v));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let singleton = null;

export function openQuartetEditor(binding) {
  if (!singleton) singleton = createEditor();
  singleton.bind(binding);
  return singleton.api;
}

function createEditor() {
  let binding = null;
  const controls = []; // { sync(patch) }

  const root = el("div", "qrt-window");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Quartet synth");
  root.tabIndex = -1;
  root.hidden = true;

  // Title bar: name, preset, play, close
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
  bar.append(brand, presetSel, playBtn, closeBtn);
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

  function card(titleText, extra) {
    const c = el("section", "qrt-card");
    const h = el("div", "qrt-card-head");
    h.append(el("h4", "qrt-card-title", titleText));
    if (extra) h.append(extra);
    c.append(h);
    body.append(c);
    return c;
  }

  function slider(parent, label, path, range, { log = false, step = 0, format, bipolar = false } = {}) {
    const row = el("label", "qrt-row");
    row.append(el("span", "qrt-label", label));
    const input = el("input", "qrt-range");
    input.type = "range";
    input.min = "0";
    input.max = "1000";
    input.step = "1";
    input.setAttribute("data-silent", "");
    input.setAttribute("data-no-reset", "");
    const val = el("span", "qrt-val");
    row.append(input, val);
    parent.append(row);
    // The fill starts at zero on two-sided sliders (pitch, pan), at the left on the others.
    const origin = bipolar ? toPos(0, range, false) / 10 : 0;
    const show = (v) => {
      val.textContent = format(v);
      input.setAttribute("aria-valuetext", val.textContent);
      const pct = Number(input.value) / 10;
      input.style.setProperty("--fill-from", `${Math.min(pct, origin)}%`);
      input.style.setProperty("--fill-to", `${Math.max(pct, origin)}%`);
    };
    let editing = false;
    const begin = () => {
      if (!editing) {
        editing = true;
        binding.beginEdit();
      }
    };
    input.addEventListener("pointerdown", begin);
    input.addEventListener("keydown", (e) => {
      if (/^(Arrow|Page|Home|End)/.test(e.key)) begin();
    });
    input.addEventListener("input", () => {
      begin();
      const v = fromPos(Number(input.value), range, log, step);
      show(v);
      change(path, v);
    });
    input.addEventListener("change", () => {
      editing = false;
      binding.commit();
    });
    controls.push({
      sync(p) {
        const v = get(p, path);
        input.value = String(toPos(v, range, log));
        show(v);
      },
    });
    return input;
  }

  function select(parent, label, path, options, { number = false } = {}) {
    const row = el("label", "qrt-row qrt-row-select");
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
  const OCTAVES = [-3, -2, -1, 0, 1, 2, 3].map((n) => ({ id: n, label: n > 0 ? `+${n}` : String(n) }));
  const UNISON = [1, 2, 3, 4].map((n) => ({ id: n, label: n === 1 ? "1 (off)" : `${n} voices` }));
  for (let i = 0; i < 4; i++) {
    const toggle = el("label", "qrt-toggle");
    const box = el("input");
    box.type = "checkbox";
    box.setAttribute("aria-label", `Oscillator ${i + 1} on`);
    toggle.append(box, el("span", null, "On"));
    box.addEventListener("change", () => {
      binding.beginEdit();
      change(["oscs", i, "on"], box.checked);
      binding.commit();
      c.classList.toggle("is-off", !box.checked);
    });
    const c = card(`Oscillator ${i + 1}`, toggle);
    controls.push({
      sync(p) {
        box.checked = p.oscs[i].on;
        c.classList.toggle("is-off", !p.oscs[i].on);
      },
    });
    const pair = el("div", "qrt-pair");
    c.append(pair);
    select(pair, "Wave", ["oscs", i, "wave"], WAVES);
    select(pair, "Octave", ["oscs", i, "octave"], OCTAVES, { number: true });
    slider(c, "Semitones", ["oscs", i, "semi"], RANGES.semi, { step: 1, format: fmt.st, bipolar: true });
    slider(c, "Fine", ["oscs", i, "fine"], RANGES.fine, { step: 1, format: fmt.ct, bipolar: true });
    slider(c, "Level", ["oscs", i, "level"], RANGES.level, { step: 0.01, format: fmt.pct });
    slider(c, "Pan", ["oscs", i, "pan"], RANGES.pan, { step: 0.01, format: fmt.pan, bipolar: true });
    select(c, "Unison", ["oscs", i, "unison"], UNISON, { number: true });
    slider(c, "Spread", ["oscs", i, "spread"], RANGES.spread, { step: 1, format: (v) => `${Math.round(v)} ct` });
  }

  const f = card("Filter");
  select(f, "Type", ["filter", "type"], FILTER_TYPES);
  slider(f, "Cutoff", ["filter", "cutoff"], RANGES.cutoff, { log: true, format: fmt.hz });
  slider(f, "Resonance", ["filter", "reso"], RANGES.reso, { log: true, format: fmt.q });
  slider(f, "Envelope", ["filter", "env"], RANGES.env, { step: 0.01, format: fmt.bipct, bipolar: true });
  slider(f, "Key follow", ["filter", "keytrack"], RANGES.keytrack, { step: 0.01, format: fmt.pct });

  for (const [key, name] of [["ampEnv", "Level envelope"], ["filterEnv", "Filter envelope"]]) {
    const e = card(name);
    slider(e, "Attack", [key, "a"], RANGES.a, { log: true, format: fmt.time });
    slider(e, "Decay", [key, "d"], RANGES.d, { log: true, format: fmt.time });
    slider(e, "Sustain", [key, "s"], RANGES.s, { step: 0.01, format: fmt.pct });
    slider(e, "Release", [key, "r"], RANGES.r, { log: true, format: fmt.time });
  }

  const l = card("LFO");
  select(l, "Moves", ["lfo", "target"], LFO_TARGETS);
  select(l, "Shape", ["lfo", "shape"], LFO_SHAPES);
  slider(l, "Rate", ["lfo", "rate"], RANGES.rate, { log: true, format: fmt.lfoHz });
  slider(l, "Depth", ["lfo", "depth"], RANGES.depth, { step: 0.01, format: fmt.pct });

  const out = card("Output");
  slider(out, "Volume", ["volume"], RANGES.volume, { step: 0.5, format: fmt.db });
  slider(out, "Velocity", ["velocity"], RANGES.velocity, { step: 0.01, format: fmt.pct });
  const rootRow = el("label", "qrt-row qrt-row-select");
  rootRow.append(el("span", "qrt-label", "Step note"));
  const rootSel = el("select", "qrt-select");
  rootSel.title = "The note the Step Rack plays";
  for (let n = 24; n <= 96; n++) rootSel.append(new Option(noteName(n), String(n)));
  rootRow.append(rootSel);
  out.append(rootRow);
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
