/**
 * STUDIO — "Classic" stock drum voices.
 *
 * A JavaScript port of LYNX SHARE's built-in drum instrument (C++, AGPL-3.0,
 * src/core/Instruments.cpp: DrumInstrument): a sine kick sweeping 155 → 45 Hz,
 * a tone + noise snare, a high-passed noise hat and a three-snap clap — plus a
 * few variations built from the same voices (open hat, sub kick, rimshot,
 * ghost snare). Pure synthesis, no samples, so nothing has to be downloaded.
 *
 * renderStockDrum(type, sampleRate) returns a mono Float32Array one-shot.
 */

const decayCoefficient = (seconds, sr) => Math.exp(Math.log(0.001) / (seconds * sr));

/** Same tiny LCG on every render, so a sound is identical each time it is made. */
function noise(seed = 22222) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 196314165) + 907633515) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

export const STOCK_DRUM_VOICES = {
  //            amp decay  pitch decay  pitch: base + sweep
  kick: { decay: 0.45, pitchDecay: 0.08, base: 45, sweep: 110 },
  sub: { decay: 1.1, pitchDecay: 0.06, base: 40, sweep: 70, drive: 1.6 },
  snare: { decay: 0.22, pitchDecay: 0.03, base: 180, sweep: 60, tone: 0.5, noise: 0.7 },
  ghost: { decay: 0.12, pitchDecay: 0.02, base: 200, sweep: 40, tone: 0.35, noise: 0.5, gain: 0.55 },
  rimshot: { decay: 0.07, pitchDecay: 0.01, base: 820, sweep: 300, tone: 0.9, noise: 0.35 },
  hat: { decay: 0.06 },
  openhat: { decay: 0.38 },
  clap: { decay: 0.3 },
};

export function renderStockDrum(type, sampleRate = 44100) {
  const v = STOCK_DRUM_VOICES[type];
  if (!v) return null;
  const sr = sampleRate;
  const decay = decayCoefficient(v.decay, sr);
  const pitchDecay = decayCoefficient(v.pitchDecay || 0.03, sr);
  // until the level falls under −66 dB (LYNX frees the voice at 0.0005)
  const length = Math.ceil(Math.log(0.0005) / Math.log(decay)) + 1;
  const out = new Float32Array(length);
  const rnd = noise();
  let level = 1;
  let pitchEnv = 1;
  let phase = 0;
  // filter state shared by highPass / bandPass, as in LYNX's DrumVoice
  let filterState = 0;
  let lastNoise = 0;
  let lastHighPass = 0;
  const highPass = (x) => {
    const y = 0.85 * (filterState + x - lastNoise);
    lastNoise = x;
    filterState = y;
    return y;
  };
  const bandPass = (x) => {
    const hp = highPass(x);
    const y = 0.5 * (hp + lastHighPass);
    lastHighPass = hp;
    return y;
  };
  for (let i = 0; i < length; i++) {
    let s = 0;
    switch (type) {
      case "kick":
      case "sub": {
        phase += (2 * Math.PI * (v.base + v.sweep * pitchEnv)) / sr;
        s = Math.sin(phase);
        if (v.drive) s = Math.tanh(s * v.drive) / Math.tanh(v.drive);
        s *= level;
        break;
      }
      case "snare":
      case "ghost":
      case "rimshot": {
        phase += (2 * Math.PI * (v.base + v.sweep * pitchEnv)) / sr;
        const tone = Math.sin(phase) * pitchEnv;
        s = (v.tone * tone + v.noise * highPass(rnd())) * level * (v.gain || 1);
        break;
      }
      case "hat":
      case "openhat":
        s = 0.8 * highPass(rnd()) * level;
        break;
      case "clap": {
        // three short snaps followed by a tail: several hands
        const ms = (i * 1000) / sr;
        const burst = ms < 30 ? Math.exp(-(ms % 10) / 2) : 1;
        s = 0.8 * bandPass(rnd()) * level * burst;
        break;
      }
    }
    out[i] = s;
    level *= decay;
    pitchEnv *= pitchDecay;
  }
  // 1 ms fade-in removes the click of a sine starting off zero-phase in the noise voices
  const fade = Math.min(length, Math.round(sr * 0.001));
  for (let i = 0; i < fade && type !== "kick" && type !== "sub"; i++) out[i] *= i / fade;
  return out;
}
