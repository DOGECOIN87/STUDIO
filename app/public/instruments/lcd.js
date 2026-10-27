/**
 * The centre display of a synth window: a backlit dot-matrix LCD with the preset name,
 * a live scope of the sound (or, for a moment after a control moves, a picture of what
 * that control shapes), and the control's name, value and a bar graph. An analog VU
 * meter sits on its left and status LEDs on its right.
 */
import { makeScreen, drawScope, drawVu, tapOf, levelOf } from "./screens.js?v=2";

const HOLD_MS = 2400;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** leds: [{ id, label }] — the status lights on the right. */
export function createCenterDisplay({ brand, leds = [] }) {
  const row = el("div", "an-center");

  const left = el("div", "an-wing an-wing-left");
  const vu = makeScreen("an-vu");
  left.append(vu.wrap, el("span", "an-wing-label", "Output"));

  const lcd = el("div", "an-lcd");
  lcd.setAttribute("role", "status");
  lcd.setAttribute("aria-live", "off");
  const top = el("div", "an-lcd-top");
  const name = el("span", "an-lcd-name");
  const sub = el("span", "an-lcd-sub", brand || "");
  top.append(name, sub);
  const vis = el("div", "an-lcd-vis");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  vis.append(canvas);
  const bottom = el("div", "an-lcd-bottom");
  const pLabel = el("span", "an-lcd-param");
  const bar = el("span", "an-lcd-bar");
  const fill = el("span", "an-lcd-fill");
  bar.append(fill);
  bar.hidden = true;
  const pVal = el("span", "an-lcd-val");
  bottom.append(pLabel, bar, pVal);
  lcd.append(top, vis, bottom);

  const right = el("div", "an-wing an-wing-right");
  const ledEls = new Map();
  for (const l of leds) {
    const item = el("span", "an-stat");
    item.append(el("span", "an-stat-led"), el("span", "an-stat-label", l.label));
    right.append(item);
    ledEls.set(l.id, item);
  }
  row.append(left, lcd, right);

  let view = null;
  let viewUntil = 0;
  let idle = "";
  const vuState = {};

  const showIdle = () => {
    pLabel.textContent = idle;
    pVal.textContent = "";
    bar.hidden = true;
  };

  return {
    el: row,
    setName(text, subText) {
      name.textContent = String(text || "").toUpperCase();
      if (subText != null) sub.textContent = subText;
    },
    /** The bottom line when no control is moving. */
    setIdle(text) {
      idle = String(text || "").toUpperCase();
      if (!viewUntil) showIdle();
    },
    /**
     * A control moved: its name and value (and a bar when `frac` is 0..1), and for a
     * moment `draw(canvas)` instead of the scope.
     */
    showParam(label, valueText, frac = null, draw = null) {
      pLabel.textContent = String(label || "").toUpperCase();
      pVal.textContent = valueText || "";
      bar.hidden = frac == null;
      if (frac != null) fill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
      view = draw;
      viewUntil = performance.now() + HOLD_MS;
      if (view) view(canvas);
    },
    setLed(id, on) {
      const item = ledEls.get(id);
      if (item) item.classList.toggle("on", !!on);
    },
    /** A pulsing light (0..1), e.g. the LFO. */
    setLedLevel(id, level) {
      const item = ledEls.get(id);
      if (item) item.style.setProperty("--lvl", Math.max(0, Math.min(1, level)).toFixed(3));
    },
    /** Call every animation frame while the window is open. */
    frame(synth, now) {
      const tap = synth ? tapOf(synth) : null;
      drawVu(vu.canvas, levelOf(tap), vuState);
      if (viewUntil && now < viewUntil) {
        if (view) view(canvas);
        else drawScope(canvas, tap);
        return;
      }
      if (viewUntil) {
        viewUntil = 0;
        view = null;
        showIdle();
      }
      drawScope(canvas, tap);
    },
  };
}
