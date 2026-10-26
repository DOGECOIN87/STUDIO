/**
 * MP3 encoding off the main thread, with the bundled LAME encoder
 * (vendor/lame.min.js, LGPL — see vendor/LAME-LICENSE.txt; lame.sourceforge.net).
 *
 * In:  { left: Float32Array, right: Float32Array | null, sampleRate, kbps }
 * Out: { progress: 0..1 } while encoding, then { done: true, chunks: [Uint8Array] }
 *      or { error: message }.
 */
/* global lamejs */
importScripts("/vendor/lame.min.js?v=1");

self.onmessage = (e) => {
  try {
    const { left, right, sampleRate, kbps } = e.data;
    const channels = right ? 2 : 1;
    const enc = new lamejs.Mp3Encoder(channels, sampleRate, kbps || 320);
    const toInt16 = (f) => {
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const v = Math.max(-1, Math.min(1, f[i]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      return out;
    };
    const L = toInt16(left);
    const R = right ? toInt16(right) : null;
    const block = 1152 * 32;
    const chunks = [];
    for (let i = 0, n = 0; i < L.length; i += block, n++) {
      const l = L.subarray(i, i + block);
      const out = R ? enc.encodeBuffer(l, R.subarray(i, i + block)) : enc.encodeBuffer(l);
      if (out.length) chunks.push(new Uint8Array(out));
      if (n % 8 === 0) self.postMessage({ progress: i / L.length });
    }
    const tail = enc.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    self.postMessage({ done: true, chunks }, chunks.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ error: (err && err.message) || String(err) });
  }
};
