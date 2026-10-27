/**
 * SoundFont 2 reader (from the SoundFont 2.01 specification; STUDIO's own code).
 *
 * parseSf2(arrayBuffer) -> { name, presets: [{ name, bank, program, zones }], sampleData }
 * Each zone is what one key/velocity range plays:
 *   { lokey, hikey, lovel, hivel, sample: { index, name, start, end, rate },
 *     root, tune (cents), keytrack (cents per key), loop: 0 none | 1 loop | 3 loop until release,
 *     loopStart, loopEnd (frames into the sample), attack, hold, decay, release, delay (s),
 *     sustain (0..1), gainDb, pan (-1..1), cutoff (Hz, 0 = open), cutGroup, cutBy }
 * Preset and instrument zones are combined as the specification says: ranges intersect,
 * the preset's values add to the instrument's. Samples are read on demand
 * (sampleBuffer) so a large file only costs memory for the sounds that play.
 */

const GEN = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  initialFilterFc: 8,
  endAddrsCoarseOffset: 12,
  pan: 17,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keynum: 46,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
};
// Generators whose values are ranges (two bytes) or unsigned.
const RANGE_GENS = new Set([GEN.keyRange, GEN.velRange]);
const UNSIGNED_GENS = new Set([GEN.instrument, GEN.sampleID, GEN.sampleModes, GEN.exclusiveClass, GEN.overridingRootKey, GEN.keynum]);
// Generators that only belong to instrument zones (a preset may not set them).
const INSTRUMENT_ONLY = new Set([0, 1, 2, 3, 4, 12, 45, 46, 47, 50, 53, 54, 57, 58]);

function readStr(view, off, len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = view.getUint8(off + i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s.replace(/[^\x20-\x7e]/g, "").trim();
}

/** The chunks inside a RIFF list: { id: { off, size } } (and LIST children by their type). */
function chunks(view, start, end) {
  const out = {};
  let p = start;
  while (p + 8 <= end) {
    const id = readStr(view, p, 4);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "LIST") out[readStr(view, body, 4)] = { off: body + 4, size: size - 4 };
    else out[id] = { off: body, size };
    p = body + size + (size & 1);
  }
  return out;
}

function readGens(view, c, count) {
  const gens = [];
  for (let i = 0; i < count; i++) {
    const o = c.off + i * 4;
    const op = view.getUint16(o, true);
    if (RANGE_GENS.has(op)) gens.push([op, [view.getUint8(o + 2), view.getUint8(o + 3)]]);
    else if (UNSIGNED_GENS.has(op)) gens.push([op, view.getUint16(o + 2, true)]);
    else gens.push([op, view.getInt16(o + 2, true)]);
  }
  return gens;
}

/** Zones of a preset or instrument: [{ gens: Map, global }] with the global zone folded in. */
function zonesOf(bagStart, bagEnd, bags, gens, terminalGen) {
  const zones = [];
  let global = null;
  for (let b = bagStart; b < bagEnd; b++) {
    const g0 = bags[b];
    const g1 = bags[b + 1];
    const map = new Map();
    for (let g = g0; g < g1 && g < gens.length; g++) map.set(gens[g][0], gens[g][1]);
    if (!map.has(terminalGen)) {
      // A first zone without an instrument / sample is the global zone.
      if (b === bagStart) global = map;
      continue;
    }
    zones.push(map);
  }
  return { zones, global };
}

export function parseSf2(buffer) {
  const view = new DataView(buffer);
  if (readStr(view, 0, 4) !== "RIFF" || readStr(view, 8, 4) !== "sfbk") throw new Error("This is not a SoundFont 2 (.sf2) file");
  const top = chunks(view, 12, Math.min(buffer.byteLength, 8 + view.getUint32(4, true)));
  if (!top.sdta || !top.pdta) throw new Error("This SoundFont is missing its sample or preset data");
  const info = top.INFO ? chunks(view, top.INFO.off, top.INFO.off + top.INFO.size) : {};
  const name = info.INAM ? readStr(view, info.INAM.off, info.INAM.size) : "";
  const sdta = chunks(view, top.sdta.off, top.sdta.off + top.sdta.size);
  if (!sdta.smpl) throw new Error("This SoundFont has no samples");
  const pdta = chunks(view, top.pdta.off, top.pdta.off + top.pdta.size);
  for (const id of ["phdr", "pbag", "pgen", "inst", "ibag", "igen", "shdr"]) {
    if (!pdta[id]) throw new Error(`This SoundFont is damaged (no ${id} list)`);
  }

  const smplOff = sdta.smpl.off;
  const smplFrames = sdta.smpl.size >> 1;

  const shdr = [];
  for (let i = 0; i + 1 < pdta.shdr.size / 46; i++) {
    const o = pdta.shdr.off + i * 46;
    shdr.push({
      index: i,
      name: readStr(view, o, 20),
      start: view.getUint32(o + 20, true),
      end: view.getUint32(o + 24, true),
      loopStart: view.getUint32(o + 28, true),
      loopEnd: view.getUint32(o + 32, true),
      rate: view.getUint32(o + 36, true) || 44100,
      pitch: view.getUint8(o + 40),
      correction: view.getInt8(o + 41),
      type: view.getUint16(o + 44, true),
    });
  }

  const bagList = (c) => {
    const n = c.size / 4;
    const out = [];
    for (let i = 0; i < n; i++) out.push(view.getUint16(c.off + i * 4, true));
    return out;
  };
  const pbag = bagList(pdta.pbag);
  const ibag = bagList(pdta.ibag);
  const pgen = readGens(view, pdta.pgen, pdta.pgen.size / 4);
  const igen = readGens(view, pdta.igen, pdta.igen.size / 4);

  const inst = [];
  for (let i = 0; i < pdta.inst.size / 22; i++) {
    const o = pdta.inst.off + i * 22;
    inst.push({ name: readStr(view, o, 20), bag: view.getUint16(o + 20, true) });
  }
  const phdr = [];
  for (let i = 0; i < pdta.phdr.size / 38; i++) {
    const o = pdta.phdr.off + i * 38;
    phdr.push({ name: readStr(view, o, 20), program: view.getUint16(o + 20, true), bank: view.getUint16(o + 22, true), bag: view.getUint16(o + 24, true) });
  }

  const instZones = [];
  for (let i = 0; i + 1 < inst.length; i++) instZones.push(zonesOf(inst[i].bag, inst[i + 1].bag, ibag, igen, GEN.sampleID));

  const presets = [];
  for (let i = 0; i + 1 < phdr.length; i++) {
    const h = phdr[i];
    const pz = zonesOf(h.bag, phdr[i + 1].bag, pbag, pgen, GEN.instrument);
    const zones = [];
    for (const p of pz.zones) {
      const iz = instZones[p.get(GEN.instrument)];
      if (!iz) continue;
      for (const z of iz.zones) {
        const zone = combine(z, iz.global, p, pz.global, shdr);
        if (zone) zones.push(zone);
      }
    }
    if (zones.length) presets.push({ name: h.name || `Preset ${i + 1}`, bank: h.bank, program: h.program, zones });
  }
  presets.sort((a, b) => a.bank - b.bank || a.program - b.program);
  if (!presets.length) throw new Error("This SoundFont has no playable presets");
  return { name, presets, sampleData: { buffer, off: smplOff, frames: smplFrames }, samples: shdr };
}

const tc = (v) => Math.pow(2, v / 1200); // timecents -> seconds

function combine(iz, iglobal, pz, pglobal, shdr) {
  const get = (op, def) => {
    if (iz.has(op)) return iz.get(op);
    if (iglobal && iglobal.has(op)) return iglobal.get(op);
    return def;
  };
  const add = (op) => {
    if (INSTRUMENT_ONLY.has(op)) return 0;
    if (pz.has(op)) return pz.get(op);
    if (pglobal && pglobal.has(op)) return pglobal.get(op);
    return 0;
  };
  const range = (op) => {
    const a = get(op, [0, 127]);
    const b = pz.has(op) ? pz.get(op) : pglobal && pglobal.has(op) ? pglobal.get(op) : [0, 127];
    return [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
  };
  const s = shdr[iz.get(GEN.sampleID)];
  if (!s || s.end <= s.start) return null;
  const [lokey, hikey] = range(GEN.keyRange);
  const [lovel, hivel] = range(GEN.velRange);
  if (lokey > hikey || lovel > hivel) return null;
  const sum = (op, def) => get(op, def) + add(op);
  const start = s.start + get(GEN.startAddrsOffset, 0) + 32768 * get(GEN.startAddrsCoarseOffset, 0);
  const end = s.end + get(GEN.endAddrsOffset, 0) + 32768 * get(GEN.endAddrsCoarseOffset, 0);
  const loopStart = s.loopStart + get(GEN.startloopAddrsOffset, 0) + 32768 * get(GEN.startloopAddrsCoarseOffset, 0);
  const loopEnd = s.loopEnd + get(GEN.endloopAddrsOffset, 0) + 32768 * get(GEN.endloopAddrsCoarseOffset, 0);
  const root = get(GEN.overridingRootKey, -1) >= 0 && get(GEN.overridingRootKey, -1) <= 127 ? get(GEN.overridingRootKey, -1) : s.pitch <= 127 ? s.pitch : 60;
  // Stereo halves play panned to their side when the zone does not set its own pan.
  let pan = sum(GEN.pan, 0) / 500;
  if (!pan && (s.type & 4) === 4) pan = -1;
  if (!pan && (s.type & 2) === 2) pan = 1;
  const fc = sum(GEN.initialFilterFc, 13500);
  return {
    lokey,
    hikey,
    lovel,
    hivel,
    sample: { index: s.index, name: s.name, start: s.start, end: s.end, rate: s.rate },
    offset: Math.max(0, start - s.start),
    length: Math.max(1, end - start),
    root,
    tune: sum(GEN.coarseTune, 0) * 100 + sum(GEN.fineTune, 0) + s.correction,
    keytrack: sum(GEN.scaleTuning, 100),
    loop: get(GEN.sampleModes, 0) & 3,
    loopStart: loopStart - start,
    loopEnd: loopEnd - start,
    delay: tc(sum(GEN.delayVolEnv, -12000)),
    attack: tc(sum(GEN.attackVolEnv, -12000)),
    hold: tc(sum(GEN.holdVolEnv, -12000)),
    decay: tc(sum(GEN.decayVolEnv, -12000)),
    sustain: Math.pow(10, -Math.max(0, Math.min(1440, sum(GEN.sustainVolEnv, 0))) / 200),
    release: tc(sum(GEN.releaseVolEnv, -12000)),
    gainDb: -Math.max(0, sum(GEN.initialAttenuation, 0)) / 10 * 0.4,
    pan: Math.max(-1, Math.min(1, pan)),
    cutoff: fc < 13500 ? 8.176 * Math.pow(2, fc / 1200) : 0,
    // Exclusive class: a note of the class cuts the others of it (open / closed hi-hat).
    cutGroup: get(GEN.exclusiveClass, 0),
    cutBy: get(GEN.exclusiveClass, 0),
  };
}

/** One sample's audio as an AudioBuffer (mono), from `start` for `length` frames. */
export function sampleBuffer(sf, zone) {
  const { buffer, off, frames } = sf.sampleData;
  const first = Math.min(frames, zone.sample.start + zone.offset);
  const n = Math.max(1, Math.min(frames - first, zone.length));
  const out = new AudioBuffer({ numberOfChannels: 1, length: n, sampleRate: Math.max(3000, Math.min(192000, zone.sample.rate)) });
  const d = out.getChannelData(0);
  const at = off + first * 2;
  if (at % 2 === 0) {
    const pcm = new Int16Array(buffer, at, n);
    for (let i = 0; i < n; i++) d[i] = pcm[i] / 32768;
  } else {
    const v = new DataView(buffer);
    for (let i = 0; i < n; i++) d[i] = v.getInt16(at + i * 2, true) / 32768;
  }
  return out;
}
