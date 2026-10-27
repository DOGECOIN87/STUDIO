/**
 * Parts shared by the studio's instrument windows (Quartet, Sampler, plugin windows):
 * analog knobs, rows of lit switches and a playable keyboard. Styles: analog.css.
 *
 * Knobs: drag up/down with a mouse or pen (Shift for fine moves), sideways with a
 * finger (an up/down swipe is left to scroll the window), arrow / Page / Home / End
 * keys, the wheel while focused, double-click to reset. Each gesture is one edit:
 * onBegin, any number of onChange, onCommit.
 */
import { knobParts, knobGloss, ringPath, RING_R } from "./analog.js?v=4";

const NS = "http://www.w3.org/2000/svg";
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const noteName = (n) => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

/** A knob's position (0..1000) <-> value; "log" for frequencies and times. */
export function toPos(v, [lo, hi], log) {
  return Math.round(log ? (Math.log(v / lo) / Math.log(hi / lo)) * 1000 : ((v - lo) / (hi - lo)) * 1000);
}
export function fromPos(pos, [lo, hi], log, step) {
  const t = Math.max(0, Math.min(1000, pos)) / 1000;
  let v = log ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t;
  if (step) v = Math.round(v / step) * step;
  return Math.max(lo, Math.min(hi, Number(v.toFixed(6))));
}

const knobPoint = (r, t) => {
  const a = ((-135 + 270 * t) * Math.PI) / 180;
  return [30 + r * Math.sin(a), 30 - r * Math.cos(a)];
};

/**
 * @param {{label: string, full?: string, group?: string, range: [number, number], log?: boolean,
 *   step?: number, format: (v:number)=>string, bipolar?: boolean, value: number, def?: number,
 *   onBegin?: Function, onChange?: (v:number, info:{text:string, frac:number})=>void, onCommit?: Function}} o
 */
export function createKnob(o) {
  const { label, full = label, group = "", range, log = false, step = 0, format, bipolar = false } = o;
  const def = o.def == null ? o.value : o.def;
  const wrap = el("div", "pk-knob");
  const dial = el("div", "pk-dial");
  dial.tabIndex = 0;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", `${group} ${full}`.trim());
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
  // Two-sided knobs (tuning, pan) light their ring from the middle.
  const origin = bipolar ? toPos(0, range, false) / 1000 : 0;
  dial.append(svg);
  const val = el("span", "pk-knob-value");
  wrap.append(dial, el("span", "pk-knob-label", label), val);

  let value = o.value;
  const frac = () => Math.max(0, Math.min(1000, toPos(value, range, log))) / 1000;
  const draw = () => {
    const t = frac();
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
  const begin = () => o.onBegin && o.onBegin();
  const commit = () => o.onCommit && o.onCommit();
  const set = (v) => {
    if (v === value) return;
    value = v;
    draw();
    if (o.onChange) o.onChange(v, { text: val.textContent, frac: frac() });
  };
  const coarse = step && (range[1] - range[0]) / step <= 48; // stepped knobs move one step per key
  const nudge = (dir, big) => {
    if (coarse) set(Math.max(range[0], Math.min(range[1], value + dir * step * (big ? 4 : 1))));
    else set(fromPos(toPos(value, range, log) + dir * (big ? 100 : 10), range, log, step));
  };

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
        dial.classList.add("is-turning");
        begin();
      }
      const px = touch ? dx : -dy;
      set(fromPos(p0 + px * (ev.shiftKey ? 1.4 : 5.6), range, log, step));
    };
    const up = (ev) => {
      if (ev.pointerId === e.pointerId) end();
    };
    const end = () => {
      dial.removeEventListener("pointermove", move);
      dial.removeEventListener("pointerup", up);
      dial.removeEventListener("pointercancel", up);
      dial.classList.remove("is-turning");
      if (began) commit();
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
      begin();
    }
    if (k === "min") set(range[0]);
    else if (k === "max") set(range[1]);
    else nudge(Math.sign(k), Math.abs(k) > 1);
  });
  dial.addEventListener("keyup", () => {
    if (keyEdit) {
      keyEdit = false;
      commit();
    }
  });
  dial.addEventListener(
    "wheel",
    (e) => {
      if (document.activeElement !== dial) return;
      e.preventDefault();
      begin();
      nudge(e.deltaY < 0 ? 1 : -1, false);
      commit();
    },
    { passive: false }
  );
  dial.addEventListener("dblclick", () => {
    begin();
    set(def);
    commit();
  });

  draw();
  return {
    el: wrap,
    /** Shows a value without reporting a change (after undo, a preset, …). */
    setValue(v) {
      value = v;
      draw();
    },
    getValue: () => value,
  };
}

/** A row of lit switches, one on (wave shapes, filter types, modes). */
export function createSwitches({ group, options, value, icons = null, onSelect }) {
  const row = el("div", "an-switches");
  row.setAttribute("role", "radiogroup");
  row.setAttribute("aria-label", group);
  const btns = options.map((opt) => {
    const b = el("button", "an-sw");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", opt.label);
    b.title = opt.label;
    b.append(el("span", "an-sw-led"));
    if (icons && icons[opt.id]) {
      const svg = svgEl("svg", { viewBox: "0 0 22 16", "aria-hidden": "true", focusable: "false" });
      svg.append(svgEl("path", { d: icons[opt.id] }));
      b.append(svg);
    } else {
      b.append(el("span", "an-sw-text", opt.short || opt.label));
    }
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-checked") === "true") return;
      setValue(opt.id);
      if (onSelect) onSelect(opt.id, opt);
    });
    row.append(b);
    return [opt.id, b];
  });
  const setValue = (v) => btns.forEach(([id, b]) => b.setAttribute("aria-checked", String(id === v)));
  setValue(value);
  return { el: row, setValue };
}

/**
 * A playable keyboard: two octaves (one on phones; analog.css hides the second),
 * octave buttons, and room for extra controls in its bar. Slide a finger across the
 * keys to glide; how far down a key is pressed sets the velocity.
 */
export function createKeyboard({ base = 60, onNoteOn, onNoteOff, onPress, extra = null }) {
  const kb = el("div", "pk-kb");
  const bar = el("div", "pk-kb-bar");
  const mk = (label, icon) => {
    const b = el("button", "pk-btn pk-oct");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.innerHTML = `<svg class="icon icon-solo" aria-hidden="true"><use href="#i-${icon}"/></svg>`;
    return b;
  };
  const octDown = mk("Keyboard down an octave", "chevron-left");
  const octLabel = el("span", "pk-oct-label");
  const octUp = mk("Keyboard up an octave", "chevron-right");
  bar.append(octDown, octLabel, octUp);
  if (extra) bar.append(extra);
  const keys = el("div", "pk-keys");
  keys.setAttribute("aria-label", "Keyboard");
  kb.append(bar, keys);

  let kbBase = base;
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const keyEls = [];
  for (let n = 0; n <= 24; n++) {
    const black = BLACK.has(n % 12);
    const k = el("div", `pk-key ${black ? "pk-key-b" : "pk-key-w"}${n >= 12 ? " pk-oct2" : ""}`);
    k.dataset.n = String(n);
    if (!black && n % 12 === 0) k.append(el("span", "pk-key-lbl"));
    keys.append(k);
    keyEls.push(k);
  }
  // Black keys sit over the gap after their white key (placed by --wi out of --whites).
  let whiteIndex = 0;
  keyEls.forEach((k) => {
    if (k.classList.contains("pk-key-w")) whiteIndex++;
    else k.style.setProperty("--wi", String(whiteIndex));
  });
  const labelKeys = () => {
    octLabel.textContent = `${noteName(kbBase)}–${noteName(kbBase + 24)}`;
    keyEls.forEach((k) => {
      const lbl = k.querySelector(".pk-key-lbl");
      if (lbl) lbl.textContent = noteName(kbBase + Number(k.dataset.n));
    });
  };
  labelKeys();
  octDown.addEventListener("click", () => {
    kbBase = Math.max(12, kbBase - 12);
    labelKeys();
  });
  octUp.addEventListener("click", () => {
    kbBase = Math.min(96, kbBase + 12);
    labelKeys();
  });
  const held = new Map(); // pointerId -> { note, el }
  const keyAt = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    return hit && hit.closest ? hit.closest(".pk-key") : null;
  };
  const release = (pointerId) => {
    const h = held.get(pointerId);
    if (!h) return;
    held.delete(pointerId);
    if (onNoteOff) onNoteOff(h.note);
    h.el.classList.remove("down");
  };
  const press = (pointerId, keyEl, y) => {
    const prev = held.get(pointerId);
    if (prev && prev.el === keyEl) return;
    if (prev) release(pointerId);
    if (!keyEl || !keys.contains(keyEl)) return;
    const note = Math.max(0, Math.min(127, kbBase + Number(keyEl.dataset.n)));
    const r = keyEl.getBoundingClientRect();
    const vel = Math.max(0.35, Math.min(1, 0.4 + 0.6 * ((y - r.top) / Math.max(1, r.height))));
    if (onNoteOn) onNoteOn(note, vel);
    keyEl.classList.add("down");
    held.set(pointerId, { note, el: keyEl });
  };
  keys.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (onPress) onPress();
    press(e.pointerId, keyAt(e.clientX, e.clientY), e.clientY);
  });
  keys.addEventListener("pointermove", (e) => {
    if (held.has(e.pointerId)) press(e.pointerId, keyAt(e.clientX, e.clientY), e.clientY);
  });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) keys.addEventListener(t, (e) => release(e.pointerId));

  return {
    el: kb,
    releaseAll() {
      for (const id of Array.from(held.keys())) release(id);
    },
    /** Lights the keys of notes playing from elsewhere (MIDI, the step rack). */
    showNote(note, on) {
      const n = note - kbBase;
      const k = keyEls[n];
      if (k) k.classList.toggle("lit", !!on);
    },
  };
}

/**
 * A console fader: drag the cap (or anywhere on the slot) up and down, Shift for fine
 * moves; arrow keys (Page keys for big steps), the wheel while focused, double-click
 * for `def`. Works the same in every browser (no vertical range input needed).
 * Each gesture is one edit: onBegin, onChange…, onCommit.
 */
export function createFader({ label, value, min, max, step = 0.1, def = 0, format, onBegin, onChange, onCommit, marks = [], minor = [] }) {
  const wrap = el("div", "pk-fader");
  const scale = el("div", "pk-fader-scale");
  scale.setAttribute("aria-hidden", "true");
  const slot = el("div", "pk-fader-slot");
  const cap = el("div", "pk-fader-cap");
  slot.append(cap);
  wrap.append(scale, slot);
  slot.tabIndex = 0;
  slot.setAttribute("role", "slider");
  slot.setAttribute("aria-label", label);
  slot.setAttribute("aria-orientation", "vertical");
  slot.setAttribute("aria-valuemin", String(min));
  slot.setAttribute("aria-valuemax", String(max));
  const frac = (v) => (v - min) / (max - min);
  for (const m of marks) {
    const tick = el("span", "pk-fader-mark", m > 0 ? `+${m}` : String(m));
    tick.style.bottom = `${(frac(m) * 100).toFixed(2)}%`;
    if (m === 0) tick.classList.add("is-zero");
    // Minor marks hide on short faders (analog / styles CSS), so the numbers never collide.
    if (minor.indexOf(m) >= 0) tick.classList.add("is-minor");
    scale.append(tick);
  }
  let v = value;
  const draw = () => {
    cap.style.bottom = `${(frac(v) * 100).toFixed(2)}%`;
    slot.style.setProperty("--fill", `${(frac(v) * 100).toFixed(2)}%`);
    slot.setAttribute("aria-valuenow", String(v));
    slot.setAttribute("aria-valuetext", format ? format(v) : String(v));
  };
  const snap = (x) => Math.max(min, Math.min(max, Math.round(x / step) * step));
  const set = (x) => {
    const n = Number(snap(x).toFixed(4));
    if (n === v) return;
    v = n;
    draw();
    if (onChange) onChange(v);
  };
  slot.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    e.preventDefault();
    slot.focus({ preventScroll: true });
    try {
      slot.setPointerCapture(e.pointerId);
    } catch (_) {}
    const y0 = e.clientY;
    const v0 = v;
    const h = Math.max(40, slot.getBoundingClientRect().height);
    let began = false;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!began) {
        began = true;
        slot.classList.add("is-moving");
        if (onBegin) onBegin();
      }
      const d = ((y0 - ev.clientY) / h) * (max - min) * (ev.shiftKey ? 0.25 : 1);
      set(v0 + d);
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      slot.removeEventListener("pointermove", move);
      slot.removeEventListener("pointerup", up);
      slot.removeEventListener("pointercancel", up);
      slot.classList.remove("is-moving");
      if (began && onCommit) onCommit();
    };
    slot.addEventListener("pointermove", move);
    slot.addEventListener("pointerup", up);
    slot.addEventListener("pointercancel", up);
  });
  let keyEdit = false;
  slot.addEventListener("keydown", (e) => {
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 6, PageDown: -6, Home: "min", End: "max" }[e.key];
    if (k == null || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!keyEdit) {
      keyEdit = true;
      if (onBegin) onBegin();
    }
    if (k === "min") set(min);
    else if (k === "max") set(max);
    else set(v + k * Math.max(step, 0.5));
  });
  slot.addEventListener("keyup", () => {
    if (keyEdit) {
      keyEdit = false;
      if (onCommit) onCommit();
    }
  });
  slot.addEventListener(
    "wheel",
    (e) => {
      if (document.activeElement !== slot) return;
      e.preventDefault();
      if (onBegin) onBegin();
      set(v + (e.deltaY < 0 ? 0.5 : -0.5));
      if (onCommit) onCommit();
    },
    { passive: false }
  );
  slot.addEventListener("dblclick", () => {
    if (onBegin) onBegin();
    set(def);
    if (onCommit) onCommit();
  });
  draw();
  return {
    el: wrap,
    setValue(x) {
      v = x;
      draw();
    },
  };
}
