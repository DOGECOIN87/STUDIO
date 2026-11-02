/**
 * STUDIO — Stereo Tool (built-in effect, plain JavaScript DSP).
 * Utility strip: gain, balance, mid/side width (0 % mono … 200 % extra wide),
 * a mono-bass crossover (keeps the low end centred) and polarity / channel
 * swap switches. After the LYNX SHARE Utility and Stereo Shaper (AGPL-3.0).
 */
const STATE = new WeakMap();

export const PLUGIN = {
  name: "Stereo Tool",
  version: "1.0.0",
  params: [
    { id: "gain", name: "Gain", min: -24, max: 24, default: 0, unit: "dB", format: "db" },
    { id: "balance", name: "Balance", min: -1, max: 1, default: 0, unit: "", format: "pan" },
    { id: "width", name: "Width", min: 0, max: 2, default: 1, unit: "%", format: "width" },
    { id: "monoBass", name: "Mono bass", min: 0, max: 400, default: 0, unit: "Hz", format: "hz-off" },
    { id: "invert", name: "Polarity", min: 0, max: 1, default: 0, unit: "", format: "switch" },
    { id: "swap", name: "Swap L/R", min: 0, max: 1, default: 0, unit: "", format: "switch" },
  ],
  presets: [
    { name: "Neutral", values: { gain: 0, balance: 0, width: 1, monoBass: 0, invert: 0, swap: 0 } },
    { name: "Mono", values: { width: 0, monoBass: 0 } },
    { name: "Wide", values: { width: 1.5, monoBass: 120 } },
    { name: "Tight low end", values: { width: 1, monoBass: 160 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      s = { lpS: 0, lpS2: 0 };
      STATE.set(params, s);
    }
    const g = Math.pow(10, params.gain / 20);
    const bal = params.balance;
    const gl = g * (bal > 0 ? 1 - bal : 1);
    const gr = g * (bal < 0 ? 1 + bal : 1);
    const width = params.width;
    const pol = params.invert >= 0.5 ? -1 : 1;
    const swap = params.swap >= 0.5;
    const fc = params.monoBass;
    const useMono = fc >= 20;
    const k = useMono ? 1 - Math.exp((-2 * Math.PI * fc) / sampleRate) : 0;
    let lpS = s.lpS;
    let lpS2 = s.lpS2;
    for (let i = 0; i < frames; i++) {
      const l = swap ? inR[i] : inL[i];
      const r = swap ? inL[i] : inR[i];
      const mid = (l + r) * 0.5;
      let side = (l - r) * 0.5;
      if (useMono) {
        // remove the side signal's lows (two one-pole stages, 12 dB/oct)
        lpS += (side - lpS) * k;
        lpS2 += (lpS - lpS2) * k;
        side -= lpS2;
      }
      side *= width;
      outL[i] = (mid + side) * gl * pol;
      outR[i] = (mid - side) * gr * pol;
    }
    s.lpS = lpS;
    s.lpS2 = lpS2;
  },
};
