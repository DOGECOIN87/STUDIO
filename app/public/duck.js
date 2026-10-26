/**
 * Sidechain ducking: a track gets quieter whenever another track hits.
 *
 * An AudioWorklet with two inputs: 0 is the track being ducked, 1 the track
 * that triggers it. An envelope follower on input 1 (2 ms attack, adjustable
 * release) turns the trigger's level into gain reduction on input 0. Works the
 * same live and in the offline export.
 */

const SOURCE = `
class StudioDuck extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "amount", defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "release", defaultValue: 0.2, minValue: 0.02, maxValue: 1.5, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.env = 0;
  }
  process(inputs, outputs, params) {
    const main = inputs[0];
    const side = inputs[1];
    const out = outputs[0];
    const amount = params.amount[0];
    const rel = Math.exp(-1 / (params.release[0] * sampleRate));
    const att = Math.exp(-1 / (0.002 * sampleRate));
    const n = out[0].length;
    for (let i = 0; i < n; i++) {
      let level = 0;
      if (side && side.length) {
        for (let c = 0; c < side.length; c++) {
          const v = Math.abs(side[c][i]);
          if (v > level) level = v;
        }
      }
      this.env = level > this.env ? att * this.env + (1 - att) * level : rel * this.env;
      // Full reduction once the trigger reaches about -10 dBFS.
      const g = 1 - amount * Math.min(1, this.env / 0.3);
      for (let c = 0; c < out.length; c++) {
        const src = main && main.length ? main[c] || main[0] : null;
        out[c][i] = src ? src[i] * g : 0;
      }
    }
    return true;
  }
}
registerProcessor("studio-duck", StudioDuck);
`;

const loaded = new WeakMap(); // BaseAudioContext -> Promise

/** Loads the duck processor into a context once; resolves true when it can be used. */
export function loadDuck(ctx) {
  if (!ctx || !ctx.audioWorklet) return Promise.resolve(false);
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" }));
    loaded.set(
      ctx,
      ctx.audioWorklet
        .addModule(url)
        .then(() => true, () => false)
        .finally(() => URL.revokeObjectURL(url))
    );
  }
  return loaded.get(ctx);
}

/** A duck node: connect the ducked signal to input 0 and the trigger to input 1. */
export function createDuckNode(ctx, { amount = 0.6, release = 0.2 } = {}) {
  const node = new AudioWorkletNode(ctx, "studio-duck", {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  node.parameters.get("amount").value = amount;
  node.parameters.get("release").value = release;
  return node;
}

/** Clean settings: { source: trackId, amount 0..1, release seconds }, or undefined. */
export function sanitizeDuck(raw, trackIds) {
  if (!raw || typeof raw !== "object" || typeof raw.source !== "string" || !trackIds.has(raw.source)) return undefined;
  const amount = Number.isFinite(raw.amount) ? Math.max(0, Math.min(1, raw.amount)) : 0.6;
  const release = Number.isFinite(raw.release) ? Math.max(0.02, Math.min(1.5, raw.release)) : 0.2;
  return { source: raw.source, amount, release };
}
