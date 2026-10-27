/**
 * Audius Studio — stock instruments.
 *
 * Instruments are built into the app (same-origin modules, no downloads) and
 * run as AudioWorklets. Each entry is loaded on demand the first time a
 * channel of that type is played or edited, so they cost nothing at startup.
 *
 * Browsers cannot load native VST / VST3 / AU plugins; these are original
 * instruments written for the web.
 */
export const STOCK_INSTRUMENTS = [
  {
    type: "mammoth",
    name: "Mammoth",
    kind: "Wavetable synth",
    description:
      "Three wavetable oscillators with six modes, a modulation oscillator, noise and feedback, two filters in series or parallel, inserts, two FX slots and EQ, four envelopes, four LFO / performer / stepper slots and eight macros.",
    channelName: "Mammoth",
    color: "#5fb4ff",
  },
  {
    type: "quartet",
    name: "Quartet",
    kind: "4-oscillator synth",
    description:
      "Four oscillators (sine, triangle, saw, square, noise) with octave, tuning, level, pan and unison; a resonant filter with its own envelope; a level envelope and an LFO. Light enough for older tablets.",
    channelName: "Quartet",
    color: "#f59e0b",
  },
];

export function findStockInstrument(type) {
  return STOCK_INSTRUMENTS.find((i) => i.type === type) || null;
}
