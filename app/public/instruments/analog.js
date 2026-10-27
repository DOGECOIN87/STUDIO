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
    return SKINS.some((s) => s.id === v) ? v : "vintage";
  } catch (_) {
    return "vintage";
  }
}

/** Gives a synth window the analog look in the current skin. */
export function applySkin(root) {
  ensureDefs();
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
    <radialGradient id="an-cap-cream" cx="0.36" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#fffdf6"/><stop offset="0.5" stop-color="#e9e0cc"/><stop offset="1" stop-color="#a99d84"/>
    </radialGradient>
  </defs>`;
  document.body.appendChild(svg);
}

/**
 * The printed tick marks (11, over the 270° sweep), a shadow and the knob's skirt,
 * for a 60×60 drawing centred on 30,30. Put them before the cap and pointer.
 */
export function knobParts() {
  const ticks = document.createElementNS(NS, "g");
  ticks.setAttribute("class", "an-ticks");
  for (let i = 0; i <= 10; i++) {
    const a = ((-135 + 27 * i) * Math.PI) / 180;
    const line = document.createElementNS(NS, "line");
    const r0 = i % 5 === 0 ? 24.5 : 25.5;
    line.setAttribute("x1", (30 + r0 * Math.sin(a)).toFixed(2));
    line.setAttribute("y1", (30 - r0 * Math.cos(a)).toFixed(2));
    line.setAttribute("x2", (30 + 29 * Math.sin(a)).toFixed(2));
    line.setAttribute("y2", (30 - 29 * Math.cos(a)).toFixed(2));
    ticks.appendChild(line);
  }
  const circle = (cls, cy, r) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "30");
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    return c;
  };
  // A soft shadow under the knob, then the knob's skirt.
  return [ticks, circle("an-shadow", 31.8, 21.4), circle("an-skirt", 30, 21)];
}
