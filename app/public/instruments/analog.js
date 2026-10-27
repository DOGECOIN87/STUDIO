/**
 * The analog look shared by the studio's synth windows (Mammoth, Quartet):
 * the skin choice (remembered on this device), the knobs' metal gradients and the
 * printed parts of a knob (tick marks and skirt) for a 60×60 knob drawing.
 */
export const SKINS = [
  { id: "vintage", label: "Vintage black" },
  { id: "studio", label: "Studio red" },
  { id: "silver", label: "Silver" },
];
const KEY = "audius_studio_synth_skin_v1";
const NS = "http://www.w3.org/2000/svg";
const windows = new Set();

export function getSkin() {
  try {
    const v = localStorage.getItem(KEY);
    return SKINS.some((s) => s.id === v) ? v : "studio";
  } catch (_) {
    return "studio";
  }
}

/** Gives a synth window the analog look in the current skin. */
export function applySkin(root) {
  ensureDefs();
  addScrews(root);
  windows.add(root);
  root.classList.add("analog");
  root.dataset.skin = getSkin();
}

export function setSkin(id) {
  if (!SKINS.some((s) => s.id === id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch (_) {}
  windows.forEach((w) => (w.dataset.skin = id));
  document.querySelectorAll(".an-skin-select").forEach((s) => (s.value = id));
  // Canvas screens take their colours when drawn: tell the windows to redraw them.
  window.dispatchEvent(new CustomEvent("an-skin", { detail: id }));
}

/** A small "Look" picker for a window's title bar. */
export function skinSelect(className = "") {
  const sel = document.createElement("select");
  sel.className = `an-skin-select ${className}`.trim();
  sel.setAttribute("aria-label", "Look");
  sel.title = "The synth windows' look";
  SKINS.forEach((s) => sel.append(new Option(s.label, s.id)));
  sel.value = getSkin();
  sel.addEventListener("change", () => setSkin(sel.value));
  return sel;
}

/** The metal and plastic gradients the knobs are filled with (added to the page once). */
export function ensureDefs() {
  if (document.getElementById("an-defs")) return;
  const svg = document.createElementNS(NS, "svg");
  svg.id = "an-defs";
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML = `<defs>
    <radialGradient id="an-skirt" cx="0.5" cy="0.38" r="0.62">
      <stop offset="0" stop-color="#46464a"/><stop offset="0.72" stop-color="#18181a"/><stop offset="1" stop-color="#070708"/>
    </radialGradient>
    <radialGradient id="an-cap-dark" cx="0.36" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#77777c"/><stop offset="0.42" stop-color="#2e2e31"/><stop offset="1" stop-color="#121214"/>
    </radialGradient>
    <radialGradient id="an-cap-chrome" cx="0.36" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.28" stop-color="#dfe2e7"/><stop offset="0.62" stop-color="#8e939b"/><stop offset="1" stop-color="#43464c"/>
    </radialGradient>
    <linearGradient id="an-bevel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9a9aa0"/><stop offset="0.5" stop-color="#3a3a3e"/><stop offset="1" stop-color="#0c0c0d"/>
    </linearGradient>
    <radialGradient id="an-cap-gold" cx="0.36" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#fff6d8"/><stop offset="0.3" stop-color="#e9c97a"/><stop offset="0.7" stop-color="#9c7a2e"/><stop offset="1" stop-color="#5a4314"/>
    </radialGradient>
    <radialGradient id="an-cap-cream" cx="0.36" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#fffdf6"/><stop offset="0.5" stop-color="#e9e0cc"/><stop offset="1" stop-color="#a99d84"/>
    </radialGradient>
  </defs>`;
  document.body.appendChild(svg);
}

/** Radius of the value ring around a knob (60×60 drawing), and of the first modulation ring outside it. */
export const RING_R = 25;
export const MOD_R0 = 28.8;
export const MOD_DR = 2.6;

const circle = (cls, cx, cy, r) => {
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("class", cls);
  c.setAttribute("cx", String(cx));
  c.setAttribute("cy", String(cy));
  c.setAttribute("r", String(r));
  return c;
};

/**
 * What sits under a knob's value ring and cap, for a 60×60 drawing centred on 30,30:
 * a soft shadow, the knurled skirt (grip lines all round) and the cap's bevelled rim.
 */
export function knobParts() {
  const knurl = document.createElementNS(NS, "g");
  knurl.setAttribute("class", "an-knurl");
  for (let i = 0; i < 36; i++) {
    const a = (i * 10 * Math.PI) / 180;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", (30 + 17.6 * Math.sin(a)).toFixed(2));
    line.setAttribute("y1", (30 - 17.6 * Math.cos(a)).toFixed(2));
    line.setAttribute("x2", (30 + 20.6 * Math.sin(a)).toFixed(2));
    line.setAttribute("y2", (30 - 20.6 * Math.cos(a)).toFixed(2));
    knurl.appendChild(line);
  }
  return [circle("an-shadow", 30, 32.2, 21.6), circle("an-skirt", 30, 30, 21), knurl, circle("an-bevel", 30, 30, 15.6)];
}

/** The polished highlight on a knob's cap: put it after the cap, before the pointer. */
export function knobGloss() {
  const e = document.createElementNS(NS, "ellipse");
  e.setAttribute("class", "an-gloss");
  e.setAttribute("cx", "26.5");
  e.setAttribute("cy", "24.5");
  e.setAttribute("rx", "7.5");
  e.setAttribute("ry", "4.2");
  e.setAttribute("transform", "rotate(-28 26.5 24.5)");
  return e;
}

/** An arc of the knob's sweep (270°, from -135°) between positions t0 and t1 (0..1). */
export function ringPath(r, t0, t1) {
  let a = Math.max(0, Math.min(1, t0));
  let b = Math.max(0, Math.min(1, t1));
  if (b < a) [a, b] = [b, a];
  if (b - a < 0.002) return "";
  const pt = (t) => {
    const ang = ((-135 + 270 * t) * Math.PI) / 180;
    return [30 + r * Math.sin(ang), 30 - r * Math.cos(ang)];
  };
  const [x0, y0] = pt(a);
  const [x1, y1] = pt(b);
  const large = (b - a) * 270 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Four screws in the panel's corners, inside the wood cheeks. */
export function addScrews(root) {
  if (root.querySelector(".an-screw")) return;
  for (const pos of ["tl", "tr", "bl", "br"]) {
    const s = document.createElement("span");
    s.className = `an-screw an-screw-${pos}`;
    s.setAttribute("aria-hidden", "true");
    root.appendChild(s);
  }
}
