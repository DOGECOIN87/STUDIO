/**
 * Microphone capture for recording onto a track.
 *
 * The input runs through a small AudioWorklet tap that sends back blocks of
 * mono samples, each stamped with the audio-clock time it was captured at.
 * Those stamps let the studio place a take exactly on the beat, after
 * removing the device's input and output latency.
 *
 * Kept compatible with old browsers (Galaxy Note 3 / Chrome 95, Safari 14):
 * no structuredClone, no top-level await. Needs a secure page (https) for
 * the microphone, like every browser requires.
 */

const TAP_SOURCE = `
class StudioRecTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.t0 = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush" || e.data === "stop") this.flush();
      if (e.data === "stop") this.on = false;
    };
  }
  flush() {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ t: this.t0, data: out }, [out.buffer]);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0];
    if (this.on && ch && ch.length) {
      const a = ch[0];
      const b = ch[1];
      if (this.n === 0) this.t0 = currentTime;
      for (let i = 0; i < a.length; i++) {
        this.buf[this.n++] = b ? (a[i] + b[i]) * 0.5 : a[i];
        if (this.n === this.buf.length) {
          this.port.postMessage({ t: this.t0, data: this.buf }, [this.buf.buffer]);
          this.buf = new Float32Array(4096);
          this.n = 0;
          this.t0 = currentTime + (i + 1) / sampleRate;
        }
      }
    }
    return this.on;
  }
}
registerProcessor("studio-rec-tap", StudioRecTap);
`;

const tapReady = new WeakMap(); // AudioContext -> Promise

function loadTap(ctx) {
  if (!tapReady.has(ctx)) {
    const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: "text/javascript" }));
    tapReady.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)));
  }
  return tapReady.get(ctx);
}

/** True where this browser can record from a microphone. */
export function recordingSupported() {
  return !!(
    window.isSecureContext &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    window.AudioWorkletNode
  );
}

/**
 * Opens the microphone. Returns an input you can meter, monitor and record from.
 * Throws the browser's error (NotAllowedError when permission is refused).
 */
export async function openInput(ctx) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  await loadTap(ctx);
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048; // long enough to hear a low E on a bass for the tuner
  source.connect(analyser);
  const track = stream.getAudioTracks()[0];
  const settings = (track && track.getSettings && track.getSettings()) || {};
  let monitorTarget = null;
  let tap = null;
  let sink = null;
  let chunks = [];
  const meterBuf = new Float32Array(analyser.fftSize);

  return {
    /** Device input latency in seconds, where the browser reports it. */
    inputLatency: Number.isFinite(settings.latency) ? settings.latency : 0,
    label: (track && track.label) || "Microphone",

    /** Peak level 0..1 right now. */
    level() {
      analyser.getFloatTimeDomainData(meterBuf);
      let peak = 0;
      for (let i = 0; i < meterBuf.length; i++) peak = Math.max(peak, Math.abs(meterBuf[i]));
      return peak;
    },

    /**
     * The pitch being played, for the tuner: { hz, clarity 0..1 }, or null when it is
     * too quiet or not a clear note. Normalised autocorrelation over 50–1200 Hz with
     * parabolic refinement.
     */
    pitch() {
      analyser.getFloatTimeDomainData(meterBuf);
      const n = meterBuf.length;
      let energy = 0;
      for (let i = 0; i < n; i++) energy += meterBuf[i] * meterBuf[i];
      if (Math.sqrt(energy / n) < 0.01) return null;
      const sr = ctx.sampleRate;
      const minLag = Math.floor(sr / 1200);
      const maxLag = Math.min(n - 2, Math.floor(sr / 50));
      const corr = new Float32Array(maxLag + 2);
      for (let lag = minLag; lag <= maxLag + 1; lag++) {
        let c = 0;
        let e1 = 0;
        let e2 = 0;
        for (let i = 0; i + lag < n; i++) {
          c += meterBuf[i] * meterBuf[i + lag];
          e1 += meterBuf[i] * meterBuf[i];
          e2 += meterBuf[i + lag] * meterBuf[i + lag];
        }
        corr[lag] = e1 && e2 ? c / Math.sqrt(e1 * e2) : 0;
      }
      let peak = 0;
      for (let lag = minLag; lag <= maxLag; lag++) peak = Math.max(peak, corr[lag]);
      if (peak < 0.8) return null;
      // The first lag that comes close to the best match is the fundamental (not an octave below).
      let lag = minLag;
      while (lag < maxLag && !(corr[lag] >= peak * 0.92 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1])) lag++;
      const a = corr[lag - 1];
      const b = corr[lag];
      const c = corr[lag + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      return { hz: sr / (lag + (Number.isFinite(shift) ? shift : 0)), clarity: b };
    },

    /** Sends the input into `node` (a track's input) so you hear it through the track; null stops. */
    monitor(node) {
      if (monitorTarget) {
        try {
          source.disconnect(monitorTarget);
        } catch (_) {}
      }
      monitorTarget = node || null;
      if (monitorTarget) source.connect(monitorTarget);
    },

    /** Starts keeping samples (with their audio-clock times). */
    startCapture() {
      chunks = [];
      tap = new AudioWorkletNode(ctx, "studio-rec-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      tap.port.onmessage = (e) => chunks.push(e.data);
      // The tap must reach the destination to be processed; a silent gain keeps it quiet.
      sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(tap);
      tap.connect(sink);
      sink.connect(ctx.destination);
    },

    /** Stops keeping samples; resolves with [{ t, data }] in capture order. */
    stopCapture() {
      if (!tap) return Promise.resolve([]);
      const node = tap;
      tap = null;
      return new Promise((resolve) => {
        node.port.postMessage("stop");
        // Give the last block a moment to arrive.
        setTimeout(() => {
          try {
            source.disconnect(node);
            node.disconnect();
            sink.disconnect();
          } catch (_) {}
          resolve(chunks);
        }, 120);
      });
    },

    close() {
      this.monitor(null);
      try {
        source.disconnect();
      } catch (_) {}
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/**
 * Cuts captured chunks into one mono AudioBuffer covering ctx times [from, to),
 * after shifting every sample earlier by `latency` seconds.
 */
export function bufferForSpan(ctx, chunks, { from, to, latency }) {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.round((to - from) * sr));
  const out = ctx.createBuffer(1, length, sr);
  const dst = out.getChannelData(0);
  for (const c of chunks) {
    const start = Math.round((c.t - latency - from) * sr);
    const n = c.data.length;
    if (start >= length || start + n <= 0) continue;
    const s0 = Math.max(0, -start);
    const s1 = Math.min(n, length - start);
    dst.set(c.data.subarray(s0, s1), start + s0);
  }
  return out;
}
