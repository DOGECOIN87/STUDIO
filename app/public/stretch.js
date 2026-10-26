/**
 * Time-stretch without changing pitch (WSOLA: waveform-similarity overlap-add).
 *
 * The input is cut into overlapping windows; each one is placed at the output
 * hop and nudged by up to ±12 ms to the spot where it best continues the audio
 * already written, so beats and tones stay clean. All channels share the same
 * nudges, keeping the stereo image intact. Good for loops and stems; it runs on
 * the main thread in roughly 10–40 ms per second of audio.
 */

/**
 * @param {AudioBuffer} buffer
 * @param {number} stretch output length / input length (2 = twice as long, half the tempo)
 * @param {(channels: number, length: number, sampleRate: number) => AudioBuffer} makeBuffer
 */
export function stretchBuffer(buffer, stretch, makeBuffer) {
  const sr = buffer.sampleRate;
  const nIn = buffer.length;
  const nOut = Math.max(1, Math.round(nIn * stretch));
  const chs = buffer.numberOfChannels;
  const out = makeBuffer(chs, nOut, sr);
  if (Math.abs(stretch - 1) < 1e-4) {
    for (let c = 0; c < chs; c++) out.getChannelData(c).set(buffer.getChannelData(c).subarray(0, nOut));
    return out;
  }

  const win = Math.max(256, Math.round(sr * 0.046)); // ~46 ms windows
  const hopOut = win >> 1;
  const hopIn = hopOut / stretch;
  const tol = Math.round(sr * 0.012);
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));

  // Alignment is found on a decimated mono mix, then refined at full rate.
  const mono = new Float32Array(nIn);
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < nIn; i++) mono[i] += d[i] / chs;
  }
  const corr = (a, b, len, step) => {
    let s = 0;
    for (let i = 0; i < len; i += step) {
      const ia = a + i;
      const ib = b + i;
      if (ia < 0 || ib < 0 || ia >= nIn || ib >= nIn) continue;
      s += mono[ia] * mono[ib];
    }
    return s;
  };

  const ins = [];
  const outs = [];
  for (let c = 0; c < chs; c++) {
    ins.push(buffer.getChannelData(c));
    outs.push(out.getChannelData(c));
  }
  const norm = new Float32Array(nOut + win);
  let prev = 0; // where the last window was taken from
  for (let k = 0; k * hopOut < nOut; k++) {
    const nominal = Math.round(k * hopIn);
    let best = nominal;
    if (k > 0) {
      // The natural continuation of the last window, compared over the overlap.
      const target = prev + hopOut;
      const len = hopOut;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 8) {
        const sc = corr(nominal + d, target, len, 8);
        if (sc > bestScore) {
          bestScore = sc;
          best = nominal + d;
        }
      }
      const coarse = best;
      for (let d = -8; d <= 8; d++) {
        const sc = corr(coarse + d, target, len, 2);
        if (sc > bestScore) {
          bestScore = sc;
          best = coarse + d;
        }
      }
    }
    best = Math.max(0, Math.min(nIn - 1, best));
    const o = k * hopOut;
    for (let i = 0; i < win; i++) {
      const src = best + i;
      const dst = o + i;
      if (src >= nIn || dst >= nOut) break;
      const w = hann[i];
      for (let c = 0; c < chs; c++) outs[c][dst] += ins[c][src] * w;
      norm[dst] += w;
    }
    prev = best;
  }
  for (let i = 0; i < nOut; i++) {
    const n = norm[i];
    if (n > 1e-3) for (let c = 0; c < chs; c++) outs[c][i] /= n;
  }
  return out;
}

/** A tempo written in a file name ("Drum Loop 138bpm.wav", "128 BPM"), or 0. */
export function bpmFromName(name) {
  const m = /(\d{2,3}(?:\.\d+)?)\s*-?\s*bpm/i.exec(String(name || ""));
  const v = m ? Number(m[1]) : 0;
  return v >= 40 && v <= 260 ? v : 0;
}
