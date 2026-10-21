/**
 * Audius Studio — Real-Time & Offline Multi-Track Audio Engine
 */
import { createReversedAudioBuffer } from "./wav-codec.js";
import {
  createGateNodes,
  applyGateRouting,
  scheduleAllGates,
} from "./gate-shaper.js";

export function dbToGain(db) {
  if (db <= -60) return 0;
  return Math.pow(10, db / 20);
}

/** Last beat the transport schedules audio for, given the current project. */
export function getPassEndBeat(project) {
  return project.loopEnabled
    ? project.loopEndBeat
    : Math.max(128, ...project.clips.map((c) => c.startBeat + c.durationBeats + 8));
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterCompressor = null;
    this.analyserL = null;
    this.analyserR = null;
    this.splitter = null;
    this.trackNodes = new Map(); // trackId -> { input, eqLow, eqMid, eqHigh, pan, gate, gain, analyser }
    this.masterGate = null; // Gate Shaper insert on the master bus
    this.activeSources = [];
    this.isPlaying = false;
    this.startWallTime = 0;
    this.startBeatOffset = 0;
    this.currentBeat = 0;
    this.metronomeTimer = null;
    this.lastScheduledMetronomeBeat = -1;
    this.reversedBufferCache = new WeakMap();
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.liveVoices = new Set(); // held MIDI / audition voices, released on note-off
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: "interactive" });

      this.masterCompressor = this.ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -1.5;
      this.masterCompressor.knee.value = 6;
      this.masterCompressor.ratio.value = 12;
      this.masterCompressor.attack.value = 0.003;
      this.masterCompressor.release.value = 0.15;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.9;

      this.splitter = this.ctx.createChannelSplitter(2);
      this.analyserL = this.ctx.createAnalyser();
      this.analyserR = this.ctx.createAnalyser();
      this.analyserL.fftSize = 1024;
      this.analyserR.fftSize = 1024;

      this.masterGate = createGateNodes(this.ctx);
      this.masterCompressor.connect(this.masterGate.input);
      this.masterGate.output.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  getReversedBuffer(audioBuffer) {
    let rev = this.reversedBufferCache.get(audioBuffer);
    if (!rev) {
      rev = createReversedAudioBuffer(audioBuffer);
      this.reversedBufferCache.set(audioBuffer, rev);
    }
    return rev;
  }

  async decodeAudioFile(arrayBuffer) {
    const ctx = this.ensureContext();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  syncTrackNodes(project) {
    if (!this.ctx) return;
    const anySolo = project.tracks.some((t) => t.solo);

    for (const track of project.tracks) {
      let nodes = this.trackNodes.get(track.id);
      if (!nodes) {
        const input = this.ctx.createGain();
        const eqLow = this.ctx.createBiquadFilter();
        eqLow.type = "lowshelf";
        eqLow.frequency.value = 120;

        const eqMid = this.ctx.createBiquadFilter();
        eqMid.type = "peaking";
        eqMid.frequency.value = 1100;
        eqMid.Q.value = 0.9;

        const eqHigh = this.ctx.createBiquadFilter();
        eqHigh.type = "highshelf";
        eqHigh.frequency.value = 6500;

        const pan = this.ctx.createStereoPanner();
        const gate = createGateNodes(this.ctx);
        const gain = this.ctx.createGain();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 256;

        input.connect(eqLow);
        eqLow.connect(eqMid);
        eqMid.connect(eqHigh);
        eqHigh.connect(pan);
        pan.connect(gate.input);
        gate.output.connect(gain);
        gain.connect(analyser);
        analyser.connect(this.masterCompressor);

        nodes = { input, eqLow, eqMid, eqHigh, pan, gate, gain, analyser };
        this.trackNodes.set(track.id, nodes);
      }

      const audible = !track.muted && (!anySolo || track.solo);
      const targetGain = audible ? dbToGain(track.volumeDb ?? 0) : 0;
      nodes.gain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.01);
      nodes.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, track.pan ?? 0)), this.ctx.currentTime, 0.01);
      nodes.eqLow.gain.setTargetAtTime(track.eqLowDb ?? 0, this.ctx.currentTime, 0.01);
      nodes.eqMid.gain.setTargetAtTime(track.eqMidDb ?? 0, this.ctx.currentTime, 0.01);
      nodes.eqHigh.gain.setTargetAtTime(track.eqHighDb ?? 0, this.ctx.currentTime, 0.01);
      applyGateRouting(nodes.gate, track.gateFx, this.ctx);
    }

    if (this.masterGate) {
      applyGateRouting(this.masterGate, project.masterGateFx, this.ctx);
    }

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        dbToGain(project.masterVolumeDb ?? 0),
        this.ctx.currentTime,
        0.01
      );
    }
  }

  stopAllSources() {
    for (const item of this.activeSources) {
      try {
        item.source.stop();
        item.source.disconnect();
      } catch (_) {}
    }
    this.activeSources = [];
    if (this.metronomeTimer) {
      clearInterval(this.metronomeTimer);
      this.metronomeTimer = null;
    }
  }

  /**
   * Live held voice for MIDI input: a pitched one-shot of the selected
   * instrument that can be released early by note-off. It runs through the
   * track's insert chain (EQ, pan, gate, fader) when a track id is given, and
   * through the master bus otherwise — never straight to the destination.
   *
   * @returns {{stop: (releaseSec?: number) => void, source: AudioBufferSourceNode}}
   */
  startLiveVoice({ buffer, rate = 1, velocity = 0.85, offsetSec = 0, trackId = null, pan = 0 } = {}) {
    const ctx = this.ensureContext();
    if (!buffer) return { stop() {}, source: null };
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.0625, Math.min(16, rate));

    const gain = ctx.createGain();
    // velocity 1..127 -> 0.03..1 of the instrument level; a soft key is still audible.
    const peak = Math.max(0.02, Math.min(1, velocity)) * 0.92;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    src.connect(gain);

    let tail = gain;
    if (ctx.createStereoPanner && pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      tail = panner;
    }
    const track = trackId ? this.trackNodes.get(trackId) : null;
    if (track) tail.connect(track.input);
    else tail.connect(this.masterGain);

    const startOffset = Math.max(0, Math.min(buffer.duration - 0.002, offsetSec || 0));
    try {
      src.start(now, startOffset);
    } catch (_) {
      return { stop() {}, source: null };
    }

    const voice = { source: src, gain, released: false };
    voice.stop = (releaseSec = 0.04) => {
      if (voice.released) return;
      voice.released = true;
      const t = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.01, releaseSec));
        src.stop(t + Math.max(0.01, releaseSec) + 0.005);
      } catch (_) {}
      this.liveVoices.delete(voice);
    };
    src.onended = () => {
      this.liveVoices.delete(voice);
      try {
        src.disconnect();
      } catch (_) {}
    };
    this.liveVoices.add(voice);
    return voice;
  }

  /** Silences every held live voice (device disconnect, panic, window close). */
  panicLiveVoices() {
    for (const voice of Array.from(this.liveVoices)) {
      try {
        voice.stop(0.02);
      } catch (_) {}
    }
    this.liveVoices.clear();
  }

  play(project, assetsMap, fromBeat = null) {
    const ctx = this.ensureContext();
    this.stopAllSources();
    this.syncTrackNodes(project);

    const startBeat = fromBeat != null ? fromBeat : this.currentBeat;
    const secPerBeat = 60 / project.bpm;
    const now = ctx.currentTime + 0.025;

    this.isPlaying = true;
    this.startBeatOffset = startBeat;
    this.startWallTime = now;

    this.scheduleClipsForPass(ctx, project, assetsMap, startBeat, now, this.trackNodes);
    scheduleAllGates({
      project,
      trackNodes: this.trackNodes,
      masterGate: this.masterGate,
      bpm: project.bpm,
      startBeat,
      endBeat: getPassEndBeat(project),
      t0: now,
    });

    if (project.metronome) {
      this.lastScheduledMetronomeBeat = Math.floor(startBeat) - 1;
      this.metronomeTimer = setInterval(() => {
        if (!this.isPlaying) return;
        const beatNow = this.getPlayheadBeat(project);
        const nextIntBeat = Math.floor(beatNow + 0.25);
        if (nextIntBeat > this.lastScheduledMetronomeBeat) {
          this.lastScheduledMetronomeBeat = nextIntBeat;
          const when = this.startWallTime + (nextIntBeat - this.startBeatOffset) * secPerBeat;
          if (when >= ctx.currentTime - 0.01) {
            this.triggerMetronomeClick(when, nextIntBeat % 4 === 0);
          }
        }
      }, 30);
    }
  }

  scheduleClipsForPass(ctx, project, assetsMap, passStartBeat, passStartCtxTime, trackNodesMap) {
    const secPerBeat = 60 / project.bpm;
    const passEndBeat = getPassEndBeat(project);

    for (const clip of project.clips) {
      if (clip.muted) continue;
      const asset = assetsMap.get(clip.assetId);
      if (!asset || !asset.buffer) continue;
      const trackNode = trackNodesMap.get(clip.trackId);
      if (!trackNode) continue;

      const clipStartBeat = clip.startBeat;
      const clipEndBeat = clip.startBeat + clip.durationBeats;

      if (clipEndBeat <= passStartBeat || clipStartBeat >= passEndBeat) continue;

      const effectiveStartBeat = Math.max(clipStartBeat, passStartBeat);
      const effectiveEndBeat = Math.min(clipEndBeat, passEndBeat);
      const skippedBeats = effectiveStartBeat - clipStartBeat;
      const playDurationSec = (effectiveEndBeat - effectiveStartBeat) * secPerBeat;
      if (playDurationSec <= 0.002) continue;

      const rate = Math.pow(2, (clip.pitchSemitones || 0) / 12) * (clip.playbackRate || 1);
      const buf = clip.reverse ? this.getReversedBuffer(asset.buffer) : asset.buffer;

      let sourceOffsetSec = (clip.sourceOffsetSec || 0) + skippedBeats * secPerBeat * rate;
      if (clip.reverse) {
        const origEndSec = (clip.sourceOffsetSec || 0) + clip.durationBeats * secPerBeat * rate;
        sourceOffsetSec = Math.max(0, buf.duration - origEndSec) + skippedBeats * secPerBeat * rate;
      }
      if (sourceOffsetSec >= buf.duration) continue;

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.playbackRate.value = rate;

      const clipGainNode = ctx.createGain();
      const clipPanNode = ctx.createStereoPanner();
      clipPanNode.pan.value = Math.max(-1, Math.min(1, clip.pan || 0));

      const baseGain = dbToGain(clip.gainDb || 0);
      const whenStart = passStartCtxTime + (effectiveStartBeat - passStartBeat) * secPerBeat;
      const whenEnd = whenStart + playDurationSec;

      const clipTotalSec = clip.durationBeats * secPerBeat;
      const fadeInSec = Math.min(clipTotalSec, Math.max(0, (clip.fadeInBeats || 0) * secPerBeat));
      const fadeOutSec = Math.min(clipTotalSec, Math.max(0, (clip.fadeOutBeats || 0) * secPerBeat));
      const clipAbsStart = passStartCtxTime + (clipStartBeat - passStartBeat) * secPerBeat;
      const clipAbsEnd = clipAbsStart + clipTotalSec;

      clipGainNode.gain.setValueAtTime(baseGain, whenStart);

      if (fadeInSec > 0.005 && whenStart < clipAbsStart + fadeInSec) {
        const initRatio = Math.max(0.0001, (whenStart - clipAbsStart) / fadeInSec);
        clipGainNode.gain.setValueAtTime(baseGain * initRatio, whenStart);
        clipGainNode.gain.linearRampToValueAtTime(
          baseGain,
          Math.min(whenEnd, clipAbsStart + fadeInSec)
        );
      }

      if (fadeOutSec > 0.005 && whenEnd > clipAbsEnd - fadeOutSec) {
        const fadeOutStart = Math.max(whenStart, clipAbsEnd - fadeOutSec);
        clipGainNode.gain.setValueAtTime(baseGain, fadeOutStart);
        clipGainNode.gain.linearRampToValueAtTime(0.0001, whenEnd);
      }

      source.connect(clipGainNode);
      clipGainNode.connect(clipPanNode);
      clipPanNode.connect(trackNode.input);

      const maxBufDur = Math.max(0.005, (buf.duration - sourceOffsetSec) / rate);
      const actualDur = Math.min(playDurationSec, maxBufDur);

      source.start(whenStart, sourceOffsetSec, actualDur);
      if (this.activeSources) {
        this.activeSources.push({ source, clipGainNode, clipPanNode });
      }
    }
  }

  triggerMetronomeClick(when, isDownbeat) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    const startFreq = isDownbeat ? 1568 : 1046.5;
    const endFreq = isDownbeat ? 1174.7 : 784;
    const peakGain = isDownbeat ? 0.24 : 0.17;
    osc.frequency.setValueAtTime(startFreq, when);
    osc.frequency.exponentialRampToValueAtTime(endFreq, when + 0.018);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peakGain, when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.042);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(when);
    osc.stop(when + 0.046);
  }

  pause(project) {
    if (this.isPlaying) {
      this.currentBeat = this.getPlayheadBeat(project);
      this.isPlaying = false;
      this.stopAllSources();
    }
  }

  stop(project) {
    this.isPlaying = false;
    this.stopAllSources();
    this.currentBeat = project?.loopEnabled ? project.loopStartBeat : 0;
  }

  seek(project, assetsMap, targetBeat) {
    this.currentBeat = Math.max(0, targetBeat);
    if (this.isPlaying) {
      this.play(project, assetsMap, this.currentBeat);
    }
  }

  getPlayheadBeat(project) {
    if (!this.isPlaying || !this.ctx) return this.currentBeat;
    const elapsedSec = Math.max(0, this.ctx.currentTime - this.startWallTime);
    const elapsedBeats = elapsedSec * (project.bpm / 60);
    let beat = this.startBeatOffset + elapsedBeats;

    if (
      project.loopEnabled &&
      project.loopEndBeat > project.loopStartBeat + 0.25 &&
      beat >= project.loopEndBeat
    ) {
      const loopLen = project.loopEndBeat - project.loopStartBeat;
      const wrapped = project.loopStartBeat + ((beat - project.loopStartBeat) % loopLen);
      return wrapped;
    }
    return beat;
  }

  getMasterLevels() {
    if (!this.analyserL || !this.analyserR) return { left: 0, right: 0 };
    const bufL = new Float32Array(this.analyserL.fftSize);
    const bufR = new Float32Array(this.analyserR.fftSize);
    this.analyserL.getFloatTimeDomainData(bufL);
    this.analyserR.getFloatTimeDomainData(bufR);
    let peakL = 0, peakR = 0;
    for (let i = 0; i < bufL.length; i++) {
      const aL = Math.abs(bufL[i]);
      const aR = Math.abs(bufR[i]);
      if (aL > peakL) peakL = aL;
      if (aR > peakR) peakR = aR;
    }
    return { left: Math.min(1, peakL), right: Math.min(1, peakR) };
  }

  getTrackLevel(trackId) {
    const node = this.trackNodes.get(trackId);
    if (!node || !node.analyser) return 0;
    const buf = new Float32Array(node.analyser.fftSize);
    node.analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    return Math.min(1, peak);
  }

  /**
   * Offline faster-than-realtime render of the arrangement (or a specific range / single track stem).
   */
  async renderProjectOffline(project, assetsMap, options = {}) {
    const sampleRate = options.sampleRate || 44100;
    const secPerBeat = 60 / project.bpm;
    const startBeat = options.startBeat ?? 0;
    const maxClipEndBeat = project.clips.reduce(
      (m, c) => Math.max(m, c.startBeat + c.durationBeats),
      0
    );
    const endBeat =
      options.endBeat ??
      (project.loopEnabled && options.rangeMode === "loop"
        ? project.loopEndBeat
        : Math.max(4, maxClipEndBeat));

    const totalDurationSec = Math.max(0.5, (endBeat - startBeat) * secPerBeat + 0.15);
    const totalFrames = Math.ceil(totalDurationSec * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

    const masterComp = offlineCtx.createDynamicsCompressor();
    masterComp.threshold.value = -1.5;
    masterComp.knee.value = 6;
    masterComp.ratio.value = 12;
    masterComp.attack.value = 0.003;
    masterComp.release.value = 0.15;

    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = dbToGain(project.masterVolumeDb ?? 0);
    const masterGate = createGateNodes(offlineCtx);
    masterComp.connect(masterGate.input);
    masterGate.output.connect(masterGain);
    masterGain.connect(offlineCtx.destination);

    const anySolo = project.tracks.some((t) => t.solo);
    const offlineTrackNodes = new Map();

    for (const track of project.tracks) {
      if (options.onlyTrackId && track.id !== options.onlyTrackId) continue;
      const input = offlineCtx.createGain();
      const eqLow = offlineCtx.createBiquadFilter();
      eqLow.type = "lowshelf";
      eqLow.frequency.value = 120;
      eqLow.gain.value = track.eqLowDb ?? 0;

      const eqMid = offlineCtx.createBiquadFilter();
      eqMid.type = "peaking";
      eqMid.frequency.value = 1100;
      eqMid.Q.value = 0.9;
      eqMid.gain.value = track.eqMidDb ?? 0;

      const eqHigh = offlineCtx.createBiquadFilter();
      eqHigh.type = "highshelf";
      eqHigh.frequency.value = 6500;
      eqHigh.gain.value = track.eqHighDb ?? 0;

      const pan = offlineCtx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, track.pan ?? 0));

      const gain = offlineCtx.createGain();
      const audible = options.onlyTrackId
        ? true
        : !track.muted && (!anySolo || track.solo);
      gain.gain.value = audible ? dbToGain(track.volumeDb ?? 0) : 0;

      input.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(pan);
      const gate = createGateNodes(offlineCtx);
      pan.connect(gate.input);
      gate.output.connect(gain);
      gain.connect(masterComp);

      offlineTrackNodes.set(track.id, { input, gain, pan, gate });
    }

    const tempProject = {
      ...project,
      loopEnabled: true,
      loopStartBeat: startBeat,
      loopEndBeat: endBeat,
    };

    this.scheduleClipsForPass(
      offlineCtx,
      tempProject,
      assetsMap,
      startBeat,
      0,
      offlineTrackNodes
    );
    for (const track of project.tracks) {
      const n = offlineTrackNodes.get(track.id);
      if (n) applyGateRouting(n.gate, track.gateFx, offlineCtx, { immediate: true });
    }
    if (masterGate) applyGateRouting(masterGate, project.masterGateFx, offlineCtx, { immediate: true });
    scheduleAllGates({
      project,
      trackNodes: offlineTrackNodes,
      masterGate,
      bpm: project.bpm,
      startBeat,
      endBeat,
      t0: 0,
    });

    return await offlineCtx.startRendering();
  }
}
