/**
 * Gate Shaper window: preset grids, a drag-to-draw 16-step volume editor with a
 * time-section overlay, rate / sync / attack / release / depth controls and a live playhead.
 * Edits a track insert, or the master bus. Audio itself lives in gate-shaper.js.
 */
import {
  GS_RATES,
  GS_STEPS,
  GS_SYNC_OPTIONS,
  GS_TIME_NAMES,
  GS_VOLUME_NAMES,
  GS_VOLUME_PRESETS,
  defaultGateFx,
  effectiveVolume,
  gateStepIndexAt,
  normalizeGateFx,
  timeSectionActive,
  timeSourceFor,
} from "./gate-shaper.js";

const MASTER = "master";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {object} deps
 *  - getProject(): current project object
 *  - getSelectedTrackId(): id of the track selected in the mixer / playlist
 *  - beginEdit(): called once before a gesture mutates the project (undo snapshot)
 *  - commit(statusText): called after a discrete change (full UI refresh)
 *  - refreshAudio(): called during live gestures (re-schedules playback if running)
 *  - setRange(inputEl, value): sets a range input and its fill
 *  - getPlayback(): { beat, passStart, playing }
 */
export function initGateShaper(deps) {
  const win = $("gate-shaper-window");
  if (!win) return null;

  const ui = {
    target: $("gs-target"),
    targetLabel: $("gs-target-label"),
    close: $("btn-close-gate-shaper"),
    timeOn: $("gs-time-on"),
    hold: $("gs-hold"),
    timePresets: $("gs-time-presets"),
    volOn: $("gs-vol-on"),
    volPresets: $("gs-vol-presets"),
    canvas: $("gs-canvas"),
    readout: $("gs-readout"),
    rates: $("gs-rates"),
    att: $("gs-att"),
    rel: $("gs-rel"),
    ins: $("gs-ins"),
    trig: $("gs-trig"),
    pos: $("gs-pos"),
    toggle: $("btn-toggle-gate"),
    fxSlot: $("fx-slot-gate"),
    fxLed: $("fx-led-gate"),
    fxSlotText: $("fx-slot-gate-name"),
  };

  // null = follow the track selected in the mixer; otherwise a track id or MASTER.
  let targetKey = null;
  let drawing = false;
  let presetButtonsByName = { time: new Map(), vol: new Map() };
  let rateButtons = new Map();
  let lastTargetSignature = "";
  let lastCanvasSize = "";

  /* ---------- target resolution ---------- */

  function resolveTargetKey() {
    const project = deps.getProject();
    const hasTrack = (id) => project.tracks.some((t) => t.id === id);
    if (targetKey === MASTER) return MASTER;
    if (targetKey && hasTrack(targetKey)) return targetKey;
    const selected = deps.getSelectedTrackId();
    if (selected && hasTrack(selected)) return selected;
    return MASTER;
  }

  function targetLabelFor(key) {
    if (key === MASTER) return "Master";
    const track = deps.getProject().tracks.find((t) => t.id === key);
    return track ? track.name.replace(/^\d+\s*·\s*/, "") : "Track";
  }

  /** Normalised, stored Gate Shaper state for the current target (always writable). */
  function currentFx() {
    const project = deps.getProject();
    const key = resolveTargetKey();
    if (key === MASTER) {
      project.masterGateFx = normalizeGateFx(project.masterGateFx);
      return project.masterGateFx;
    }
    const track = project.tracks.find((t) => t.id === key);
    if (!track) return null;
    track.gateFx = normalizeGateFx(track.gateFx);
    return track.gateFx;
  }

  function selectedTrackFx() {
    const project = deps.getProject();
    const selected = deps.getSelectedTrackId();
    const track = project.tracks.find((t) => t.id === selected);
    return track ? normalizeGateFx(track.gateFx) : null;
  }

  /* ---------- building static parts ---------- */

  function buildPresetGrid(container, names, kind) {
    container.innerHTML = "";
    const map = presetButtonsByName[kind];
    map.clear();
    for (const name of names) {
      const btn = el("button", "gs-preset", name);
      btn.type = "button";
      btn.dataset.preset = name;
      btn.setAttribute("aria-pressed", "false");
      btn.title = kind === "vol" ? `Volume gate: ${name}` : `Time repeat: ${name}`;
      btn.addEventListener("click", () => choosePreset(kind, name));
      container.appendChild(btn);
      map.set(name, btn);
    }
  }

  function buildRates() {
    ui.rates.innerHTML = "";
    ui.rates.appendChild(el("span", "gs-group-label", "Rate"));
    for (const rate of GS_RATES) {
      const btn = el("button", "gs-chip", rate.id);
      btn.type = "button";
      btn.dataset.rate = rate.id;
      btn.setAttribute("aria-pressed", "false");
      btn.title = `Each step lasts ${rate.id} of a whole note`;
      btn.addEventListener("click", () =>
        edit(`Gate rate ${rate.id}`, (fx) => {
          fx.rate = rate.id;
        })
      );
      ui.rates.appendChild(btn);
      rateButtons.set(rate.id, btn);
    }
  }

  function buildSyncSelect(select, label) {
    select.innerHTML = "";
    for (const beats of GS_SYNC_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = String(beats);
      opt.textContent = beats === 0 ? "Off" : `${beats} beats`;
      select.appendChild(opt);
    }
    select.setAttribute("aria-label", label);
  }

  function refreshTargetOptions() {
    const project = deps.getProject();
    const signature = project.tracks.map((t) => `${t.id}:${t.name}`).join("|");
    if (signature === lastTargetSignature) return;
    lastTargetSignature = signature;
    ui.target.innerHTML = "";
    const master = document.createElement("option");
    master.value = MASTER;
    master.textContent = "Master bus";
    ui.target.appendChild(master);
    for (const track of project.tracks) {
      const opt = document.createElement("option");
      opt.value = track.id;
      opt.textContent = track.name;
      ui.target.appendChild(opt);
    }
  }

  /* ---------- edits ---------- */

  /** Discrete edit: undo snapshot, change, full refresh. */
  function edit(label, mutate) {
    const key = resolveTargetKey();
    deps.beginEdit();
    const fx = currentFx();
    if (!fx) return;
    mutate(fx);
    deps.commit(`${targetLabelFor(key)} · ${label}`);
  }

  /** Continuous edit (slider drags, canvas painting): audio update per frame, commit at release. */
  function liveEdit(mutate) {
    const fx = currentFx();
    if (!fx) return;
    mutate(fx);
    deps.refreshAudio();
    render();
  }

  function choosePreset(kind, name) {
    if (kind === "vol") {
      edit(`Volume · ${name}`, (fx) => {
        fx.volPreset = name;
        fx.volLevels = GS_VOLUME_PRESETS[name].slice();
        fx.volOn = true;
      });
    } else {
      edit(`Time · ${name}`, (fx) => {
        fx.timePreset = name;
        fx.timeOn = true;
      });
    }
  }

  function bindEditor() {
    const canvas = ui.canvas;
    const geometry = () => {
      const rect = canvas.getBoundingClientRect();
      const timeH = 30;
      return {
        w: rect.width,
        h: rect.height,
        timeH,
        volH: Math.max(1, rect.height - timeH - 6),
        colW: rect.width / GS_STEPS,
      };
    };

    const paintAt = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const g = geometry();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const col = Math.min(GS_STEPS - 1, Math.max(0, Math.floor(x / g.colW)));
      const level = Math.min(1, Math.max(0, 1 - (y - 4) / (g.volH - 4)));
      liveEdit((fx) => {
        fx.volLevels[col] = Math.round(level * 100) / 100;
        fx.volPreset = "Custom";
        fx.volOn = true;
      });
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const rect = canvas.getBoundingClientRect();
      if (e.clientY - rect.top > geometry().volH + 4) return; // time row is display-only
      drawing = true;
      deps.beginEdit();
      canvas.setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (drawing) paintAt(e.clientX, e.clientY);
    });
    const finish = () => {
      if (!drawing) return;
      drawing = false;
      deps.commit(`${targetLabelFor(resolveTargetKey())} · Volume pattern edited`);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
  }

  function bindControls() {
    ui.target.addEventListener("change", () => {
      targetKey = ui.target.value;
      render();
    });

    ui.timeOn.addEventListener("click", () => edit("Time section", (fx) => (fx.timeOn = !fx.timeOn)));
    ui.hold.addEventListener("click", () => edit("Hold", (fx) => (fx.hold = !fx.hold)));
    ui.volOn.addEventListener("click", () => edit("Volume gate", (fx) => (fx.volOn = !fx.volOn)));

    ui.trig.addEventListener("change", () =>
      edit("Trig sync", (fx) => {
        fx.trigSync = Number(ui.trig.value);
      })
    );
    ui.pos.addEventListener("change", () =>
      edit("Pos sync", (fx) => {
        fx.posSync = Number(ui.pos.value);
      })
    );

    const sliders = [
      [ui.att, "att", "Attack"],
      [ui.rel, "rel", "Release"],
      [ui.ins, "ins", "Depth"],
    ];
    for (const [input, key, label] of sliders) {
      // Undo snapshot once per drag or key-press gesture, then live updates while moving.
      const begin = () => deps.beginEdit();
      input.addEventListener("pointerdown", begin);
      input.addEventListener("keydown", begin);
      input.addEventListener("input", () => {
        liveEdit((fx) => {
          fx[key] = Number(input.value);
        });
      });
      input.addEventListener("change", () => deps.commit(`${targetLabelFor(resolveTargetKey())} · ${label} ${input.value}`));
    }

    ui.close.addEventListener("click", () => setOpen(false));
    ui.toggle.addEventListener("click", () => setOpen(win.classList.contains("collapsed")));
    ui.fxSlot.addEventListener("click", () => {
      targetKey = deps.getSelectedTrackId() || MASTER;
      setOpen(true);
    });
    ui.fxSlot.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        ui.fxSlot.click();
      }
    });

    window.addEventListener("resize", () => drawFrame());
  }

  function setOpen(open) {
    win.classList.toggle("collapsed", !open);
    ui.toggle.setAttribute("aria-pressed", String(open));
    ui.toggle.classList.toggle("active", open);
    ui.fxSlot.classList.toggle("active", open);
    if (open) {
      render();
    }
    if (typeof deps.onWindowToggled === "function") deps.onWindowToggled(open);
  }

  /* ---------- rendering ---------- */

  function setPressed(btn, on) {
    btn.setAttribute("aria-pressed", String(!!on));
    btn.classList.toggle("on", !!on);
  }

  function render() {
    refreshTargetOptions();
    const key = resolveTargetKey();
    ui.target.value = key;
    ui.targetLabel.textContent = targetLabelFor(key);

    const fx = currentFx();
    if (!fx) return;

    setPressed(ui.timeOn, fx.timeOn);
    setPressed(ui.hold, fx.hold);
    setPressed(ui.volOn, fx.volOn);
    ui.timeOn.textContent = fx.timeOn ? "On" : "Off";
    ui.volOn.textContent = fx.volOn ? "On" : "Off";

    for (const [name, btn] of presetButtonsByName.time) {
      const active = fx.timePreset === name;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    for (const [name, btn] of presetButtonsByName.vol) {
      const active = fx.volPreset === name;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    for (const [id, btn] of rateButtons) {
      const active = fx.rate === id;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }

    deps.setRange(ui.att, fx.att);
    deps.setRange(ui.rel, fx.rel);
    deps.setRange(ui.ins, fx.ins);
    ui.trig.value = String(fx.trigSync);
    ui.pos.value = String(fx.posSync);
    ui.att.setAttribute("aria-valuetext", `${fx.att} ms`);
    ui.rel.setAttribute("aria-valuetext", `${fx.rel} ms`);
    ui.ins.setAttribute("aria-valuetext", `${fx.ins} %`);

    const volText = fx.volOn ? fx.volPreset : "off";
    const timeText = timeSectionActive(fx) ? (fx.hold ? `${fx.timePreset} (held)` : fx.timePreset) : "off";
    ui.readout.textContent = `Volume: ${volText}  ·  Time: ${timeText}  ·  Rate ${fx.rate}`;

    // Mixer FX slot shows the state of the selected track's insert.
    const sel = selectedTrackFx();
    const active = !!sel && (sel.volOn || timeSectionActive(sel));
    if (ui.fxLed) ui.fxLed.classList.toggle("on", active);
    if (ui.fxSlotText) ui.fxSlotText.textContent = active ? "Gate Shaper · on" : "Gate Shaper";

    drawFrame();
  }

  function cssColor(name, fallback) {
    const v = getComputedStyle(win).getPropertyValue(name).trim();
    return v || fallback;
  }

  function drawFrame() {
    if (win.classList.contains("collapsed")) return;
    const canvas = ui.canvas;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = window.devicePixelRatio || 1;
    const sizeKey = `${cssW}x${cssH}@${dpr}`;
    if (sizeKey !== lastCanvasSize) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      lastCanvasSize = sizeKey;
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    const fx = currentFx();
    if (!fx) return;

    const bg = cssColor("--bg-darkest", "#1B1C2A");
    const grid = cssColor("--border-color", "#3C425D");
    const accent = cssColor("--accent-amber", "#C67CFF");
    const teal = cssColor("--accent-teal", "#1BA1F1");
    const text = cssColor("--text-muted", "#A6AAC0");
    const playhead = cssColor("--accent-green", "#15D864");

    const timeH = 30;
    const volH = Math.max(1, cssH - timeH - 6);
    const colW = cssW / GS_STEPS;

    g.fillStyle = bg;
    g.fillRect(0, 0, cssW, cssH);

    // Vertical grid: every step, with a stronger line every beat-group of four.
    for (let i = 0; i <= GS_STEPS; i++) {
      g.globalAlpha = i % 4 === 0 ? 0.9 : 0.35;
      g.fillStyle = grid;
      g.fillRect(Math.round(i * colW), 0, 1, cssH);
    }
    g.globalAlpha = 0.5;
    // Horizontal guides at 25/50/75/100 %.
    for (const f of [0.25, 0.5, 0.75]) {
      g.fillRect(0, Math.round(4 + (volH - 4) * (1 - f)), cssW, 1);
    }
    g.globalAlpha = 1;
    g.fillRect(0, volH + 4, cssW, 1);

    // Volume: ghost = drawn level, solid = level after depth (what you hear).
    for (let i = 0; i < GS_STEPS; i++) {
      const raw = fx.volLevels[i];
      const eff = effectiveVolume(raw, fx.ins);
      const x = i * colW + 3;
      const w = Math.max(2, colW - 6);
      const rawTop = 4 + (1 - raw) * (volH - 4);
      const effTop = 4 + (1 - eff) * (volH - 4);
      g.globalAlpha = fx.volOn ? 0.18 : 0.08;
      g.fillStyle = accent;
      g.fillRect(x, rawTop, w, volH - rawTop);
      g.globalAlpha = fx.volOn ? 0.95 : 0.35;
      g.fillRect(x, effTop, w, volH - effTop);
    }
    g.globalAlpha = 1;

    // Time row: a bar from the source step to the step that replays it.
    const timeOn = timeSectionActive(fx);
    const rowTop = volH + 10;
    for (let i = 0; i < GS_STEPS; i++) {
      const src = timeOn ? timeSourceFor(fx, i) : i;
      const cx = i * colW + colW / 2;
      g.fillStyle = text;
      g.globalAlpha = 0.45;
      g.fillRect(cx - 1, rowTop + 2, 2, 2);
      if (timeOn && src < i) {
        const sx = src * colW + colW / 2;
        g.globalAlpha = 0.9;
        g.fillStyle = teal;
        g.fillRect(sx, rowTop + 8, cx - sx + colW * 0.6, 4);
        g.beginPath();
        g.arc(sx, rowTop + 10, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // Live playhead.
    const pb = deps.getPlayback();
    if (pb && pb.playing) {
      const col = gateStepIndexAt(fx, pb.beat, pb.passStart);
      g.globalAlpha = 0.16;
      g.fillStyle = playhead;
      g.fillRect(col * colW, 0, colW, cssH);
      g.globalAlpha = 1;
      g.fillRect(col * colW, 0, 2, cssH);
    }

    // Empty-state hint when nothing is active.
    if (!fx.volOn && !timeOn) {
      g.globalAlpha = 0.8;
      g.fillStyle = text;
      g.font = '600 15px "Avenir Next LT Pro", "DM Sans", system-ui, sans-serif';
      g.textAlign = "center";
      g.fillText("Turn on Volume or Time, or drag bars to draw a gate", cssW / 2, volH / 2 + 4);
      g.globalAlpha = 1;
      g.textAlign = "start";
    }
  }

  /* ---------- init ---------- */

  function init() {
    buildPresetGrid(ui.timePresets, GS_TIME_NAMES, "time");
    buildPresetGrid(ui.volPresets, GS_VOLUME_NAMES, "vol");
    buildRates();
    buildSyncSelect(ui.trig, "Trigger sync");
    buildSyncSelect(ui.pos, "Position sync");
    bindEditor();
    bindControls();
    render();
  }

  init();

  return {
    render,
    drawFrame,
    isOpen: () => !win.classList.contains("collapsed"),
    open: () => setOpen(true),
    close: () => setOpen(false),
    setOpen,
    /** Call after the project changes outside this window (track selection, load, undo). */
    refresh: () => {
      if (!win.classList.contains("collapsed")) render();
      else {
        const sel = selectedTrackFx();
        const active = !!sel && (sel.volOn || timeSectionActive(sel));
        if (ui.fxLed) ui.fxLed.classList.toggle("on", active);
      }
    },
    defaults: defaultGateFx,
  };
}
