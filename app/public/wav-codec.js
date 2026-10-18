/**
 * PulseForge DAW — Audio Codec, Waveform Peak Cache, Transient Detector & Stem Generator
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
 * Synthesizes 4 studio-ready stereo stems at a given BPM (4 bars each) so the user
 * has real musical stems loaded in the playlist immediately on launch.
 */
export function generateDemoStems(bpm = 124, sampleRate = 44100) {
  const beatsPerBar = 4;
  const bars = 4;
  const totalBeats = bars * beatsPerBar;
  const secPerBeat = 60 / bpm;
  const duration = totalBeats * secPerBeat;
  const length = Math.floor(duration * sampleRate);

  // 1. Drum Break Stem (Kick, Snare, Crisp Hats, Open Hat, Clap)
  const drumsBuf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  {
    const L = drumsBuf.getChannelData(0);
    const R = drumsBuf.getChannelData(1);

    const addKick = (beatPos, gain = 0.95) => {
      const start = Math.floor(beatPos * secPerBeat * sampleRate);
      const dur = Math.floor(0.32 * sampleRate);
      let phase = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const freq = 48 + 125 * Math.exp(-t * 34);
        phase += (2 * Math.PI * freq) / sampleRate;
        const env = Math.exp(-t * 10.5);
        const click = Math.exp(-t * 180) * 0.35 * Math.sin(2 * Math.PI * 1600 * t);
        const s = Math.tanh((Math.sin(phase) * env + click) * 1.35) * gain;
        L[start + i] += s;
        R[start + i] += s;
      }
    };

    const addSnare = (beatPos, gain = 0.75) => {
      const start = Math.floor(beatPos * secPerBeat * sampleRate);
      const dur = Math.floor(0.24 * sampleRate);
      let seed = 1337 + Math.floor(beatPos * 100);
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = (seed / 0xffffffff) * 2 - 1;
        const body = Math.sin(2 * Math.PI * (185 * Math.exp(-t * 14) + 110) * t) * Math.exp(-t * 22);
        const snap = noise * Math.exp(-t * 15) * 0.7;
        const s = Math.tanh((body + snap) * 1.2) * gain;
        L[start + i] += s * 0.96;
        R[start + i] += s * 1.04;
      }
    };

    const addHat = (beatPos, open = false, pan = 0.15) => {
      const start = Math.floor(beatPos * secPerBeat * sampleRate);
      const decay = open ? 6.5 : 38;
      const dur = Math.floor((open ? 0.28 : 0.065) * sampleRate);
      let seed = 9001 + Math.floor(beatPos * 313);
      let prev = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const white = (seed / 0xffffffff) * 2 - 1;
        const hp = white - prev;
        prev = white * 0.82;
        const env = Math.exp(-t * decay);
        const s = hp * env * (open ? 0.34 : 0.26);
        L[start + i] += s * (1 - pan);
        R[start + i] += s * (1 + pan);
      }
    };

    for (let bar = 0; bar < bars; bar++) {
      const b0 = bar * 4;
      addKick(b0 + 0, 0.95);
      addKick(b0 + 1.5, 0.72);
      addKick(b0 + 2.5, 0.88);
      if (bar % 2 === 1) addKick(b0 + 3.75, 0.65);

      addSnare(b0 + 1.0, 0.82);
      addSnare(b0 + 3.0, 0.85);
      if (bar === 3) addSnare(b0 + 3.5, 0.55);

      for (let step = 0; step < 8; step++) {
        const isOpen = step === 3 || step === 7;
        addHat(b0 + step * 0.5, isOpen, step % 2 === 0 ? -0.15 : 0.15);
      }
    }
  }

  // 2. Reese / Sub Bassline Stem (F minor progression: Fm -> D# -> C# -> D#)
  const bassBuf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  {
    const L = bassBuf.getChannelData(0);
    const R = bassBuf.getChannelData(1);
    const notes = [
      { start: 0, len: 1.5, midi: 41 },
      { start: 1.5, len: 1.0, midi: 41 },
      { start: 2.5, len: 1.5, midi: 44 },
      { start: 4.0, len: 1.5, midi: 39 },
      { start: 5.5, len: 1.0, midi: 39 },
      { start: 6.5, len: 1.5, midi: 43 },
      { start: 8.0, len: 1.5, midi: 37 },
      { start: 9.5, len: 1.0, midi: 37 },
      { start: 10.5, len: 1.5, midi: 41 },
      { start: 12.0, len: 1.5, midi: 39 },
      { start: 13.5, len: 1.0, midi: 43 },
      { start: 14.5, len: 1.5, midi: 44 },
    ];
    for (const n of notes) {
      const f0 = 440 * Math.pow(2, (n.midi - 69) / 12);
      const start = Math.floor(n.start * secPerBeat * sampleRate);
      const dur = Math.floor(n.len * secPerBeat * sampleRate);
      let p1 = 0, p2 = 0, pSub = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const rel = (dur - i) / sampleRate;
        const env = Math.min(1, t / 0.012) * Math.min(1, rel / 0.04);
        pSub += (2 * Math.PI * f0) / sampleRate;
        p1 += (2 * Math.PI * (f0 * 0.996)) / sampleRate;
        p2 += (2 * Math.PI * (f0 * 1.004)) / sampleRate;
        const sub = Math.sin(pSub) * 0.62;
        const saw1 = ((p1 / Math.PI) % 2) - 1;
        const saw2 = ((p2 / Math.PI) % 2) - 1;
        const filt = Math.sin(pSub * 2) * 0.22 * Math.exp(-t * 3.5);
        L[start + i] += Math.tanh((sub + saw1 * 0.22 + filt) * env * 0.85);
        R[start + i] += Math.tanh((sub + saw2 * 0.22 + filt) * env * 0.85);
      }
    }
  }

  // 3. Lush Electric Keys / Pad Chords Stem
  const chordsBuf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  {
    const L = chordsBuf.getChannelData(0);
    const R = chordsBuf.getChannelData(1);
    const chords = [
      { start: 0, len: 4, midi: [65, 68, 72, 75] },   // Fm7
      { start: 4, len: 4, midi: [63, 67, 70, 74] },   // EbMaj7
      { start: 8, len: 4, midi: [61, 65, 68, 72] },   // DbMaj7
      { start: 12, len: 4, midi: [63, 67, 70, 75] },  // Eb6
    ];
    for (const ch of chords) {
      const start = Math.floor(ch.start * secPerBeat * sampleRate);
      const dur = Math.floor(ch.len * secPerBeat * sampleRate);
      const freqs = ch.midi.map((m) => 440 * Math.pow(2, (m - 69) / 12));
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const rel = (dur - i) / sampleRate;
        const env = Math.min(1, t / 0.04) * Math.min(1, rel / 0.12) * (0.75 + 0.25 * Math.exp(-t * 2.2));
        let sL = 0, sR = 0;
        for (let k = 0; k < freqs.length; k++) {
          const f = freqs[k];
          const tine = Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 7) * 0.14;
          const vL = Math.sin(2 * Math.PI * (f - 0.4) * t + tine);
          const vR = Math.sin(2 * Math.PI * (f + 0.4) * t + tine);
          const pan = (k / (freqs.length - 1)) * 0.5 - 0.25;
          sL += vL * (1 - pan);
          sR += vR * (1 + pan);
        }
        const trem = 0.9 + 0.1 * Math.sin(2 * Math.PI * 4.2 * t);
        L[start + i] += (sL / freqs.length) * env * trem * 0.55;
        R[start + i] += (sR / freqs.length) * env * trem * 0.55;
      }
    }
  }

  // 4. Synth Pluck Arpeggio Stem
  const arpBuf = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  {
    const L = arpBuf.getChannelData(0);
    const R = arpBuf.getChannelData(1);
    const pattern = [
      77, 75, 72, 68, 72, 75, 77, 80,
      75, 74, 70, 67, 70, 74, 75, 79,
      73, 72, 68, 65, 68, 72, 73, 77,
      75, 79, 82, 79, 75, 74, 70, 67,
    ];
    const stepBeats = 0.5;
    for (let idx = 0; idx < pattern.length; idx++) {
      const f = 440 * Math.pow(2, (pattern[idx] - 69) / 12);
      const start = Math.floor(idx * stepBeats * secPerBeat * sampleRate);
      const dur = Math.floor(stepBeats * 1.35 * secPerBeat * sampleRate);
      const pan = ((idx % 4) - 1.5) * 0.22;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t / 0.005) * Math.exp(-t * 6.8);
        const harm = Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 14) * 0.35;
        const sig = (Math.sin(2 * Math.PI * f * t) + harm) * env * 0.45;
        L[start + i] += sig * (1 - pan);
        R[start + i] += sig * (1 + pan);
      }
    }
  }

  return [
    { id: "stem-drums", name: "Breakbeat Drums 124bpm.wav", color: "#CC0FE0", buffer: drumsBuf },
    { id: "stem-bass", name: "Reese Sub Bass Fm.wav", color: "#7E1BCC", buffer: bassBuf },
    { id: "stem-chords", name: "Warm Electric Chords.wav", color: "#1BA1F1", buffer: chordsBuf },
    { id: "stem-arp", name: "Pluck Synth Lead Arp.wav", color: "#C67CFF", buffer: arpBuf },
  ];
}
