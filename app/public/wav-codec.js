/**
 * Audius Studio — Audio Codec, Waveform Peak Cache, Transient Detector & Stem Generator
 */

export function encodeWavFromAudioBuffer(audioBuffer, bitDepth = 16) {
  const numChannels = Math.min(2, audioBuffer.numberOfChannels || 2);
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const isFloat = bitDepth === 32;
  const bytesPerSample = bitDepth === 24 ? 3 : isFloat ? 4 : 2;
  const formatCode = isFloat ? 3 : 1; // 3 = IEEE float, 1 = PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeAscii(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, formatCode, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const raw = channels[c][i];
      const clamped = Math.max(-1, Math.min(1, raw));
      if (isFloat) {
        view.setFloat32(offset, clamped, true);
        offset += 4;
      } else if (bitDepth === 24) {
        const s = Math.round(clamped < 0 ? clamped * 8388608 : clamped * 8388607);
        view.setUint8(offset, s & 0xff);
        view.setUint8(offset + 1, (s >> 8) & 0xff);
        view.setUint8(offset + 2, (s >> 16) & 0xff);
        offset += 3;
      } else {
        const s = Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
        view.setInt16(offset, s, true);
        offset += 2;
      }
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Computes compact peak pyramid for fast, high-detail waveform drawing on the playlist canvas.
 */
export function computeWaveformPeaks(audioBuffer, bucketsPerSecond = 200) {
  const duration = audioBuffer.duration;
  const totalBuckets = Math.max(64, Math.min(24000, Math.ceil(duration * bucketsPerSecond)));
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
  const len = ch0.length;
  const step = len / totalBuckets;

  const minArr = new Float32Array(totalBuckets);
  const maxArr = new Float32Array(totalBuckets);
  const rmsArr = new Float32Array(totalBuckets);

  for (let b = 0; b < totalBuckets; b++) {
    const start = Math.floor(b * step);
    const end = Math.min(len, Math.floor((b + 1) * step) || start + 1);
    let min = 1;
    let max = -1;
    let sumSq = 0;
    let count = 0;
    const stride = Math.max(1, Math.floor((end - start) / 64));
    for (let i = start; i < end; i += stride) {
      const v = 0.5 * (ch0[i] + ch1[i]);
      if (v < min) min = v;
      if (v > max) max = v;
      sumSq += v * v;
      count++;
    }
    if (count === 0) {
      min = 0;
      max = 0;
    }
    minArr[b] = min;
    maxArr[b] = max;
    rmsArr[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  return {
    bucketsPerSecond: totalBuckets / Math.max(0.001, duration),
    totalBuckets,
    duration,
    min: minArr,
    max: maxArr,
    rms: rmsArr,
  };
}

/**
 * Detects transient onset times (in seconds) within [startSec, startSec + durationSec]
 * so a user can auto-slice a drum loop or musical phrase at hits.
 */
export function detectTransients(audioBuffer, startSec = 0, durationSec = null, sensitivity = 0.55) {
  const sr = audioBuffer.sampleRate;
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(
    ch0.length,
    durationSec != null ? Math.floor((startSec + durationSec) * sr) : ch0.length
  );

  const hop = Math.floor(sr * 0.01); // 10ms hop
  const env = [];
  for (let i = startSample; i + hop < endSample; i += hop) {
    let e = 0;
    for (let j = 0; j < hop; j += 4) {
      const s = 0.5 * (ch0[i + j] + ch1[i + j]);
      e += s * s;
    }
    env.push(Math.sqrt(e / (hop / 4)));
  }

  const diff = new Float32Array(env.length);
  let maxDiff = 0.0001;
  for (let i = 1; i < env.length; i++) {
    const d = Math.max(0, env[i] - env[i - 1]);
    diff[i] = d;
    if (d > maxDiff) maxDiff = d;
  }

  const thresh = maxDiff * (0.85 - sensitivity * 0.65);
  const minGapFrames = Math.ceil(0.12 / 0.01); // 120ms minimum slice spacing
  const onsets = [];
  let lastIdx = -minGapFrames;

  for (let i = 2; i < diff.length - 1; i++) {
    if (
      diff[i] > thresh &&
      diff[i] >= diff[i - 1] &&
      diff[i] >= diff[i + 1] &&
      i - lastIdx >= minGapFrames
    ) {
      const sec = startSec + i * 0.01;
      if (sec - startSec > 0.08 && startSec + (durationSec || audioBuffer.duration) - sec > 0.08) {
        onsets.push(Number(sec.toFixed(4)));
        lastIdx = i;
      }
    }
  }
  return onsets;
}

/**
 * Creates a reversed copy of an AudioBuffer so reversed clips play and export sample-accurately.
 */
export function createReversedAudioBuffer(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const sr = audioBuffer.sampleRate;
  const out = new AudioBuffer({ numberOfChannels: numCh, length: len, sampleRate: sr });
  for (let c = 0; c < numCh; c++) {
    const src = audioBuffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      dst[i] = src[len - 1 - i];
    }
  }
  return out;
}

/**
 * Synthesizes stereo stems from a demo song's note data (see demo-song.js).
 *
 * The demo session's pitch/timing/velocity data is real (extracted from the
 * project owner's session file), but its original samples and plug-in presets
 * are not bundled with this app, so every part is re-voiced here with
 * deterministic, dependency-free synthesis: multi-stage kick, dual-mode snare
 * with filtered wire rattle, metallic-partial hi-hats, multi-burst band-passed
 * clap, tuned tom/rim/fx, PolyBLEP anti-aliased oscillators, 2-pole state-
 * variable filters, phase-coherent stereo unison, and legato lead voicing.
 * Stem buffers are pattern loops; the playlist clips arrange them.
 */
const TWO_PI = 2 * Math.PI;

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function makeNoise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function panGains(pan) {
  const p = Math.max(-1, Math.min(1, pan || 0));
  return [
    p <= 0 ? 1 : Math.cos(p * 0.5 * Math.PI),
    p >= 0 ? 1 : Math.cos(-p * 0.5 * Math.PI),
  ];
}

// High-accuracy parabolic sine on normalized phase p in [0, 1), max error < 0.0011 (-59 dB).
function fastSin(p) {
  const x = p < 0.5 ? p : p - 1;
  const ax = x < 0 ? -x : x;
  const y = 8 * x * (1 - 2 * ax);
  const ay = y < 0 ? -y : y;
  return y * (0.775 + 0.225 * ay);
}

// Fast Padé approximant to tanh(x), C2-continuous and <0.002 error inside [-3, 3].
function fastTanh(x) {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// Polynomial band-limited step (PolyBLEP) for anti-aliased saw/pulse oscillators.
function polyBlep(p, dt) {
  if (p < dt) {
    const t = p / dt;
    return t + t - t * t - 1;
  }
  if (p > 1 - dt) {
    const t = (p - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// Falling sawtooth (+1 to -1 across [0, 1)) so fundamental is in phase with fastSin(p) and pulse(p).
function polyBlepSaw(p, dt) {
  return 1 - 2 * p + polyBlep(p, dt);
}

function polyBlepPulse(p, dt, pw) {
  let p2 = p - pw;
  if (p2 < 0) p2 += 1;
  return (p < pw ? 1 : -1) - polyBlep(p, dt) + polyBlep(p2, dt);
}

// Light 18 Hz one-pole high-pass DC blocker + micro-boundary fade; returns post-filter peak.
function polishStemChannels(L, R, sr) {
  const len = L.length;
  if (len === 0) return 0;
  const Rcoeff = Math.exp((-TWO_PI * 18) / sr);
  const fadeSamples = Math.min(Math.floor(sr * 0.0025), Math.floor(len * 0.05));
  const fadeEndStart = len - fadeSamples;
  const invFade = fadeSamples > 0 ? 1 / fadeSamples : 1;
  let xPrevL = 0,
    yPrevL = 0,
    xPrevR = 0,
    yPrevR = 0;
  let peak = 0;

  for (let i = 0; i < len; i++) {
    const xL = L[i];
    let yL = xL - xPrevL + Rcoeff * yPrevL;
    xPrevL = xL;
    yPrevL = yL;

    const xR = R[i];
    let yR = xR - xPrevR + Rcoeff * yPrevR;
    xPrevR = xR;
    yPrevR = yR;

    if (i < fadeSamples) {
      const g = i * invFade;
      yL *= g;
      yR *= g;
    } else if (i >= fadeEndStart) {
      const g = (len - 1 - i) * invFade;
      yL *= g;
      yR *= g;
    }

    L[i] = yL;
    R[i] = yR;
    const aL = yL < 0 ? -yL : yL;
    const aR = yR < 0 ? -yR : yR;
    if (aL > peak) peak = aL;
    if (aR > peak) peak = aR;
  }
  return peak;
}

export function generateStemsFromSong(song, sampleRate = 44100) {
  const secPerBeat = 60 / song.bpm;
  const invSr = 1 / sampleRate;
  const twoPi = TWO_PI;

  function renderDrumStem(stem, length) {
    const buf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    const addKick = (start, vel, gain, seed) => {
      const dur = Math.floor(0.36 * sampleRate);
      const noise = makeNoise(seed);
      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      // Normalize against the demo session's 0.522 kick channel gain while keeping velocity dynamics.
      const level = Math.min(0.88, (0.32 + 0.68 * Math.pow(vNorm, 0.85)) * Math.min(1.25, gain / 0.522) * 0.78);
      let phase = 0;
      let clickPhase = 0;
      let clickLp = 0;
      const bodyDecayMul = Math.exp(-8.8 * invSr);
      const punchDecayMul = Math.exp(-29 * invSr);
      const snapDecayMul = Math.exp(-165 * invSr);
      const harmDecayMul = Math.exp(-20 * invSr);
      const clickDecayMul = Math.exp(-240 * invSr);
      let bodyEnv = 1;
      let punchEnv = 1;
      let snapEnv = 1;
      let harmEnv = 1;
      let clickEnv = 1;
      const attSamples = Math.max(1, Math.floor(0.0006 * sampleRate));
      const tailSamples = Math.max(1, Math.floor(0.035 * sampleRate));

      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i * invSr;
        // Two-stage exponential pitch drop settling onto G1/C1 sub foundation (49.5 -> 47.5 Hz).
        const freq = 47.5 + 2.5 * bodyEnv + 66 * punchEnv + 185 * snapEnv * (0.7 + 0.3 * vNorm);
        phase += twoPi * freq * invSr;
        clickPhase += twoPi * (750 + 2100 * clickEnv) * invSr;

        const w = noise();
        clickLp += 0.35 * (w - clickLp);
        const wHp = w - clickLp;

        const att = i < attSamples ? i / attSamples : 1;
        const hold = t < 0.018 ? 1 : bodyEnv / Math.exp(-8.8 * 0.018);
        const tail = i > dur - tailSamples ? (dur - i) / tailSamples : 1;
        const env = att * Math.min(1, hold) * tail;

        const sub = Math.sin(phase);
        const warm2 = Math.sin(phase * 2) * 0.19 * harmEnv;
        const warm3 = Math.sin(phase * 3) * 0.065 * punchEnv;
        const beater = (Math.sin(clickPhase) * 0.24 + wHp * 0.18) * clickEnv * (0.65 + 0.35 * vNorm);

        const s = fastTanh((sub * env + warm2 + warm3 + beater) * 1.38) * level;
        L[start + i] += s;
        R[start + i] += s;

        bodyEnv *= bodyDecayMul;
        punchEnv *= punchDecayMul;
        snapEnv *= snapDecayMul;
        harmEnv *= harmDecayMul;
        clickEnv *= clickDecayMul;
      }
    };

    const addSnare = (start, vel, gain, seed) => {
      const dur = Math.floor(0.25 * sampleRate);
      const noiseL = makeNoise(seed);
      const noiseR = makeNoise(seed ^ 0x9e3779b9);
      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      // Normalize against the demo session's 0.46 snare channel gain so the backbeat cuts through.
      const level = Math.min(0.82, (0.3 + 0.7 * Math.pow(vNorm, 0.85)) * Math.min(1.3, gain / 0.46) * 0.70);

      let p1 = 0;
      let p2 = 0;
      let pitchEnv = 1;
      let bodyEnv1 = 1;
      let bodyEnv2 = 1;
      let snapEnv = 1;
      let wireEnv = 1;
      const pitchMul = Math.exp(-42 * invSr);
      const bodyMul1 = Math.exp(-21 * invSr);
      const bodyMul2 = Math.exp(-33 * invSr);
      const snapMul = Math.exp(-95 * invSr);
      const wireMul = Math.exp(-14.5 * invSr);

      let lpL = 0,
        bpL = 0,
        lpR = 0,
        bpR = 0;
      const fWire = 2 * Math.sin((Math.PI * 2600) * invSr);
      const qWire = 0.65;
      const attSamples = Math.max(1, Math.floor(0.0005 * sampleRate));
      const tailSamples = Math.max(1, Math.floor(0.025 * sampleRate));

      for (let i = 0; i < dur && start + i < length; i++) {
        // Properly integrated dual drumhead modes (fixes old f(t)*t phase bug).
        const f1 = 178 + 98 * pitchEnv;
        const f2 = 328 + 115 * pitchEnv;
        p1 += twoPi * f1 * invSr;
        p2 += twoPi * f2 * invSr;

        const att = i < attSamples ? i / attSamples : 1;
        const tail = i > dur - tailSamples ? (dur - i) / tailSamples : 1;

        const body = (Math.sin(p1) * 0.68 * bodyEnv1 + Math.sin(p2) * 0.32 * bodyEnv2) * att;

        // Band-pass / high-pass shaped stereo snare wires (avoids low-end mud on the body).
        const nL = noiseL();
        lpL += fWire * bpL;
        const hpL = nL - lpL - qWire * bpL;
        bpL += fWire * hpL;

        const nR = noiseR();
        lpR += fWire * bpR;
        const hpR = nR - lpR - qWire * bpR;
        bpR += fWire * hpR;

        const wireGain = (0.58 * snapEnv + 0.48 * (1 - snapEnv) * wireEnv) * (0.65 + 0.35 * vNorm) * att * tail;
        const wL = (bpL * 0.55 + hpL * 0.45) * wireGain;
        const wR = (bpR * 0.55 + hpR * 0.45) * wireGain;

        const sL = fastTanh((body + wL * 0.9 + wR * 0.15) * 1.28) * level;
        const sR = fastTanh((body + wR * 0.9 + wL * 0.15) * 1.28) * level;
        L[start + i] += sL;
        R[start + i] += sR;

        pitchEnv *= pitchMul;
        bodyEnv1 *= bodyMul1;
        bodyEnv2 *= bodyMul2;
        snapEnv *= snapMul;
        wireEnv *= wireMul;
      }
    };

    const addClap = (start, vel, gain, seed) => {
      const dur = Math.floor(0.24 * sampleRate);
      const noiseL = makeNoise(seed);
      const noiseR = makeNoise(seed ^ 0x6c8e9cf5);
      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      const level = (0.3 + 0.7 * Math.pow(vNorm, 0.85)) * gain * 0.62;
      let lpL = 0,
        bpL = 0,
        lpR = 0,
        bpR = 0;
      const fBp = 2 * Math.sin((Math.PI * 1650) * invSr);
      const qBp = 0.58;
      const tailSamples = Math.max(1, Math.floor(0.025 * sampleRate));

      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i * invSr;
        // 4 staggered hand micro-bursts (0, 10.5ms, 21.5ms, 33ms) + diffused room tail.
        let burst = 0;
        if (t >= 0) burst += Math.exp(-t * 105);
        if (t >= 0.0105) burst += 0.9 * Math.exp(-(t - 0.0105) * 105);
        if (t >= 0.0215) burst += 0.82 * Math.exp(-(t - 0.0215) * 95);
        if (t >= 0.033) burst += 0.75 * Math.exp(-(t - 0.033) * 48) + 0.36 * Math.exp(-(t - 0.033) * 14.5);

        const att = i < 24 ? i / 24 : 1;
        const tail = i > dur - tailSamples ? (dur - i) / tailSamples : 1;

        const nL = noiseL();
        lpL += fBp * bpL;
        const hpL = nL - lpL - qBp * bpL;
        bpL += fBp * hpL;

        const nR = noiseR();
        lpR += fBp * bpR;
        const hpR = nR - lpR - qBp * bpR;
        bpR += fBp * hpR;

        const env = burst * att * tail * level;
        L[start + i] += fastTanh((bpL * 0.78 + hpL * 0.22) * 1.4) * env;
        R[start + i] += fastTanh((bpR * 0.78 + hpR * 0.22) * 1.4) * env;
      }
    };

    const addHat = (start, vel, gain, seed, open, rolePan = 0, stackScale = 1) => {
      // Distinguish main closed hat (1.031), 16th roll hat (1.057), and backbeat sizzle hat (1.0).
      const isBackbeatLayer = !open && Math.abs(gain - 1.0) < 0.012;
      const isRollHat = !open && gain > 1.045;
      const durSec = open ? 0.27 : isBackbeatLayer ? 0.125 : isRollHat ? 0.056 : 0.068;
      const dur = Math.floor(durSec * sampleRate);
      const decayRate = open ? 8.2 : isBackbeatLayer ? 19.5 : isRollHat ? 44 : 36;
      const noise = makeNoise(seed);

      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      const baseAmp = (0.28 + 0.72 * Math.pow(vNorm, 0.9)) * Math.min(1.15, gain) * 0.78 * stackScale;
      const [lg, rg] = panGains(rolePan);

      // Inharmonic metallic cymbal partial ratios (6 square-like oscillators in upper band).
      const pitchShift = isRollHat ? 1.045 : isBackbeatLayer ? 0.96 : 1.0;
      const inc0 = 3140 * pitchShift * invSr;
      const inc1 = 4380 * pitchShift * invSr;
      const inc2 = 5710 * pitchShift * invSr;
      const inc3 = 7290 * pitchShift * invSr;
      const inc4 = 8640 * pitchShift * invSr;
      const inc5 = 10120 * pitchShift * invSr;
      let p0 = 0.11,
        p1 = 0.27,
        p2 = 0.43,
        p3 = 0.59,
        p4 = 0.76,
        p5 = 0.91;

      let lp1 = 0,
        lp2 = 0;
      let env = 1;
      let tickEnv = 1;
      const envMul = Math.exp(-decayRate * invSr);
      const tickMul = Math.exp(-175 * invSr);
      const attSamples = Math.max(1, Math.floor(0.0006 * sampleRate));
      const tailSamples = Math.max(1, Math.floor(0.008 * sampleRate));

      for (let i = 0; i < dur && start + i < length; i++) {
        p0 += inc0;
        if (p0 >= 1) p0 -= 1;
        p1 += inc1;
        if (p1 >= 1) p1 -= 1;
        p2 += inc2;
        if (p2 >= 1) p2 -= 1;
        p3 += inc3;
        if (p3 >= 1) p3 -= 1;
        p4 += inc4;
        if (p4 >= 1) p4 -= 1;
        p5 += inc5;
        if (p5 >= 1) p5 -= 1;

        const metal =
          ((p0 < 0.5 ? 1 : -1) +
            (p1 < 0.5 ? 1 : -1) +
            (p2 < 0.5 ? 1 : -1) +
            (p3 < 0.5 ? 1 : -1) +
            (p4 < 0.5 ? 1 : -1) +
            (p5 < 0.5 ? 1 : -1)) *
          0.1667;

        const w = noise();
        const raw = w * 0.66 + metal * 0.34;
        // Two-stage high-pass above ~5.5 kHz for crisp metallic sheen without low-mid static.
        lp1 += 0.46 * (raw - lp1);
        const hp1 = raw - lp1;
        lp2 += 0.46 * (hp1 - lp2);
        const hp2 = hp1 - lp2;

        const att = i < attSamples ? i / attSamples : 1;
        const tail = i > dur - tailSamples ? (dur - i) / tailSamples : 1;
        const gainEnv = (0.72 * env + 0.28 * tickEnv) * att * tail * baseAmp;
        const s = hp2 * gainEnv;

        L[start + i] += s * lg * 0.95;
        R[start + i] += s * rg * 1.05;

        env *= envMul;
        tickEnv *= tickMul;
      }
    };

    const addTom = (start, vel, gain, seed) => {
      const dur = Math.floor(0.26 * sampleRate);
      const noise = makeNoise(seed);
      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      // Tuned to G2 (98 Hz) with controlled level so beat-4 fills groove with the kick/snare.
      const level = (0.3 + 0.7 * Math.pow(vNorm, 0.85)) * gain * 0.42;
      const [lg, rg] = panGains(-0.08);
      let phase = 0;
      let pitchEnv = 1;
      let bodyEnv = 1;
      let clickEnv = 1;
      const pitchMul = Math.exp(-21 * invSr);
      const bodyMul = Math.exp(-12.5 * invSr);
      const clickMul = Math.exp(-145 * invSr);
      const attSamples = Math.max(1, Math.floor(0.0008 * sampleRate));
      const tailSamples = Math.max(1, Math.floor(0.025 * sampleRate));

      for (let i = 0; i < dur && start + i < length; i++) {
        const freq = 98 + 72 * pitchEnv;
        phase += twoPi * freq * invSr;
        const att = i < attSamples ? i / attSamples : 1;
        const tail = i > dur - tailSamples ? (dur - i) / tailSamples : 1;
        const body = (Math.sin(phase) * 0.84 + Math.sin(phase * 2) * 0.16 * pitchEnv) * bodyEnv;
        const stick = noise() * 0.18 * clickEnv;
        const s = fastTanh((body + stick) * 1.2) * att * tail * level;
        L[start + i] += s * lg;
        R[start + i] += s * rg;

        pitchEnv *= pitchMul;
        bodyEnv *= bodyMul;
        clickEnv *= clickMul;
      }
    };

    const addRim = (start, vel, gain, seed) => {
      const dur = Math.floor(0.058 * sampleRate);
      const noise = makeNoise(seed);
      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      const level = (0.3 + 0.7 * Math.pow(vNorm, 0.85)) * gain * 0.56;
      let p1 = 0,
        p2 = 0,
        p3 = 0;
      let env1 = 1,
        env2 = 1,
        nEnv = 1;
      const mul1 = Math.exp(-65 * invSr);
      const mul2 = Math.exp(-95 * invSr);
      const mulN = Math.exp(-135 * invSr);
      let bp = 0,
        lp = 0;
      const fBp = 2 * Math.sin((Math.PI * 2100) * invSr);

      for (let i = 0; i < dur && start + i < length; i++) {
        p1 += twoPi * 485 * invSr;
        p2 += twoPi * 1710 * invSr;
        p3 += twoPi * 2920 * invSr;
        const w = noise();
        lp += fBp * bp;
        const hp = w - lp - 0.5 * bp;
        bp += fBp * hp;
        const att = i < 16 ? i / 16 : 1;
        const wood = Math.sin(p1) * 0.45 * env1 + Math.sin(p2) * 0.42 * env2 + Math.sin(p3) * 0.18 * env2;
        const s = fastTanh((wood + bp * 0.35 * nEnv) * 1.45) * att * level;
        L[start + i] += s * 0.96;
        R[start + i] += s * 1.04;
        env1 *= mul1;
        env2 *= mul2;
        nEnv *= mulN;
      }
    };

    const addFx = (start, vel, gain, seed) => {
      const dur = Math.floor(0.34 * sampleRate);
      const invDur = 1 / dur;
      const noise = makeNoise(seed);
      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      const isAlt = gain < 0.45; // 0.539 (bars 1 & 3) vs 0.388 (bars 2 & 4)
      const level = (0.3 + 0.7 * vNorm) * gain * 0.62;
      let p1 = 0,
        p2 = 0;
      let lp = 0,
        bp = 0;
      let expCurve = 1;
      const expMul = Math.exp((-3.1 * 16) * invDur);
      let envDecay = 1;
      const envDecayMul = Math.exp((-1.85 * 16) * invDur);
      let fSvf = 0.25;
      let dp1 = 0.02,
        dp2 = 0.03;
      let env = 0;
      let panMod = 0;

      for (let i = 0; i < dur && start + i < length; i++) {
        if ((i & 15) === 0) {
          const frac = i * invDur;
          const f1 = isAlt ? 392 + 654 * expCurve : 523.25 + 1044.75 * expCurve;
          dp1 = f1 * invSr;
          dp2 = f1 * 1.498 * invSr;
          const cutoff = 520 + 2600 * expCurve;
          fSvf = 2 * Math.sin(Math.PI * Math.min(0.4, cutoff * invSr));
          env = Math.sin(Math.PI * frac) * envDecay * level;
          panMod = 0.22 * Math.sin(twoPi * 2.5 * frac * (isAlt ? -1 : 1));
          expCurve *= expMul;
          envDecay *= envDecayMul;
        }
        p1 += dp1;
        if (p1 >= 1) p1 -= 1;
        p2 += dp2;
        if (p2 >= 1) p2 -= 1;

        const w = noise();
        lp += fSvf * bp;
        const hp = w - lp - 0.42 * bp;
        bp += fSvf * hp;

        const tone = (fastSin(p1) * 0.28 + fastSin(p2) * 0.16 + bp * 0.56) * env;
        L[start + i] += tone * (1 - panMod);
        R[start + i] += tone * (1 + panMod);
      }
    };

    const addPerc = (start, vel, gain, seed) => {
      const dur = Math.floor(0.095 * sampleRate);
      const noise = makeNoise(seed);
      const vNorm = Math.max(0.2, Math.min(1.2, vel));
      const level = (0.3 + 0.7 * vNorm) * gain * 0.24;
      let lp = 0,
        bp = 0;
      const fSvf = 2 * Math.sin((Math.PI * 5200) * invSr);
      for (let i = 0; i < dur && start + i < length; i++) {
        const frac = i / dur;
        const env = Math.sin(Math.PI * Math.pow(frac, 0.62)) * Math.exp(-frac * 2.4);
        const w = noise();
        lp += fSvf * bp;
        const hp = w - lp - 0.55 * bp;
        bp += fSvf * hp;
        const s = (bp * 0.6 + hp * 0.4) * env * level;
        L[start + i] += s * 1.06;
        R[start + i] += s * 0.94;
      }
    };

    const hits = stem.hits || [];
    // Count coincident hats on the same beat so layered hats blend smoothly without +6 dB spikes.
    const hatCountByBeat = new Map();
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (h[1] === "hat") {
        const key = Math.round(h[0] * 1000);
        hatCountByBeat.set(key, (hatCountByBeat.get(key) || 0) + 1);
      }
    }

    let rollToggle = 0;
    hits.forEach((hit, idx) => {
      const beat = hit[0];
      const type = hit[1];
      const vel = hit[2] == null ? 0.8 : hit[2];
      const gain = hit[3] == null ? 1 : hit[3];
      const start = Math.floor(beat * secPerBeat * sampleRate);
      const seed = (1337 + idx * 7919) >>> 0;

      if (type === "kick") {
        addKick(start, vel, gain, seed);
      } else if (type === "snare") {
        addSnare(start, vel, gain, seed);
      } else if (type === "clap") {
        addClap(start, vel, gain, seed);
      } else if (type === "hat") {
        const sameBeatHats = hatCountByBeat.get(Math.round(beat * 1000)) || 1;
        const stackScale = sameBeatHats > 1 ? 0.72 : 1.0;
        let rolePan = 0.07;
        if (gain > 1.045) {
          rolePan = rollToggle % 2 === 0 ? -0.14 : 0.16;
          rollToggle++;
        } else if (Math.abs(gain - 1.0) < 0.012) {
          rolePan = -0.11;
        }
        addHat(start, vel, gain, seed, false, rolePan, stackScale);
      } else if (type === "tom") {
        addTom(start, vel, gain, seed);
      } else if (type === "rim") {
        addRim(start, vel, gain, seed);
      } else if (type === "fx") {
        addFx(start, vel, gain, seed);
      } else {
        addPerc(start, vel, gain, seed);
      }
    });

    const peak = polishStemChannels(L, R, sampleRate);
    return { buf, peak };
  }

  function renderReeseStem(stem, length) {
    const buf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const stemGain = stem.gain == null ? 1 : stem.gain;
    const rawNotes = stem.notes || [];
    const tailSec = 0.045;
    const attSamples = Math.max(1, Math.floor(0.009 * sampleRate));
    const invAtt = 1 / attSamples;
    const filtDecayMul = Math.exp(-5.8 * 16 * invSr);
    const biteDecayMul = Math.exp(-4.2 * invSr);
    const qSvf = 0.66;

    for (let nIdx = 0; nIdx < rawNotes.length; nIdx++) {
      const note = rawNotes[nIdx];
      const beat = note[0];
      const midi = note[1];
      const lenBeats = Math.max(0.08, note[2] || 0.25);
      const rawVel = note[3] == null ? 0.8 : note[3];
      const vel = rawVel * stemGain;
      const [lg, rg] = panGains(note[4]);
      const f0 = midiToFreq(midi);
      const start = Math.floor(beat * secPerBeat * sampleRate);
      if (start >= length) continue;

      const durSec = lenBeats * secPerBeat;
      const dur = Math.min(length - start, Math.floor((durSec + tailSec) * sampleRate));
      if (dur <= 0) continue;
      const actualDurSec = dur * invSr;
      const relSpan = Math.min(tailSec + 0.01, actualDurSec * 0.45);
      const relSamples = Math.max(1, Math.floor(relSpan * sampleRate));
      const relStartIdx = dur - relSamples;
      const invRel = 1 / relSamples;

      const dtSub = 0.5 * f0 * invSr;
      const dtCenter = f0 * invSr;
      const dtL = f0 * 0.9946 * invSr;
      const dtR = f0 * 1.0054 * invSr;
      let pSub = 0.5;
      let pCenter = 0.5;
      let pL = (0.17 + nIdx * 0.13) % 1;
      let pR = (0.63 + nIdx * 0.29) % 1;
      let lpM = 0,
        bpM = 0,
        lpS = 0,
        bpS = 0;
      let fSvf = 2 * Math.sin(Math.PI * Math.min(0.35, 950 * invSr));
      let filtEnv = 1;
      let biteEnv = 1;
      const level = vel * 0.60;

      for (let i = 0; i < dur; i++) {
        if ((i & 15) === 0) {
          const t = i * invSr;
          const wobble = 1 + 0.14 * Math.sin(twoPi * 1.35 * t);
          const cut = (255 + (520 + 480 * rawVel) * filtEnv) * wobble;
          fSvf = 2 * Math.sin(Math.PI * Math.min(0.38, cut * invSr));
          filtEnv *= filtDecayMul;
        }

        let env = 1;
        if (i < attSamples) {
          const u = i * invAtt;
          env = u * u * (3 - 2 * u);
        }
        if (i > relStartIdx) {
          const u = (dur - i) * invRel;
          env *= u * u * (3 - 2 * u);
        }

        pSub += dtSub;
        if (pSub >= 1) pSub -= 1;
        pCenter += dtCenter;
        if (pCenter >= 1) pCenter -= 1;
        pL += dtL;
        if (pL >= 1) pL -= 1;
        pR += dtR;
        if (pR >= 1) pR -= 1;

        let pCenter2 = pCenter * 2;
        if (pCenter2 >= 1) pCenter2 -= 1;

        const subOsc = fastSin(pSub) * 0.52 + fastSin(pCenter) * 0.34;
        const sawC = polyBlepSaw(pCenter, dtCenter);
        const sawL = 1 - 2 * pL;
        const sawR = 1 - 2 * pR;
        const bite = fastSin(pCenter2) * 0.16 * biteEnv;

        const midIn = sawC * 0.52 + (sawL + sawR) * 0.22 + bite;
        const sideIn = (sawL - sawR) * 0.18;

        lpM += fSvf * bpM;
        const hpM = midIn - lpM - qSvf * bpM;
        bpM += fSvf * hpM;

        lpS += fSvf * bpS;
        const hpS = sideIn - lpS - qSvf * bpS;
        bpS += fSvf * hpS;

        const midOut = subOsc + lpM * 0.56;
        const sideOut = lpS * 0.56;
        const sL = fastTanh((midOut + sideOut) * 1.22) * env * level;
        const sR = fastTanh((midOut - sideOut) * 1.22) * env * level;

        L[start + i] += sL * lg;
        R[start + i] += sR * rg;
        biteEnv *= biteDecayMul;
      }
    }
    const peak = polishStemChannels(L, R, sampleRate);
    return { buf, peak };
  }

  function renderStabStem(stem, length) {
    const buf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const stemGain = stem.gain == null ? 1 : stem.gain;
    const rawNotes = stem.notes || [];
    const tailSec = 0.035;
    const attSamples = Math.max(1, Math.floor(0.0032 * sampleRate));
    const invAtt = 1 / attSamples;
    const fastMul = Math.exp(-8.6 * invSr);
    const slowMul = Math.exp(-2.35 * invSr);
    const filtMul = Math.exp(-13.5 * 16 * invSr);
    const qSvf = 0.64;

    for (let nIdx = 0; nIdx < rawNotes.length; nIdx++) {
      const note = rawNotes[nIdx];
      const beat = note[0];
      const midi = note[1];
      const lenBeats = Math.max(0.08, note[2] || 0.25);
      const rawVel = note[3] == null ? 0.8 : note[3];
      const vel = rawVel * stemGain;
      const [lg, rg] = panGains(note[4]);
      const f0 = midiToFreq(midi);
      const start = Math.floor(beat * secPerBeat * sampleRate);
      if (start >= length) continue;

      const durSec = lenBeats * secPerBeat;
      const dur = Math.min(length - start, Math.floor((durSec + tailSec) * sampleRate));
      if (dur <= 0) continue;
      const actualDurSec = dur * invSr;
      const relSpan = Math.min(tailSec + 0.01, actualDurSec * 0.45);
      const relSamples = Math.max(1, Math.floor(relSpan * sampleRate));
      const relStartIdx = dur - relSamples;
      const invRel = 1 / relSamples;

      const dtSub = 0.5 * f0 * invSr;
      const dtC = f0 * invSr;
      const dtL = f0 * 0.9968 * invSr;
      const dtR = f0 * 1.0032 * invSr;
      let pSub = 0.25;
      let pC = 0.25;
      let pL = (0.21 + nIdx * 0.19) % 1;
      let pR = (0.67 + nIdx * 0.31) % 1;
      let lpM = 0,
        bpM = 0,
        lpS = 0,
        bpS = 0;
      const keyScale = Math.min(1.15, Math.pow(520 / f0, 0.35));
      const v2 = rawVel * rawVel;
      let fSvf = 2 * Math.sin(Math.PI * Math.min(0.4, 2400 * invSr));
      let fastEnv = 1;
      let slowEnv = 1;
      let filtEnv = 1;
      const level = -vel * 0.92;

      for (let i = 0; i < dur; i++) {
        if ((i & 15) === 0) {
          const cut = (760 + (1650 + 2350 * v2) * filtEnv) * keyScale;
          fSvf = 2 * Math.sin(Math.PI * Math.min(0.41, cut * invSr));
          filtEnv *= filtMul;
        }

        let env = 0.58 * fastEnv + 0.42 * slowEnv;
        if (i < attSamples) {
          const u = i * invAtt;
          env *= u * u * (3 - 2 * u);
        }
        if (i > relStartIdx) {
          const u = (dur - i) * invRel;
          env *= u * u * (3 - 2 * u);
        }

        pSub += dtSub;
        if (pSub >= 1) pSub -= 1;
        pC += dtC;
        if (pC >= 1) pC -= 1;
        pL += dtL;
        if (pL >= 1) pL -= 1;
        pR += dtR;
        if (pR >= 1) pR -= 1;

        const subBody = fastSin(pSub) * 0.28;
        const core = polyBlepSaw(pC, dtC) * 0.52 + polyBlepPulse(pC, dtC, 0.46) * 0.36;
        const detDiff = 2 * (pR - pL);

        const midIn = subBody + core * 0.88;
        const sideIn = detDiff * 0.16;

        lpM += fSvf * bpM;
        const hpM = midIn - lpM - qSvf * bpM;
        bpM += fSvf * hpM;

        lpS += fSvf * bpS;
        const hpS = sideIn - lpS - qSvf * bpS;
        bpS += fSvf * hpS;

        const sL = fastTanh((lpM + lpS) * 1.24) * env * level;
        const sR = fastTanh((lpM - lpS) * 1.24) * env * level;

        L[start + i] += sL * lg;
        R[start + i] += sR * rg;

        fastEnv *= fastMul;
        slowEnv *= slowMul;
      }
    }
    const peak = polishStemChannels(L, R, sampleRate);
    return { buf, peak };
  }

  function renderPluckStem(stem, length) {
    const buf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const stemGain = stem.gain == null ? 1 : stem.gain;
    const rawNotes = stem.notes || [];
    const tailSec = 0.035;
    const attSamples = Math.max(1, Math.floor(0.0038 * sampleRate));
    const invAtt = 1 / attSamples;
    const snapMul = Math.exp(-9.5 * invSr);
    const harmMul = Math.exp(-24 * invSr);
    const filtMul = Math.exp(-14.5 * 16 * invSr);
    const qSvf = 0.62;

    for (let nIdx = 0; nIdx < rawNotes.length; nIdx++) {
      const note = rawNotes[nIdx];
      const beat = note[0];
      const midi = note[1];
      const lenBeats = Math.max(0.08, note[2] || 0.25);
      const rawVel = note[3] == null ? 0.8 : note[3];
      const vel = rawVel * stemGain;
      const [lg, rg] = panGains(note[4]);
      const f0 = midiToFreq(midi);
      const start = Math.floor(beat * secPerBeat * sampleRate);
      if (start >= length) continue;

      const durSec = lenBeats * secPerBeat;
      const dur = Math.min(length - start, Math.floor((durSec + tailSec) * sampleRate));
      if (dur <= 0) continue;
      const actualDurSec = dur * invSr;
      const relSpan = Math.min(tailSec + 0.01, actualDurSec * 0.45);
      const relSamples = Math.max(1, Math.floor(relSpan * sampleRate));
      const relStartIdx = dur - relSamples;
      const invRel = 1 / relSamples;

      const dtC = f0 * invSr;
      const dtL = f0 * 0.9978 * invSr;
      const dtR = f0 * 1.0022 * invSr;
      let pC = 0.62;
      let pL = (0.14 + nIdx * 0.21) % 1;
      let pR = (0.62 + nIdx * 0.33) % 1;
      let lpM = 0,
        bpM = 0,
        lpS = 0,
        bpS = 0;
      let fSvf = 2 * Math.sin(Math.PI * Math.min(0.41, 3200 * invSr));
      const noteSpan = Math.max(0.08, durSec);
      const bodyMul = Math.exp((-2.85 / noteSpan) * invSr);
      let snapEnv = 1;
      let bodyEnv = 1;
      let harmEnv = 1;
      let filtEnv = 1;
      const level = vel * 0.85;

      for (let i = 0; i < dur; i++) {
        if ((i & 15) === 0) {
          const cut = 580 + (1400 + 2500 * rawVel * rawVel) * filtEnv;
          fSvf = 2 * Math.sin(Math.PI * Math.min(0.42, cut * invSr));
          filtEnv *= filtMul;
        }

        let env = 0.46 * snapEnv + 0.54 * bodyEnv;
        if (i < attSamples) {
          const u = i * invAtt;
          env *= u * u * (3 - 2 * u);
        }
        if (i > relStartIdx) {
          const u = (dur - i) * invRel;
          env *= u * u * (3 - 2 * u);
        }

        pC += dtC;
        if (pC >= 1) pC -= 1;
        pL += dtL;
        if (pL >= 1) pL -= 1;
        pR += dtR;
        if (pR >= 1) pR -= 1;

        let pC2 = pC * 2;
        if (pC2 >= 1) pC2 -= 1;
        let pC3 = pC * 3;
        while (pC3 >= 1) pC3 -= 1;

        const fund = fastSin(pC) * 0.42;
        const bell = (fastSin(pC2) * 0.28 + fastSin(pC3) * 0.14) * harmEnv * rawVel;
        const core = polyBlepSaw(pC, dtC) * 0.36 + polyBlepPulse(pC, dtC, 0.36) * 0.28 + fund + bell;
        const detDiff = 2 * (pR - pL);

        const midIn = core * 0.88;
        const sideIn = detDiff * 0.13;

        lpM += fSvf * bpM;
        const hpM = midIn - lpM - qSvf * bpM;
        bpM += fSvf * hpM;

        lpS += fSvf * bpS;
        const hpS = sideIn - lpS - qSvf * bpS;
        bpS += fSvf * hpS;

        const sL = fastTanh((lpM + lpS) * 1.18) * env * level;
        const sR = fastTanh((lpM - lpS) * 1.18) * env * level;

        L[start + i] += sL * lg;
        R[start + i] += sR * rg;

        snapEnv *= snapMul;
        bodyEnv *= bodyMul;
        harmEnv *= harmMul;
      }
    }
    const peak = polishStemChannels(L, R, sampleRate);
    return { buf, peak };
  }

  function renderLeadStem(stem, length) {
    const buf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const stemGain = stem.gain == null ? 1 : stem.gain;
    const rawNotes = stem.notes || [];
    const glideDecayMul = Math.exp(-62 * 16 * invSr);
    const qSvf = 0.58;
    let firstNoteSample = length;

    for (let nIdx = 0; nIdx < rawNotes.length; nIdx++) {
      const note = rawNotes[nIdx];
      const beat = note[0];
      const midi = note[1];
      const lenBeats = Math.max(0.08, note[2] || 0.25);
      const rawVel = note[3] == null ? 0.8 : note[3];
      const vel = rawVel * stemGain;
      const [lg, rg] = panGains(note[4]);
      const f0 = midiToFreq(midi);
      const start = Math.floor(beat * secPerBeat * sampleRate);
      if (start >= length) continue;
      if (start < firstNoteSample) firstNoteSample = start;

      let effLenBeats = lenBeats;
      let tailSec = 0.095;
      let glideFromFreq = f0;
      let isLegatoAttack = false;
      let dyadScale = 1.0;

      for (let k = nIdx + 1; k < rawNotes.length; k++) {
        const nb = rawNotes[k][0];
        if (Math.abs(nb - beat) < 0.01) {
          if (lenBeats < rawNotes[k][2]) dyadScale = 0.72;
          continue;
        }
        if (nb > beat + 0.04 && beat + lenBeats > nb - 0.02) {
          effLenBeats = Math.max(0.08, nb - beat);
          tailSec = 0.042;
        }
        break;
      }
      for (let k = nIdx - 1; k >= 0; k--) {
        const pb = rawNotes[k][0];
        const pLen = rawNotes[k][2] || 0.25;
        if (Math.abs(pb - beat) < 0.01) {
          if (lenBeats < pLen) dyadScale = 0.72;
          continue;
        }
        if (pb + pLen >= beat - 0.12 && pb < beat - 0.04) {
          const prevMidi = rawNotes[k][1];
          const clampedSemi = Math.max(-5, Math.min(5, prevMidi - midi));
          glideFromFreq = f0 * Math.pow(2, clampedSemi / 12);
          isLegatoAttack = true;
        }
        break;
      }

      const durSec = effLenBeats * secPerBeat;
      const dur = Math.min(length - start, Math.floor((durSec + tailSec) * sampleRate));
      if (dur <= 0) continue;
      const actualDurSec = dur * invSr;
      const relSpan = Math.min(tailSec + 0.01, actualDurSec * 0.45);
      const relSamples = Math.max(1, Math.floor(relSpan * sampleRate));
      const relStartIdx = dur - relSamples;
      const invRel = 1 / relSamples;

      const attSamples = Math.max(1, Math.floor((isLegatoAttack ? 0.015 : 0.024) * sampleRate));
      const invAtt = 1 / attSamples;
      const glideRatio = glideFromFreq / f0 - 1;
      let glideEnv = isLegatoAttack ? 1 : 0;
      let dtC = f0 * (1 + glideRatio * glideEnv) * invSr;
      let dtSub = 0.5 * dtC;
      let dtL = dtC * 0.9974;
      let dtR = dtC * 1.0026;
      let pSub = 0.37;
      let pC = 0.37;
      let pL = (0.19 + nIdx * 0.23) % 1;
      let pR = (0.71 + nIdx * 0.37) % 1;
      let lpM = 0,
        bpM = 0,
        lpS = 0,
        bpS = 0;
      let fSvf = 2 * Math.sin(Math.PI * Math.min(0.4, 2400 * invSr));
      const level = -vel * dyadScale * 0.42;

      for (let i = 0; i < dur; i++) {
        if ((i & 15) === 0) {
          const t = i * invSr;
          const vibDepth = 0.0052 * Math.min(1, Math.max(0, (t - 0.14) / 0.28));
          const vib = 1 + vibDepth * Math.sin(twoPi * 5.3 * t);
          const fInst = f0 * (1 + glideRatio * glideEnv) * vib;
          glideEnv *= glideDecayMul;
          dtC = fInst * invSr;
          dtSub = 0.5 * dtC;
          dtL = dtC * 0.9974;
          dtR = dtC * 1.0026;

          const bloom = Math.min(1, t / 0.04) * (0.72 + 0.28 * Math.exp(-t * 2.2));
          const shimmer = 0.92 + 0.08 * Math.sin(twoPi * 0.85 * t);
          const cut = (1500 + 2050 * bloom) * shimmer;
          fSvf = 2 * Math.sin(Math.PI * Math.min(0.41, cut * invSr));
        }

        let env = 1;
        if (i < attSamples) {
          const u = i * invAtt;
          env = u * u * (3 - 2 * u);
        }
        if (i > relStartIdx) {
          const u = (dur - i) * invRel;
          env *= u * u * (3 - 2 * u);
        }

        pSub += dtSub;
        if (pSub >= 1) pSub -= 1;
        pC += dtC;
        if (pC >= 1) pC -= 1;
        pL += dtL;
        if (pL >= 1) pL -= 1;
        pR += dtR;
        if (pR >= 1) pR -= 1;

        const subWarm = fastSin(pSub) * 0.22;
        const core =
          polyBlepSaw(pC, dtC) * 0.48 +
          polyBlepPulse(pC, dtC, 0.41) * 0.26 +
          fastSin(pC) * 0.26;
        const detDiff = 2 * (pR - pL);

        const midIn = subWarm + core * 0.88;
        const sideIn = detDiff * 0.16;

        lpM += fSvf * bpM;
        const hpM = midIn - lpM - qSvf * bpM;
        bpM += fSvf * hpM;

        lpS += fSvf * bpS;
        const hpS = sideIn - lpS - qSvf * bpS;
        bpS += fSvf * hpS;

        const sL = fastTanh((lpM + lpS) * 1.18) * env * level;
        const sR = fastTanh((lpM - lpS) * 1.18) * env * level;

        L[start + i] += sL * lg;
        R[start + i] += sR * rg;
      }
    }

    if (length > sampleRate) {
      const delaySamples = Math.max(1, Math.floor(0.75 * secPerBeat * sampleRate));
      const echoStart = Math.max(delaySamples, firstNoteSample + delaySamples);
      const wet = 0.12;
      const fb = 0.25;
      let lpEchoL = 0,
        lpEchoR = 0,
        hpEchoL = 0,
        hpEchoR = 0;
      const tailFadeSamples = Math.min(Math.floor(0.25 * sampleRate), Math.floor(length * 0.1));
      const fadeThreshold = length - tailFadeSamples;
      const invTailFade = tailFadeSamples > 0 ? 1 / tailFadeSamples : 1;
      for (let i = echoStart; i < length; i++) {
        const srcL = L[i - delaySamples];
        const srcR = R[i - delaySamples];
        lpEchoL += 0.24 * (srcL + srcR * fb - lpEchoL);
        hpEchoL += 0.028 * (lpEchoL - hpEchoL);
        const eL = lpEchoL - hpEchoL;

        lpEchoR += 0.24 * (srcR + srcL * fb - lpEchoR);
        hpEchoR += 0.028 * (lpEchoR - hpEchoR);
        const eR = lpEchoR - hpEchoR;

        const endFade = i > fadeThreshold ? (length - i) * invTailFade : 1;
        L[i] += (eL * 0.85 + eR * 0.15) * wet * endFade;
        R[i] += (eR * 0.85 + eL * 0.15) * wet * endFade;
      }
    }

    const peak = polishStemChannels(L, R, sampleRate);
    return { buf, peak };
  }

  return song.stems.map((stem) => {
    const length = Math.max(1, Math.floor(stem.lengthBeats * secPerBeat * sampleRate));
    let res;
    if (stem.voice === "drums") res = renderDrumStem(stem, length);
    else if (stem.voice === "reese") res = renderReeseStem(stem, length);
    else if (stem.voice === "stab") res = renderStabStem(stem, length);
    else if (stem.voice === "lead") res = renderLeadStem(stem, length);
    else res = renderPluckStem(stem, length);
    const { buf: buffer, peak } = res;
    // Peak safety: only touch stems that would clip.
    if (peak > 0.99) {
      const scale = 0.95 / peak;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] *= scale;
      }
    }
    return { id: stem.id, name: stem.name, buffer };
  });
}
