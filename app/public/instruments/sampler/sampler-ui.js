/**
 * The Sampler's window, in the studio's analog look: the centre LCD, a key map of the
 * loaded sound, preset stepping for SoundFonts, tuning, envelope and tone knobs, and a
 * playable keyboard. Same binding as the other synth editors (instrument-manager.js),
 * plus loadFiles({ folder }) and loadBank(source).
 */
import { RANGES, clonePatch, defaultPatch } from "./params.js?v=1";
import { applySkin, skinSelect } from "../analog.js?v=4";
import { makeScreen, drawKeymap } from "../screens.js?v=3";
import { createCenterDisplay } from "../lcd.js?v=3";
import { createKnob, createKeyboard, el, noteName } from "../panel-kit.js?v=3";

const fmt = {
  st: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} st`,
  ct: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} ct`,
  time: (v) => (v <= 0 ? "File" : v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  hz: (v) => (v >= 19999 ? "Open" : v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(v < 10000 ? 2 : 1)}k`),
  pct: (v) => `${Math.round(v * 100)}%`,
  db: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`,
};

let singleton = null;

export function openSamplerEditor(binding) {
  if (!singleton) singleton = createEditor();
  singleton.bind(binding);
  return singleton.api;
}

function btn(cls, label, icon, text) {
  const b = el("button", cls);
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = `<svg class="icon${text ? "" : " icon-solo"}" aria-hidden="true"><use href="#i-${icon}"/></svg>`;
  if (text) b.append(el("span", null, text));
  return b;
}

function createEditor() {
  let binding = null;
  let bank = null; // the loaded SoundFont / SFZ, for the key map and preset names
  let bankKey = "";
  let bankError = "";
  let litNote = null;
  const controls = [];
  const DEFAULTS = defaultPatch();

  const root = el("div", "qrt-window smp-window");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Sampler");
  root.tabIndex = -1;
  root.hidden = true;
  applySkin(root);

  // Title bar
  const bar = el("div", "qrt-titlebar");
  const brand = el("div", "qrt-brand");
  brand.append(el("span", "qrt-logo", "SAMPLER"));
  const title = el("span", "qrt-title");
  brand.append(title);
  const presetPrev = btn("qrt-btn qrt-step", "Previous preset", "chevron-left");
  const presetSel = el("select", "qrt-select qrt-preset");
  presetSel.setAttribute("aria-label", "Preset");
  const presetNext = btn("qrt-btn qrt-step", "Next preset", "chevron-right");
  const presetGroup = el("div", "qrt-presetbar");
  presetGroup.append(presetPrev, presetSel, presetNext);
  const playBtn = btn("qrt-btn qrt-play", "Hear the sound", "play", "Play");
  const closeBtn = btn("qrt-btn qrt-close", "Close", "x");
  bar.append(brand, presetGroup, playBtn, skinSelect("qrt-skin"), closeBtn);
  const status = el("div", "qrt-status");
  status.setAttribute("aria-live", "polite");
  const body = el("div", "qrt-body smp-body");
  root.append(bar, status, body);
  document.body.appendChild(root);

  const inst = () => (binding ? binding.getInstrument() : null);
  const patch = () => (inst() ? inst().patch : null);

  function change(key, value) {
    const cur = patch();
    if (!cur) return;
    const next = clonePatch(cur);
    next[key] = value;
    binding.replacePatch(next);
  }

  function card(titleText, kind, cls = "") {
    const c = el("section", `qrt-card ${cls}`.trim());
    c.dataset.kind = kind;
    const h = el("div", "qrt-card-head");
    h.append(el("h4", "qrt-card-title", titleText));
    c.append(h);
    body.append(c);
    return c;
  }

  function knob(parent, group, label, key, range, opts = {}) {
    const k = createKnob(
      Object.assign(
        {
          label,
          group,
          range,
          value: DEFAULTS[key],
          onBegin: () => binding.beginEdit(),
          onChange: (v, info) => {
            change(key, v);
            center.showParam(`${group} ${opts.full || label}`, info.text, info.frac);
          },
          onCommit: () => binding.commit(),
        },
        opts
      )
    );
    parent.append(k.el);
    controls.push({ sync: (p) => k.setValue(p[key]) });
    return k;
  }

  // Centre display
  const center = createCenterDisplay({
    brand: "SAMPLER",
    leds: [
      { id: "file", label: "Loaded" },
      { id: "loop", label: "Loops" },
      { id: "layers", label: "Layers" },
      { id: "stereo", label: "Stereo" },
    ],
  });
  const main = el("section", "qrt-main");
  main.append(center.el);
  body.append(main);

  // The sound: key map, what it holds, and loading
  const sound = card("Sound", "osc", "smp-sound");
  const map = makeScreen("smp-map");
  const info = el("div", "smp-info");
  const loadRow = el("div", "smp-load");
  const loadFile = btn("qrt-btn smp-load-btn", "Load a SoundFont (.sf2), or an .sfz with its samples", "folder-open", "Load file…");
  const loadFolder = btn("qrt-btn smp-load-btn", "Load an SFZ instrument's folder", "folder", "Load folder…");
  loadRow.append(loadFile, loadFolder);
  sound.append(map.wrap, info, loadRow);

  const tune = card("Tune", "filter");
  const tk = el("div", "pk-knobs smp-knobs");
  tune.append(tk);
  knob(tk, "Tune", "Transpose", "transpose", RANGES.transpose, { step: 1, format: fmt.st, bipolar: true });
  knob(tk, "Tune", "Fine", "fine", RANGES.fine, { step: 1, format: fmt.ct, bipolar: true });

  const shape = card("Shape", "env");
  const sk = el("div", "pk-knobs smp-knobs");
  shape.append(sk);
  knob(sk, "Shape", "Attack", "attack", RANGES.attack, { step: 0.001, format: fmt.time });
  knob(sk, "Shape", "Release", "release", RANGES.release, { step: 0.001, format: fmt.time });
  knob(sk, "Shape", "Tone", "tone", RANGES.tone, { log: true, format: fmt.hz });
  knob(sk, "Shape", "Velocity", "velocity", RANGES.velocity, { step: 0.01, format: fmt.pct, full: "Velocity sensitivity" });

  // Dock: master volume and the keyboard
  const dock = el("div", "qrt-dock");
  const m = el("section", "qrt-card qrt-master");
  m.dataset.kind = "amp";
  const mh = el("div", "qrt-card-head");
  mh.append(el("h4", "qrt-card-title", "Master"));
  m.append(mh);
  const mrow = el("div", "qrt-master-row");
  const mk = el("div", "pk-knobs");
  mrow.append(mk);
  m.append(mrow);
  knob(mk, "Master", "Volume", "volume", RANGES.volume, { step: 0.5, format: fmt.db });
  const rootRow = el("label", "qrt-row qrt-root");
  rootRow.append(el("span", "qrt-label", "Step note"));
  const rootSel = el("select", "qrt-select");
  rootSel.title = "The note the Step Rack plays";
  for (let n = 24; n <= 96; n++) rootSel.append(new Option(noteName(n), String(n)));
  rootRow.append(rootSel);
  rootSel.addEventListener("change", () => binding.setRoot(Number(rootSel.value)));
  const keyboard = createKeyboard({
    base: 48,
    onPress: () => binding.ensureAudio(),
    onNoteOn: (note, vel) => {
      const s = binding && binding.live();
      if (s) s.noteOn(note, vel, 0);
      litNote = note;
      drawMap();
      center.showParam("Note", noteName(note), null, (cv) => drawKeymap(cv, zones(), { lit: note }));
    },
    onNoteOff: (note) => {
      const s = binding && binding.live();
      if (s) s.noteOff(note, 0);
    },
    extra: rootRow,
  });
  dock.append(m, keyboard.el);
  root.append(dock);
  const phoneQ = window.matchMedia("(max-width: 760px), (max-width: 900px) and (max-height: 520px)");
  const placeMaster = () => (phoneQ.matches ? body.append(m) : dock.prepend(m));
  placeMaster();
  if (phoneQ.addEventListener) phoneQ.addEventListener("change", placeMaster);

  const presetIndex = () => {
    const p = patch();
    return p && bank ? Math.min(p.preset, bank.presets.length - 1) : 0;
  };
  const zones = () => (bank && bank.presets[presetIndex()] ? bank.presets[presetIndex()].zones : []);

  function drawMap() {
    drawKeymap(map.canvas, zones(), { lit: litNote });
  }

  function describe() {
    const p = patch();
    const zs = zones();
    if (!p || !p.source) {
      info.textContent = "No sound loaded. Load a SoundFont (.sf2), or an .sfz with its samples.";
      return;
    }
    if (bankError) {
      info.textContent = bankError;
      return;
    }
    if (!bank) {
      info.textContent = `Loading ${p.source.fileName || "the sound"}…`;
      return;
    }
    let lo = 127;
    let hi = 0;
    const vel = new Set();
    for (const z of zs) {
      lo = Math.min(lo, z.lokey);
      hi = Math.max(hi, z.hikey);
      vel.add(`${z.lovel}-${z.hivel}`);
    }
    const pr = bank.presets[presetIndex()];
    const parts = [`${zs.length} zone${zs.length === 1 ? "" : "s"}`, zs.length ? `${noteName(lo)}–${noteName(hi)}` : ""];
    if (vel.size > 1) parts.push(`${vel.size} velocity layers`);
    if (bank.kind === "sf2") parts.push(`preset ${presetIndex() + 1} of ${bank.presets.length}${pr ? ` · bank ${pr.bank} #${pr.program}` : ""}`);
    if (bank.missing && bank.missing.length) parts.push(`${bank.missing.length} samples missing`);
    info.textContent = parts.filter(Boolean).join(" · ");
  }

  function fillPresets() {
    const p = patch();
    presetSel.replaceChildren();
    if (!bank) {
      presetSel.append(new Option(p && p.source ? p.source.fileName || "Sound" : "No sound loaded", "0"));
      presetSel.disabled = true;
    } else {
      bank.presets.forEach((pr, i) => presetSel.append(new Option(`${String(i + 1).padStart(3, "0")} ${pr.name}`, String(i))));
      presetSel.disabled = bank.presets.length < 2;
      presetSel.value = String(presetIndex());
    }
    presetPrev.disabled = presetNext.disabled = presetSel.disabled;
  }

  function lights() {
    const zs = zones();
    center.setLed("file", !!bank);
    center.setLed("loop", zs.some((z) => z.loop));
    center.setLed("layers", new Set(zs.map((z) => `${z.lovel}-${z.hivel}`)).size > 1);
    center.setLed("stereo", zs.some((z) => Math.abs(z.pan) > 0.5));
  }

  /** Loads the bank the patch names (once per file) and redraws what depends on it. */
  function ensureBank() {
    const p = patch();
    const key = p && p.source ? `${p.source.kind}:${p.source.fileId}` : "";
    if (key === bankKey) return;
    bankKey = key;
    bank = null;
    bankError = "";
    if (!key) {
      staticRefresh();
      return;
    }
    staticRefresh();
    binding.loadBank(p.source).then(
      (b) => {
        if (bankKey !== key) return;
        bank = b;
        staticRefresh();
      },
      (err) => {
        if (bankKey !== key) return;
        bankError = err.message || String(err);
        staticRefresh();
      }
    );
  }

  function staticRefresh() {
    const p = patch();
    const i = inst();
    if (!p || !i) return;
    title.textContent = `${i.name} · ${bank && bank.presets[presetIndex()] ? bank.presets[presetIndex()].name : p.name}`;
    fillPresets();
    describe();
    lights();
    drawMap();
    const name = bank && bank.presets[presetIndex()] ? bank.presets[presetIndex()].name : p.source ? p.source.fileName : "No sound";
    center.setName(name, bank ? (bank.kind === "sf2" ? "SOUNDFONT" : "SFZ") : "SAMPLER");
    center.setIdle(bankError ? "Sound file missing · Load it again" : !p.source ? "Load a SoundFont or SFZ" : bank ? info.textContent : "Loading…");
    loadRow.classList.toggle("is-needed", !p.source || !!bankError);
  }

  function refresh() {
    const p = patch();
    const i = inst();
    if (!p || !i) return;
    controls.forEach((c) => c.sync(p));
    rootSel.value = String(i.root);
    ensureBank();
    staticRefresh();
  }

  const choosePreset = (idx) => {
    if (!bank) return;
    const n = bank.presets.length;
    const next = ((idx % n) + n) % n;
    binding.beginEdit();
    const cur = clonePatch(patch());
    cur.preset = next;
    cur.name = bank.presets[next].name;
    binding.replacePatch(cur);
    binding.commit();
    staticRefresh();
    center.showParam("Preset", `${next + 1} · ${bank.presets[next].name}`, null, (cv) => drawKeymap(cv, zones(), {}));
    audition();
  };
  presetSel.addEventListener("change", () => choosePreset(Number(presetSel.value)));
  presetPrev.addEventListener("click", () => choosePreset(presetIndex() - 1));
  presetNext.addEventListener("click", () => choosePreset(presetIndex() + 1));

  const load = async (folder) => {
    const ok = await binding.loadFiles({ folder });
    if (ok) {
      bankKey = "";
      refresh();
    }
  };
  loadFile.addEventListener("click", () => load(false));
  loadFolder.addEventListener("click", () => load(true));

  function audition() {
    const s = binding && binding.live();
    const i = inst();
    if (!s || !i) return;
    const ctx = binding.ensureAudio();
    const t0 = ctx.currentTime + 0.03;
    [[0, 0, 0.35], [0.25, 4, 0.35], [0.5, 7, 0.35], [0.75, 12, 0.9]].forEach(([t, st, d]) => {
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
  for (const ev of ["resize", "an-skin"]) {
    window.addEventListener(ev, () => {
      if (!root.hidden) drawMap();
    });
  }

  // The LCD's scope and VU meter move while the window is open.
  let raf = 0;
  let lastFrame = 0;
  const slow = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  function frame(now) {
    raf = 0;
    if (root.hidden) return;
    raf = requestAnimationFrame(frame);
    if (slow && now - lastFrame < 32) return;
    lastFrame = now;
    center.frame(binding && binding.live(), now);
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    keyboard.releaseAll();
    if (binding && binding.onClose) binding.onClose();
  }

  function bind(b) {
    if (binding && binding !== b && !root.hidden && binding.onClose) binding.onClose();
    binding = b;
    bankKey = "";
    root.hidden = false;
    status.textContent = "";
    center.clearParam();
    litNote = null;
    refresh();
    if (!raf) raf = requestAnimationFrame(frame);
    // Ask for the live instance now so the file starts loading before the first note.
    binding.live();
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
    onStatus(text) {
      status.textContent = text || "";
    },
    element: root,
  };
  return { api, bind };
}
