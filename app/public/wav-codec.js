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
 * are not bundled with this app, so every part is re-voiced here with the same
 * synthesis techniques the previous built-in demo used: pitch-enveloped kick,
 * noise snare/hats, detuned-saw Reese bass, decaying plucks and a vibrato lead.
 * Stem buffers are short pattern loops; the playlist clips arrange them.
 */
export function generateStemsFromSong(song, sampleRate = 44100) {
  const secPerBeat = 60 / song.bpm;

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const makeNoise = (seed) => {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s / 0xffffffff) * 2 - 1;
    };
  };
  const panGains = (pan) => {
    const p = Math.max(-1, Math.min(1, pan || 0));
    return [p <= 0 ? 1 : 1 - p, p >= 0 ? 1 : 1 + p];
  };

  function renderDrumStem(stem, length) {
    const buf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    const addKick = (start, amp) => {
      const dur = Math.floor(0.32 * sampleRate);
      let phase = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const freq = 48 + 125 * Math.exp(-t * 34);
        phase += (2 * Math.PI * freq) / sampleRate;
        const env = Math.exp(-t * 10.5);
        const click = Math.exp(-t * 180) * 0.35 * Math.sin(2 * Math.PI * 1600 * t);
        const s = Math.tanh((Math.sin(phase) * env + click) * 1.35) * amp;
        L[start + i] += s;
        R[start + i] += s;
      }
    };

    const addSnare = (start, amp, seed) => {
      const dur = Math.floor(0.24 * sampleRate);
      const noise = makeNoise(seed);
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const body = Math.sin(2 * Math.PI * (185 * Math.exp(-t * 14) + 110) * t) * Math.exp(-t * 22);
        const snap = noise() * Math.exp(-t * 15) * 0.7;
        const s = Math.tanh((body + snap) * 1.2) * amp;
        L[start + i] += s * 0.96;
        R[start + i] += s * 1.04;
      }
    };

    const addClap = (start, amp, seed) => {
      const dur = Math.floor(0.22 * sampleRate);
      const noise = makeNoise(seed);
      let lp = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const burst = Math.exp(-t * 55) + Math.exp(-Math.max(0, t - 0.02) * 55) + Math.exp(-Math.max(0, t - 0.04) * 30);
        const w = noise();
        lp += 0.35 * (w - lp);
        const s = lp * burst * amp * 0.9;
        L[start + i] += s;
        R[start + i] += s;
      }
    };

    const addHat = (start, amp, seed, open) => {
      const dur = Math.floor((open ? 0.26 : 0.065) * sampleRate);
      const decay = open ? 7 : 38;
      const noise = makeNoise(seed);
      let prev = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const white = noise();
        const hp = white - prev;
        prev = white * 0.82;
        const s = hp * Math.exp(-t * decay) * amp;
        L[start + i] += s * 0.9;
        R[start + i] += s * 1.1;
      }
    };

    const addTom = (start, amp) => {
      const dur = Math.floor(0.26 * sampleRate);
      let phase = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const freq = 92 + 85 * Math.exp(-t * 16);
        phase += (2 * Math.PI * freq) / sampleRate;
        const s = Math.sin(phase) * Math.exp(-t * 11) * amp;
        L[start + i] += s;
        R[start + i] += s;
      }
    };

    const addRim = (start, amp, seed) => {
      const dur = Math.floor(0.06 * sampleRate);
      const noise = makeNoise(seed);
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const ping = Math.sin(2 * Math.PI * 1720 * t) * Math.exp(-t * 90);
        const s = (ping * 0.7 + noise() * Math.exp(-t * 120) * 0.3) * amp;
        L[start + i] += s;
        R[start + i] += s;
      }
    };

    const addFx = (start, amp, seed) => {
      const dur = Math.floor(0.34 * sampleRate);
      const noise = makeNoise(seed);
      let phase = 0;
      let lp = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const frac = i / dur;
        const freq = 1400 - 1050 * frac;
        phase += (2 * Math.PI * freq) / sampleRate;
        const w = noise();
        lp += (0.12 + 0.5 * frac) * (w - lp);
        const env = Math.sin(Math.PI * frac) * Math.exp(-t * 2.2);
        const s = (Math.sin(phase) * 0.35 + lp * 0.4) * env * amp;
        L[start + i] += s * 0.85;
        R[start + i] += s * 1.15;
      }
    };

    (stem.hits || []).forEach((hit, idx) => {
      const beat = hit[0];
      const type = hit[1];
      const vel = hit[2] == null ? 0.8 : hit[2];
      const gain = hit[3] == null ? 1 : hit[3];
      const start = Math.floor(beat * secPerBeat * sampleRate);
      const amp = vel * gain;
      const seed = 1337 + idx * 7919;
      if (type === "kick") addKick(start, amp * 1.0);
      else if (type === "snare") addSnare(start, amp * 0.8, seed);
      else if (type === "clap") addClap(start, amp * 0.8, seed);
      else if (type === "hat") addHat(start, amp * 0.3, seed, false);
      else if (type === "tom") addTom(start, amp * 0.85);
      else if (type === "rim") addRim(start, amp * 0.6, seed);
      else if (type === "fx") addFx(start, amp * 0.55, seed);
      else addHat(start, amp * 0.22, seed, true); // perc: short open tick
    });
    return buf;
  }

  function renderNoteStem(stem, length) {
    const buf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const voice = stem.voice || "pluck";
    const stemGain = stem.gain == null ? 1 : stem.gain;

    for (const note of stem.notes || []) {
      const beat = note[0];
      const midi = note[1];
      const lenBeats = Math.max(0.08, note[2] || 0.25);
      const vel = (note[3] == null ? 0.8 : note[3]) * stemGain;
      const [lg, rg] = panGains(note[4]);
      const f0 = midiToFreq(midi);
      const start = Math.floor(beat * secPerBeat * sampleRate);
      const durSec = lenBeats * secPerBeat;
      const tailSec = voice === "lead" ? 0.14 : 0.05;
      const dur = Math.min(length - start, Math.floor((durSec + tailSec) * sampleRate));
      if (dur <= 0) continue;

      let p1 = 0;
      let p2 = 0;
      let lpL = 0;
      let lpR = 0;
      for (let i = 0; i < dur; i++) {
        const t = i / sampleRate;
        const rel = durSec + tailSec - t;
        let sL = 0;
        let sR = 0;

        if (voice === "reese") {
          const env = Math.min(1, t / 0.012) * Math.min(1, rel / 0.04);
          p1 += (2 * Math.PI * f0 * 0.996) / sampleRate;
          p2 += (2 * Math.PI * f0 * 1.004) / sampleRate;
          const sub = Math.sin((p1 + p2) / 2) * 0.62;
          const saw1 = ((p1 / Math.PI) % 2) - 1;
          const saw2 = ((p2 / Math.PI) % 2) - 1;
          const bite = Math.sin((p1 + p2) / 2 * 2) * 0.22 * Math.exp(-t * 3.5);
          sL = Math.tanh((sub + saw1 * 0.22 + bite) * env * 0.85) * vel;
          sR = Math.tanh((sub + saw2 * 0.22 + bite) * env * 0.85) * vel;
        } else if (voice === "stab") {
          const env = Math.min(1, t / 0.004) * (0.55 * Math.exp(-t * 7) + 0.45 * Math.exp(-t * 2.2)) * Math.min(1, rel / 0.03);
          p1 += (2 * Math.PI * f0 * 0.998) / sampleRate;
          p2 += (2 * Math.PI * f0 * 1.002) / sampleRate;
          const sawL = ((p1 / Math.PI) % 2) - 1;
          const sawR = ((p2 / Math.PI) % 2) - 1;
          lpL += 0.32 * (sawL - lpL);
          lpR += 0.32 * (sawR - lpR);
          sL = lpL * env * vel * 1.15;
          sR = lpR * env * vel * 1.15;
        } else if (voice === "lead") {
          const vib = 1 + 0.006 * Math.min(1, Math.max(0, (t - 0.15) / 0.3)) * Math.sin(2 * Math.PI * 5.2 * t);
          const env = Math.min(1, t / 0.03) * Math.min(1, rel / 0.09);
          p1 += (2 * Math.PI * f0 * 0.999 * vib) / sampleRate;
          p2 += (2 * Math.PI * f0 * 1.001 * vib) / sampleRate;
          const sawL = ((p1 / Math.PI) % 2) - 1;
          const sawR = ((p2 / Math.PI) % 2) - 1;
          lpL += 0.42 * (sawL - lpL);
          lpR += 0.42 * (sawR - lpR);
          const glow = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.7 * t);
          sL = (lpL * 0.8 + Math.sin(p1) * 0.25) * env * glow * vel * 0.9;
          sR = (lpR * 0.8 + Math.sin(p2) * 0.25) * env * glow * vel * 0.9;
        } else {
          // pluck (default): bright attack, exponential decay across the note
          const env = Math.min(1, t / 0.005) * Math.exp(-3.1 * (t / Math.max(0.05, durSec))) * Math.min(1, rel / 0.02);
          const harm = Math.sin(2 * Math.PI * f0 * 2 * t) * Math.exp(-t * 12) * 0.35;
          const sig = (Math.sin(2 * Math.PI * f0 * t) + harm) * env * vel * 0.85;
          sL = sig;
          sR = sig;
        }

        L[start + i] += sL * lg;
        R[start + i] += sR * rg;
      }
    }
    return buf;
  }

  return song.stems.map((stem) => {
    const length = Math.max(1, Math.floor(stem.lengthBeats * secPerBeat * sampleRate));
    const buffer = stem.voice === "drums" ? renderDrumStem(stem, length) : renderNoteStem(stem, length);
    // Peak safety: only touch stems that would clip.
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
    }
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
