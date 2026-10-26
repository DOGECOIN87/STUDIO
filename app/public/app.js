/**
 * Audius Studio — Main Playlist, Arrangement, Slicing, Multi-Touch & Inspector Controller
 */
import {
  encodeWavFromAudioBuffer,
  computeWaveformPeaks,
  detectTransients,
  generateStemsFromSong,
} from "./wav-codec.js";
import { DEMO_SONG } from "./demo-song.js";
import { AudioEngine, dbToGain } from "./audio-engine.js";
// The version query keeps a cached copy of a changed module from outliving app.js itself.
import { initGateShaper } from "./gate-shaper-ui.js?v=2";
import { MidiInput, midiNoteName } from "./midi-input.js?v=1";
import { createLmn3Controller } from "./lmn3-controller.js?v=1";
import {
  trendingTracks,
  searchTracks,
  trackStems,
  resolveLink,
  streamUrl,
  downloadUrl,
  canImport,
  fetchAudio,
  trackArtwork,
  trackLink,
} from "./audius-client.js?v=1";
import {
  parseSmf,
  buildSmf,
  smfToParts,
  noteMidi,
  MidiCodecError,
  MAX_MIDI_FILE_BYTES,
  MAX_IMPORT_PARTS,
  MIDI_PPQ,
} from "./midi-codec.js?v=1";
// The DAW API bridge is dormant unless the local server answers (Cloudflare Pages: never).
import { initApiBridge, apiError, hasLocalApi } from "./api-bridge.js?v=2";
import { WasmFxHost, MAX_PLUGIN_SLOTS } from "./wasm-fx-host.js?v=1";
import { initWasmFxUi } from "./wasm-fx-ui.js?v=1";
// Stock instruments (the Mammoth synth): channel glue here, DSP and editor load on first use.
import { createInstrumentManager, sanitizeInstruments, sanitizeSynthRenders } from "./instruments/instrument-manager.js?v=4";

// Canvas roundRect arrived in Chrome 99 and Safari 16. Older phones and tablets (a Galaxy Note 3
// tops out around Chrome 95) would throw on every playlist draw without this fallback.
if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, radii) {
    const r0 = Array.isArray(radii) ? radii[0] || 0 : radii || 0;
    const r = Math.max(0, Math.min(r0, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
  };
}

const engine = new AudioEngine();
// WASM effect host: user-loadable effects for the mixer (see wasm-fx-host.js).
const fxHost = new WasmFxHost();
engine.setPluginHost(fxHost);
// A plugin that throws is bypassed with a message; a plugin that reports its
// metadata clears a previous fault so re-enabling really is a retry.
engine.onPluginMeta = (key, slotId, meta) => {
  const list =
    key === "master"
      ? project.masterFxPlugins
      : (project.tracks.find((t) => t.id === key) || {}).fxPlugins;
  const slot = (Array.isArray(list) ? list : []).find((s) => s.id === slotId);
  if (!slot) return;
  if (slot.error && !slot.bypass) slot.error = null;
  if (!Array.isArray(slot.presets) || !slot.presets.length) slot.presets = meta.presets || [];
  if (fxUi) fxUi.refresh();
};
engine.onPluginError = (key, slotId, message) => {
  const list =
    key === "master"
      ? project.masterFxPlugins
      : (project.tracks.find((t) => t.id === key) || {}).fxPlugins;
  const slot = (Array.isArray(list) ? list : []).find((s) => s.id === slotId);
  // The chain builder records the message before calling this hook, so key the
  // guard on whether the fault was already handled, not on the text alone.
  if (!slot || (slot.error === message && slot.bypass)) return;
  slot.error = message;
  slot.bypass = true; // isolate the fault: the strip keeps playing, dry
  setStatus(`Effect bypassed: ${message}`, { kind: "error" });
  if (fxUi) fxUi.refresh();
  engine.invalidateFxChains();
  engine.syncPluginChains(project);
};

// Map of assetId -> { id, name, color, buffer, peaks, durationSec, sampleRate }
const assets = new Map();

// Undo / Redo stacks of serialized project states
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 60;

// Synth channels: Library / Step Rack rows backed by a stock instrument instead of a sample.
const instruments = createInstrumentManager({
  engine,
  assets,
  getProject: () => project,
  registerAsset: (id, name, color, buffer) => registerAsset(id, name, color, buffer),
  nextId: (prefix) => nextId(prefix),
  setStatus: (text, opts) => setStatus(text, opts),
  pushUndoState: () => pushUndoState(),
  onMutated: (text) => onProjectMutated(text),
  refreshLibrary: () => {
    renderAssetPool();
    renderChannelRack();
  },
  selectAsset: (id) => {
    ui.activeAssetId = id;
  },
});

// Official Audius Harmony Color Palettes / Studio Themes
const THEMES = {
  "audius-dark": {
    name: "Audius Signature Dark (#CC0FE0 / #7E1BCC)",
    canvasBg: "#1B1C2A",
    laneEven: "#222436",
    laneOdd: "#1D1F2F",
    laneSelected: "#31254B",
    laneBorder: "#353A51",
    rulerBg: "#25273B",
    rulerBorder: "#3C425D",
    playhead: "#1BA1F1",
    loopColor: "#CC0FE0",
    palette: ["#CC0FE0", "#7E1BCC", "#1BA1F1", "#C67CFF", "#15D864", "#FF9400", "#F9344C"],
  },
  // @audius/harmony `default-dark` primitives; see docs/HARMONY_TOKEN_MAP.md
  amoled: {
    name: "Audius Neue Dark (#0F0F0F & #806AD8 / #C67CFF)",
    canvasBg: "#0F0F0F",      // n-25
    laneEven: "#121212",      // derived, below n-50
    laneOdd: "#0D0D0D",       // derived
    laneSelected: "#261F40",  // p-100
    laneBorder: "#292929",    // n-150
    rulerBg: "#141414",       // n-50
    rulerBorder: "#292929",   // n-150
    playhead: "#C67CFF",      // secondary
    loopColor: "#806AD8",     // primary
    palette: ["#806AD8", "#C67CFF", "#9E8EE8", "#2A85E8", "#84DF64", "#EFB360", "#F94D62"],
  },
  daylight: {
    name: "Audius Day (Official Light Mode)",
    canvasBg: "#EFEFF1",
    laneEven: "#FFFFFF",
    laneOdd: "#F6F5F7",
    laneSelected: "#F0E0FF",
    laneBorder: "#D6D5DB",
    rulerBg: "#F7F7F8",
    rulerBorder: "#C3C1CB",
    playhead: "#CC0FE0",
    loopColor: "#7E1BCC",
    palette: ["#CC0FE0", "#7E1BCC", "#1BA1F1", "#A22FEB", "#0F9E48", "#FF9400", "#D0021B"],
  },
  forest: {
    name: "Audius Matrix Mode (#0BD90B / #00E252)",
    canvasBg: "#010B06",
    laneEven: "#06160B",
    laneOdd: "#031007",
    laneSelected: "#0E2D14",
    laneBorder: "#123F1B",
    rulerBg: "#081B0C",
    rulerBorder: "#166527",
    playhead: "#3EF56B",
    loopColor: "#0BD90B",
    palette: ["#0BD90B", "#00E252", "#20E290", "#3DF23D", "#1EEB6F", "#FFA524", "#F9344C"],
  },
  ocean: {
    name: "Audius Trending #1 Blue & Magenta",
    canvasBg: "#101626",
    laneEven: "#161F36",
    laneOdd: "#12192C",
    laneSelected: "#213054",
    laneBorder: "#283963",
    rulerBg: "#18223B",
    rulerBorder: "#2C3E69",
    playhead: "#1BA1F1",
    loopColor: "#CC0FE0",
    palette: ["#1BA1F1", "#CC0FE0", "#7E1BCC", "#58B9F4", "#15D864", "#FF9400", "#F9344C"],
  },
  amethyst: {
    name: "Audius Gold & Amethyst",
    canvasBg: "#150d1f",
    laneEven: "#1d122b",
    laneOdd: "#170e22",
    laneSelected: "#2a1a3e",
    laneBorder: "#3b2554",
    rulerBg: "#241734",
    rulerBorder: "#4a3366",
    playhead: "#00f5d4",
    loopColor: "#CC0FE0",
    palette: ["#CC0FE0", "#f59e0b", "#00f5d4", "#a855f7", "#38bdf8", "#10b981", "#ec4899"],
  },
  obsidian: {
    name: "Obsidian Violet & Cyan",
    canvasBg: "#0b0d14",
    laneEven: "#101420",
    laneOdd: "#0d101a",
    laneSelected: "#171f32",
    laneBorder: "#1f273b",
    rulerBg: "#121622",
    rulerBorder: "#273047",
    playhead: "#22d3ee",
    loopColor: "#8b5cf6",
    palette: ["#8b5cf6", "#06b6d4", "#f43f5e", "#10b981", "#38bdf8", "#a855f7", "#f59e0b"],
  },
  cyberpunk: {
    name: "Audius Underground Neon",
    canvasBg: "#090612",
    laneEven: "#110a20",
    laneOdd: "#0c0718",
    laneSelected: "#1e1038",
    laneBorder: "#2b184d",
    rulerBg: "#140c26",
    rulerBorder: "#382063",
    playhead: "#00f0ff",
    loopColor: "#ff2a85",
    palette: ["#ff2a85", "#00f0ff", "#9d4edd", "#00e676", "#ffbe0b", "#ff5ca1", "#7209b7"],
  },
  "platinum-slate": {
    name: "Audius Platinum Slate",
    canvasBg: "#1c212b",
    laneEven: "#232936",
    laneOdd: "#1e2430",
    laneSelected: "#2b3345",
    laneBorder: "#343d52",
    rulerBg: "#252b38",
    rulerBorder: "#3f4a63",
    playhead: "#1BA1F1",
    loopColor: "#C67CFF",
    palette: ["#1BA1F1", "#C67CFF", "#CC0FE0", "#15D864", "#7E1BCC", "#FF9400", "#F9344C"],
  },
  nordic: {
    name: "Audius Silver Ice",
    canvasBg: "#161920",
    laneEven: "#1b1f28",
    laneOdd: "#171b23",
    laneSelected: "#232936",
    laneBorder: "#2a303e",
    rulerBg: "#1e222b",
    rulerBorder: "#333a48",
    playhead: "#ebcb8b",
    loopColor: "#88c0d0",
    palette: ["#88c0d0", "#a3be8c", "#b48ead", "#ebcb8b", "#bf616a", "#81a1c1", "#d08770"],
  },
};

// Canvas colours come from the --cv-* tokens of the active theme (styles.css), so the arrangement,
// the piano roll and the scope follow the theme. The literals below are the fallback that keeps the
// canvas drawing if a token is missing; syncCanvasTheme() overwrites them from CSS on every theme change.
const CANVAS_TOKENS = {
  canvasBg: "--cv-bg",
  laneEven: "--cv-lane-even",
  laneOdd: "--cv-lane-odd",
  laneSelected: "--cv-lane-selected",
  laneBorder: "--cv-lane-border",
  rulerBg: "--cv-ruler-bg",
  rulerBorder: "--cv-ruler-border",
  rulerText: "--cv-ruler-text",
  rulerTextDim: "--cv-ruler-text-dim",
  tickBar: "--cv-tick-bar",
  tickBeat: "--cv-tick-beat",
  gridBar: "--cv-grid-bar",
  gridBeat: "--cv-grid-beat",
  gridSub: "--cv-grid-sub",
  playhead: "--cv-playhead",
  loopColor: "--cv-loop",
  loopShade: "--cv-loop-shade",
  marquee: "--cv-marquee",
  veil: "--cv-veil",
  wpLaneEven: "--cv-wp-lane-even",
  wpLaneOdd: "--cv-wp-lane-odd",
  wpLaneSelected: "--cv-wp-lane-selected",
  oscBg: "--cv-osc-bg",
  oscLine: "--cv-osc-line",
};

const CANVAS_FALLBACK = {
  rulerText: "#93a1b0",
  rulerTextDim: "#627080",
  tickBar: "#6b7988",
  tickBeat: "#3a4350",
  gridBar: "rgba(255, 255, 255, 0.16)",
  gridBeat: "rgba(255, 255, 255, 0.07)",
  gridSub: "rgba(255, 255, 255, 0.035)",
  loopShade: "rgba(54, 207, 201, 0.04)",
  marquee: "#36cfc9",
  veil: "rgba(11, 7, 22, 0.68)",
  wpLaneEven: "rgba(255, 255, 255, 0.025)",
  wpLaneOdd: "rgba(0, 0, 0, 0.18)",
  wpLaneSelected: "rgba(204, 15, 224, 0.12)",
  oscBg: "#171825",
  oscLine: "#CC0FE0",
};

for (const themeEntry of Object.values(THEMES)) {
  for (const [key, value] of Object.entries(CANVAS_FALLBACK)) {
    if (!(key in themeEntry)) themeEntry[key] = value;
  }
}

// Current UI state
const ui = {
  theme: "audius-dark",
  tool: "draw", // 'draw' | 'paint' | 'slice' | 'slip' | 'mute' | 'select' | 'delete' | 'pan'
  snapBeats: 0.5, // default 1/8 note (0.5 beat)
  swing: 0, // Step Rack swing: 0-75% of a 16th step added to every off step
  lastSnapBeats: 0.5,
  typingPiano: false, // Audius Ranked Ctrl+T Typing Keyboard to Piano Keyboard
  transportMode: "song", // 'pat' | 'song'
  activePatternIndex: 0,
  // Fallback shown only until loadBuiltInDemoArrangement() runs at startup and
  // replaces these with the demo session's real patterns (demo-song.js).
  patterns: [
    {
      name: "Pattern 1 — Beat & Arp",
      steps: {
        "stem-drums":    [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0],
        "stem-bass":     [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        "stem-arp":      [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        "stem-ostinato": [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        "stem-lead":     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      notes: [
        { id: "n1", row: 16, startStep: 0, lenSteps: 2, vel: 0.79, label: "C4" },
        { id: "n2", row: 9,  startStep: 4, lenSteps: 2, vel: 0.79, label: "G4" },
      ],
    },
  ],
  prDrag: null,
  clipboardClips: [],
  pixelsPerBeat: 48,
  scrollBeat: 0,
  scrollY: 0,
  trackHeight: 78,
  rulerHeight: window.matchMedia("(pointer: coarse), (hover: none)").matches ? 44 : 34,
  selectedClipIds: new Set(),
  selectedTrackId: "trk-1",
  activeAssetId: "stem-drums",
  contextClipId: null,
  contextBeat: 0,
  lastTapTime: 0,
  lastTapX: 0,
  lastTapY: 0,
  hoverBeat: 0,
  hoverTrackIndex: 0,
  hoverClipId: null,
  dragState: null, // active pointer drag operation
  activePointers: new Map(), // pointerId -> { x, y }
  pinchState: null,
  previewSource: null,
  wallpaper: "auto",
};

// Initial Project State
let project = {
  name: "Audius Studio Session",
  bpm: 124,
  masterFxPlugins: [],
  masterVolumeDb: 0,
  loopEnabled: true,
  loopStartBeat: 0,
  loopEndBeat: 16,
  metronome: false,
  markers: [
    { id: "m-1", beat: 0, name: "Intro", color: "#2dd4bf" },
    { id: "m-2", beat: 8, name: "Chopped Break", color: "#3b82f6" },
    { id: "m-3", beat: 16, name: "Outro", color: "#a855f7" },
  ],
  tracks: [
    { id: "trk-1", name: "1 · Drums Break", color: "#3b82f6", muted: false, solo: false, volumeDb: 0, pan: 0, eqLowDb: 1.5, eqMidDb: 0, eqHighDb: 1.0 },
    { id: "trk-2", name: "2 · Sub Reese Bass", color: "#2dd4bf", muted: false, solo: false, volumeDb: -1.5, pan: 0, eqLowDb: 2.0, eqMidDb: -1.0, eqHighDb: 0 },
    { id: "trk-3", name: "3 · Electric Chords", color: "#a855f7", muted: false, solo: false, volumeDb: -2.0, pan: -0.1, eqLowDb: -1.5, eqMidDb: 0.5, eqHighDb: 1.0 },
    { id: "trk-4", name: "4 · Pluck Lead Arp", color: "#38bdf8", muted: false, solo: false, volumeDb: -2.5, pan: 0.12, eqLowDb: 0, eqMidDb: 1.0, eqHighDb: 2.0 },
    { id: "trk-5", name: "5 · Vocal / Audio Cuts", color: "#10b981", muted: false, solo: false, volumeDb: 0, pan: 0, eqLowDb: 0, eqMidDb: 0, eqHighDb: 0 },
  ],
  clips: [],
};

// DOM References
const dom = {
  projectName: document.getElementById("project-name"),
  projectNameLabel: document.getElementById("project-name-label"),
  statusPill: document.getElementById("status-pill"),
  themeSelect: document.getElementById("theme-select"),
  wallpaperSelect: document.getElementById("wallpaper-select"),
  customAccentPicker: document.getElementById("custom-accent-picker"),
  customBgPicker: document.getElementById("custom-bg-picker"),
  btnPlay: document.getElementById("btn-play"),
  playIcon: document.getElementById("play-icon"),
  btnStop: document.getElementById("btn-stop"),
  btnLoop: document.getElementById("btn-loop"),
  btnMetro: document.getElementById("btn-metro"),
  btnTypingPiano: document.getElementById("btn-typing-piano"),
  btnFlShortcuts: document.getElementById("btn-fl-shortcuts"),
  shortcutsModal: document.getElementById("shortcuts-modal"),
  btnCloseShortcuts: document.getElementById("btn-close-shortcuts"),
  btnOkShortcuts: document.getElementById("btn-ok-shortcuts"),
  timeReadoutBox: document.getElementById("time-readout-box"),
  readoutBars: document.getElementById("readout-bars"),
  readoutTime: document.getElementById("readout-time"),
  bpmDown: document.getElementById("bpm-down"),
  bpmUp: document.getElementById("bpm-up"),
  bpmInput: document.getElementById("bpm-input"),
  masterVol: document.getElementById("master-vol"),
  meterL: document.getElementById("meter-l"),
  meterR: document.getElementById("meter-r"),
  fileImportInput: document.getElementById("file-import-input"),
  btnImportMidi: document.getElementById("btn-import-midi"),
  midiImportInput: document.getElementById("midi-import-input"),
  btnExportMidi: document.getElementById("btn-export-midi"),
  exportMidiHint: document.getElementById("export-midi-hint"),
  projectImportInput: document.getElementById("project-import-input"),
  btnImportAudio: document.getElementById("btn-import-audio"),
  btnExportModal: document.getElementById("btn-export-modal"),
  btnSaveProj: document.getElementById("btn-save-proj"),
  btnLoadProj: document.getElementById("btn-load-proj"),
  snapSelect: document.getElementById("snap-select"),
  btnSplitPlayhead: document.getElementById("btn-split-playhead"),
  btnCutHalf: document.getElementById("btn-cut-half"),
  btnChopBeat: document.getElementById("btn-chop-beat"),
  btnChopBar: document.getElementById("btn-chop-bar"),
  btnChopTransients: document.getElementById("btn-chop-transients"),
  btnDuplicateClip: document.getElementById("btn-duplicate-clip"),
  btnReverseClip: document.getElementById("btn-reverse-clip"),
  btnDeleteClip: document.getElementById("btn-delete-clip"),
  btnClearPlaylist: document.getElementById("btn-clear-playlist"),
  btnAddMarker: document.getElementById("btn-add-marker"),
  btnUndo: document.getElementById("btn-undo"),
  btnRedo: document.getElementById("btn-redo"),
  zoomSlider: document.getElementById("zoom-slider"),
  btnTogglePool: document.getElementById("btn-toggle-pool"),
  btnToggleChannelRack: document.getElementById("btn-toggle-channel-rack"),
  btnTogglePianoRoll: document.getElementById("btn-toggle-piano-roll"),
  btnToggleMixer: document.getElementById("btn-toggle-mixer"),
  btnToggleTrellis: document.getElementById("btn-toggle-trellis"),
  btnToggleInspector: document.getElementById("btn-toggle-inspector"),
  btnToggleGate: document.getElementById("btn-toggle-gate"),
  btnLayoutPreset: document.getElementById("btn-layout-preset"),
  btnModePat: document.getElementById("btn-mode-pat"),
  btnModeSong: document.getElementById("btn-mode-song"),
  oscCanvas: document.getElementById("osc-canvas"),
  patternSelect: document.getElementById("pattern-select"),
  btnStampPattern: document.getElementById("btn-stamp-pattern"),
  flUpperDock: document.getElementById("fl-upper-dock"),
  channelRackWindow: document.getElementById("channel-rack-window"),
  pianoRollWindow: document.getElementById("piano-roll-window"),
  mixerWindow: document.getElementById("mixer-window"),
  channelRackRows: document.getElementById("channel-rack-rows"),
  crPatternLabel: document.getElementById("cr-pattern-label"),
  crSwing: document.getElementById("cr-swing"),
  btnCrPlay: document.getElementById("btn-cr-play"),
  btnCrClear: document.getElementById("btn-cr-clear"),
  btnCloseChannelRack: document.getElementById("btn-close-channel-rack"),
  prChannelLabel: document.getElementById("pr-channel-label"),
  btnPrPlay: document.getElementById("btn-pr-play"),
  btnPrStamp: document.getElementById("btn-pr-stamp"),
  btnPrClear: document.getElementById("btn-pr-clear"),
  btnClosePianoRoll: document.getElementById("btn-close-piano-roll"),
  pianoRollCanvas: document.getElementById("piano-roll-canvas"),
  midiBar: document.getElementById("pr-midi-bar"),
  btnMidiEnable: document.getElementById("btn-midi-enable"),
  midiDeviceSelect: document.getElementById("midi-device-select"),
  midiChannelSelect: document.getElementById("midi-channel-select"),
  btnMidiRecord: document.getElementById("btn-midi-record"),
  midiStatus: document.getElementById("midi-status"),
  mixerStripsContainer: document.getElementById("mixer-strips-container"),
  mixerSelectedLabel: document.getElementById("mixer-selected-label"),
  fxTrackName: document.getElementById("fx-track-name"),
  btnMixerOpenInsp: document.getElementById("btn-mixer-open-insp"),
  btnCloseMixer: document.getElementById("btn-close-mixer"),
  btnClosePool: document.getElementById("btn-close-pool"),
  btnCloseTrellis: document.getElementById("btn-close-trellis"),
  btnCloseInspector: document.getElementById("btn-close-inspector"),
  btnClearPool: document.getElementById("btn-clear-pool"),
  btnReopenPool: document.getElementById("btn-reopen-pool"),
  clipContextMenu: document.getElementById("clip-context-menu"),
  ctxClipTitle: document.getElementById("ctx-clip-title"),
  ctxCloseBtn: document.getElementById("ctx-close-btn"),
  ctxSplitHere: document.getElementById("ctx-split-here"),
  ctxCutHalf: document.getElementById("ctx-cut-half"),
  ctxChopBeat: document.getElementById("ctx-chop-beat"),
  ctxChopTrans: document.getElementById("ctx-chop-trans"),
  ctxChopBar: document.getElementById("ctx-chop-bar"),
  ctxDuplicate: document.getElementById("ctx-duplicate"),
  ctxReverse: document.getElementById("ctx-reverse"),
  ctxFade: document.getElementById("ctx-fade"),
  ctxMute: document.getElementById("ctx-mute"),
  ctxDelete: document.getElementById("ctx-delete"),
  leftPanel: document.getElementById("left-panel"),
  rightPanel: document.getElementById("right-panel"),
  trellisDock: document.getElementById("trellis-dock"),
  selectedClipBadge: document.getElementById("selected-clip-badge"),
  btnNudgeLeft: document.getElementById("btn-nudge-left"),
  btnNudgeRight: document.getElementById("btn-nudge-right"),
  btnTrackUp: document.getElementById("btn-track-up"),
  btnTrackDown: document.getElementById("btn-track-down"),
  btnTrimShorter: document.getElementById("btn-trim-shorter"),
  btnTrimLonger: document.getElementById("btn-trim-longer"),
  btnFadeQuick: document.getElementById("btn-fade-quick"),
  trellisPadMatrix: document.getElementById("trellis-pad-matrix"),
  padStampMode: document.getElementById("pad-stamp-mode"),
  touchCounterBadge: document.getElementById("touch-counter-badge"),
  btnLoadDemo: document.getElementById("btn-load-demo"),
  btnAddSynth: document.getElementById("btn-add-synth"),
  btnCrAddSynth: document.getElementById("btn-cr-add-synth"),
  dropzoneBox: document.getElementById("dropzone-box"),
  assetList: document.getElementById("asset-list"),
  btnAddTrack: document.getElementById("btn-add-track"),
  trackHeadersList: document.getElementById("track-headers-list"),
  timelineViewport: document.getElementById("timeline-viewport"),
  playlistCanvas: document.getElementById("playlist-canvas"),
  vscrollRail: document.getElementById("vscroll-rail"),
  vscrollThumb: document.getElementById("vscroll-thumb"),
  minimapCanvas: document.getElementById("minimap-canvas"),
  hscrollSlider: document.getElementById("hscroll-slider"),
  cursorInfo: document.getElementById("cursor-info"),
  clipInspectorEmpty: document.getElementById("clip-inspector-empty"),
  clipInspector: document.getElementById("clip-inspector"),
  inspName: document.getElementById("insp-name"),
  inspStart: document.getElementById("insp-start"),
  inspDuration: document.getElementById("insp-duration"),
  inspOffset: document.getElementById("insp-offset"),
  inspColor: document.getElementById("insp-color"),
  inspGain: document.getElementById("insp-gain"),
  inspGainVal: document.getElementById("insp-gain-val"),
  inspPitch: document.getElementById("insp-pitch"),
  inspPitchVal: document.getElementById("insp-pitch-val"),
  inspPan: document.getElementById("insp-pan"),
  inspPanVal: document.getElementById("insp-pan-val"),
  inspFadeIn: document.getElementById("insp-fadein"),
  inspFadeOut: document.getElementById("insp-fadeout"),
  inspReverse: document.getElementById("insp-reverse"),
  inspMuted: document.getElementById("insp-muted"),
  inspChop1Bar: document.getElementById("insp-chop-1bar"),
  inspChop2Beat: document.getElementById("insp-chop-2beat"),
  inspChop1Beat: document.getElementById("insp-chop-1beat"),
  inspChopHalfBeat: document.getElementById("insp-chop-halfbeat"),
  inspChopTrans: document.getElementById("insp-chop-trans"),
  inspResetTrim: document.getElementById("insp-reset-trim"),
  trackInspTitle: document.getElementById("track-insp-title"),
  trkEqLow: document.getElementById("trk-eq-low"),
  trkEqLowVal: document.getElementById("trk-eq-low-val"),
  trkEqMid: document.getElementById("trk-eq-mid"),
  trkEqMidVal: document.getElementById("trk-eq-mid-val"),
  trkEqHigh: document.getElementById("trk-eq-high"),
  trkEqHighVal: document.getElementById("trk-eq-high-val"),
  exportModal: document.getElementById("export-modal"),
  btnCloseExport: document.getElementById("btn-close-export"),
  btnCancelExport: document.getElementById("btn-cancel-export"),
  btnRunExport: document.getElementById("btn-run-export"),
  exportFilename: document.getElementById("export-filename"),
  exportBitdepth: document.getElementById("export-bitdepth"),
  exportSamplerate: document.getElementById("export-samplerate"),
  exportRange: document.getElementById("export-range"),
  exportMode: document.getElementById("export-mode"),
  exportStatus: document.getElementById("export-status"),
  projectsModal: document.getElementById("projects-modal"),
  btnCloseProjects: document.getElementById("btn-close-projects"),
  btnCancelProjects: document.getElementById("btn-cancel-projects"),
  btnBrowseProjFile: document.getElementById("btn-browse-proj-file"),
  savedProjectsList: document.getElementById("saved-projects-list"),
};

function syncProjectNameLabel() {
  if (!dom.projectName || !dom.projectNameLabel) return;
  const name = dom.projectName.value.trim() || "Audius Studio Session";
  dom.projectNameLabel.textContent = name;
  dom.projectNameLabel.title = name;
  dom.projectNameLabel.setAttribute("aria-label", name);
}

let uidCounter = 100;
function nextId(prefix = "id") {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`;
}

// ---------------------------------------------------------------------------------------------
// Non-project preferences (theme, wallpaper, snap, tools, view zoom). The project itself lives
// in audius_studio_projects_v1; these stay in their own key so a project never drags the
// workspace layout along with it. Window open states are deliberately NOT kept: the first
// load is always the owner's default view (Library + Playlist).
// ---------------------------------------------------------------------------------------------
const PREFS_KEY = "audius_studio_prefs_v1";
let prefsSaveTimer = 0;

function savePrefs() {
  // Coalesce the writes a slider drag produces into one.
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = 0;
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          theme: ui.theme,
          wallpaper: ui.wallpaper,
          snapBeats: ui.snapBeats,
          tool: ui.tool,
          pixelsPerBeat: ui.pixelsPerBeat,
          trackHeight: ui.trackHeight,
          typingPiano: ui.typingPiano,
          metronome: !!project.metronome,
          loopEnabled: !!project.loopEnabled,
          masterVolumeDb: project.masterVolumeDb ?? 0,
        })
      );
    } catch (_) {
      // Storage blocked or full: the session simply keeps its current values.
    }
  }, 250);
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function applyPrefs(p) {
  if (!p || typeof p !== "object") return;
  if (typeof p.theme === "string" && THEMES[p.theme]) ui.theme = p.theme;
  if (typeof p.wallpaper === "string") ui.wallpaper = p.wallpaper;
  if (Number.isFinite(p.snapBeats)) ui.snapBeats = Math.max(0, Math.min(4, p.snapBeats));
  if (["draw", "paint", "slice", "slip", "mute", "select", "delete", "pan"].includes(p.tool)) {
    ui.tool = p.tool;
  }
  if (Number.isFinite(p.pixelsPerBeat)) {
    ui.pixelsPerBeat = Math.max(18, Math.min(160, p.pixelsPerBeat));
  }
  if (Number.isFinite(p.trackHeight)) {
    ui.trackHeight = Math.max(48, Math.min(130, p.trackHeight));
  }
  ui.typingPiano = !!p.typingPiano;
  if (typeof p.metronome === "boolean") project.metronome = p.metronome;
  if (typeof p.loopEnabled === "boolean") project.loopEnabled = p.loopEnabled;
  if (Number.isFinite(p.masterVolumeDb)) {
    project.masterVolumeDb = Math.max(-60, Math.min(12, p.masterVolumeDb));
  }
}

const MOTION_EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Runs a short Web Animation. With reduced motion the optional opacity/colour-only
 * keyframes are used instead, or nothing when none are given.
 */
function playMotion(el, keyframes, options, reducedKeyframes = null) {
  if (!el || typeof el.animate !== "function") return null;
  const frames = reducedMotionQuery.matches ? reducedKeyframes : keyframes;
  return frames ? el.animate(frames, { easing: MOTION_EASE_OUT, ...options }) : null;
}

// ---------------------------------------------------------------------------------------------
// Status line, hover/focus hint, polite live region and the compact-layout toast.
// setStatus() is the one place messages go; hover hints never overwrite a fresh message.
// ---------------------------------------------------------------------------------------------
const compactLayoutQuery = window.matchMedia("(max-width: 760px), (max-width: 900px) and (max-height: 520px)");

// Options is a fixed control in the top bar at every size (it no longer jumps between the
// header and the tool bar). See the popover layer near the toolbar wiring for its behaviour.
let statusText = dom.statusPill ? dom.statusPill.textContent : "";
let statusKind = "info";
let statusPinnedUntil = 0;
let firstInteractionDone = false;
let lastStatusMotionAt = 0;
let liveLastAt = 0;
let liveTimer = 0;
let toastTimer = 0;
let lastInputWasPointer = true;

function renderStatusLine(text, kind = "info") {
  if (!dom.statusPill) return;
  dom.statusPill.dataset.kind = kind;
  if (dom.statusPill.textContent === text) return;
  dom.statusPill.textContent = text;
  // Crossfade new messages, but not on every frame of a drag and never for hover hints.
  const now = performance.now();
  if (kind !== "hint" && kind !== "value" && now - lastStatusMotionAt > 400) {
    lastStatusMotionAt = now;
    playMotion(
      dom.statusPill,
      [{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }],
      { duration: 180 },
      [{ opacity: 0 }, { opacity: 1 }]
    );
  }
}

function writeLiveRegion(text) {
  const live = document.getElementById("status-live");
  if (!live) return;
  const flush = () => {
    liveLastAt = performance.now();
    liveTimer = 0;
    live.textContent = text;
  };
  const wait = 400 - (performance.now() - liveLastAt);
  if (wait <= 0) {
    flush();
  } else {
    // keep only the latest message and write it once the throttle window has passed
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(flush, wait);
  }
}

function showStatusToast(text, kind) {
  const toast = document.getElementById("status-toast");
  if (!toast) return;
  const wasVisible = !toast.hidden;
  toast.textContent = text;
  toast.dataset.kind = kind;
  toast.hidden = false;
  if (wasVisible) {
    // an update while visible restarts the timer without replaying the entrance
    toast.style.animation = "none";
  } else {
    toast.style.animation = "";
  }
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    toastTimer = 0;
  }, kind === "error" ? 6000 : 4000);
}

function setStatus(msg, { kind = "info" } = {}) {
  const text = String(msg);
  statusText = text;
  statusKind = kind;
  statusPinnedUntil = performance.now() + (kind === "error" ? 6000 : kind === "value" ? 1500 : 3000);
  renderStatusLine(text, kind);
  writeLiveRegion(text);
  if (firstInteractionDone) showStatusToast(text, kind);
}

/** Hover / focus hint: shows only when the last message has had its moment. */
function setHint(text) {
  if (!text || performance.now() < statusPinnedUntil) return;
  renderStatusLine(text, "hint");
}

function clearHint() {
  if (performance.now() < statusPinnedUntil || !statusText) return;
  renderStatusLine(statusText, statusKind);
}

/** A muted placeholder line for lists that are empty or loading. Built from nodes, never from markup strings. */
function makeEmptyState(...parts) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.append(...parts);
  return el;
}

/** Markup for a Lucide icon from the inline sprite in index.html. */
function icon(name, { solo = false } = {}) {
  return `<svg class="icon${solo ? " icon-solo" : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function setPlayIcon(playing) {
  dom.playIcon.innerHTML = icon(playing ? "pause" : "play", { solo: true });
  dom.btnPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
  playMotion(
    dom.playIcon,
    [{ transform: "scale(0.55)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }],
    { duration: 160 },
    [{ opacity: 0.4 }, { opacity: 1 }]
  );
}

/**
 * Beat pulse: while the transport runs, the play button rings and the song-position readout
 * flashes on every beat, harder on each bar's downbeat. Driven by the engine's playhead, so it
 * follows tempo changes, loops and seeks.
 */
function pulseBeat(beatIndex) {
  const downbeat = beatIndex % 4 === 0;
  const duration = Math.min(420, (60000 / project.bpm) * 0.85);
  const accent = getComputedStyle(document.body).getPropertyValue("--accent-orange").trim() || "#CC0FE0";
  // The ring is an outline, so it must not run over the keyboard focus ring; reduced motion gets a
  // brief brightness flash on the play button instead of the expanding ring.
  if (!isFocusVisible(dom.btnPlay)) {
    playMotion(
      dom.btnPlay,
      [
        { outlineStyle: "solid", outlineWidth: "2px", outlineColor: accent, outlineOffset: "0px" },
        { outlineStyle: "solid", outlineWidth: "2px", outlineColor: "transparent", outlineOffset: downbeat ? "9px" : "5px" },
      ],
      { duration },
      [{ filter: downbeat ? "brightness(1.6) saturate(1.2)" : "brightness(1.35) saturate(1.1)", offset: 0 }]
    );
  }
  playMotion(
    dom.readoutBars,
    [{ color: accent, transform: downbeat ? "scale(1.06)" : "scale(1.03)", offset: 0 }],
    { duration },
    [{ color: accent, offset: 0 }]
  );
}

function cloneProjectState(proj) {
  return JSON.parse(JSON.stringify(proj));
}

// History keeps the stem library with the project (AudioBuffers are shared by reference), so
// deleting a stem or clearing the library is as undoable as deleting a clip.
// Patterns (step grid, piano-roll notes, row mix) and the active pattern are part of the history too.
function snapshot() {
  return {
    project: cloneProjectState(project),
    // Assets are copied one level deep: their AudioBuffers are shared by
    // reference (they cannot be cloned), but per-asset flags such as the
    // channel mute switch are values, so undo restores them too.
    assets: new Map(Array.from(assets.entries(), ([id, a]) => [id, { ...a }])),
    patterns: cloneProjectState(ui.patterns),
    activePatternIndex: ui.activePatternIndex,
  };
}

function restoreSnapshot(snap) {
  project = snap.project;
  assets.clear();
  snap.assets.forEach((asset, id) => assets.set(id, asset));
  if (Array.isArray(snap.patterns) && snap.patterns.length > 0) {
    ui.patterns = cloneProjectState(snap.patterns);
    ui.activePatternIndex = Math.min(snap.activePatternIndex || 0, ui.patterns.length - 1);
    syncPatternSelect();
  }
  renderAssetPool();
  // Synth patches live in the project, so undo restores them: resend them to the live synths.
  instruments.syncLive();
}

/** One undo point per slider gesture (pointer down) or per key press on a continuous control. */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
function undoOnGesture(el) {
  if (!el) return;
  el.addEventListener("pointerdown", () => pushUndoState());
  // Only keys that move the slider; Ctrl+Z and other shortcuts must not add history entries.
  el.addEventListener("keydown", (e) => {
    if (SLIDER_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) pushUndoState();
  });
}

function pushUndoState() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  syncCommandAvailability();
}

function undo() {
  if (undoStack.length === 0) {
    setStatus("Nothing to undo");
    return;
  }
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  ui.selectedClipIds.clear();
  onProjectMutated("Undo applied");
  syncCommandAvailability();
}

function redo() {
  if (redoStack.length === 0) {
    setStatus("Nothing to redo");
    return;
  }
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  ui.selectedClipIds.clear();
  onProjectMutated("Redo applied");
  syncCommandAvailability();
}

/** One setter for every on/off control: the class is the visual hook, aria-pressed the state. */
function setLit(el, on) {
  if (!el) return;
  el.classList.toggle("active", !!on);
  el.setAttribute("aria-pressed", String(!!on));
}

/** Buttons that cannot act right now say so (aria-disabled), but stay focusable so their message still explains why. */
function setAvailable(el, available) {
  if (el) el.setAttribute("aria-disabled", String(!available));
}

function syncCommandAvailability() {
  setAvailable(dom.btnUndo, undoStack.length > 0);
  setAvailable(dom.btnRedo, redoStack.length > 0);
  const hasSelection = ui.selectedClipIds.size > 0;
  [dom.btnCutHalf, dom.btnChopBeat, dom.btnChopBar, dom.btnChopTransients, dom.btnDuplicateClip, dom.btnReverseClip, dom.btnDeleteClip]
    .forEach((btn) => setAvailable(btn, hasSelection));
  const hasClips = project.clips.length > 0;
  setAvailable(dom.btnSplitPlayhead, hasClips);
  setAvailable(dom.btnClearPlaylist, hasClips);
}

// ---------------------------------------------------------------------------------------------
// Range sliders: the track shows its value (--fill-from / --fill-to), bipolar sliders fill from
// zero, and a slider can be reset, read out in the status line and nudged from the keyboard.
// ---------------------------------------------------------------------------------------------
function syncRangeFill(el) {
  if (!el || el.dataset.fill === "none") return;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const span = max - min || 1;
  const pct = Math.max(0, Math.min(100, ((Number(el.value) - min) / span) * 100));
  const bipolar = el.hasAttribute("data-bipolar");
  const origin = bipolar ? Math.max(0, Math.min(100, ((0 - min) / span) * 100)) : 0;
  el.style.setProperty("--fill-from", `${Math.min(pct, origin)}%`);
  el.style.setProperty("--fill-to", `${Math.max(pct, origin)}%`);
}

/** Sets a slider value and keeps its fill in step (use instead of assigning .value). */
function setRange(el, value) {
  if (!el) return;
  el.value = value;
  syncRangeFill(el);
}

function formatRangeValue(el) {
  const v = Number(el.value);
  switch (el.dataset.format) {
    case "db":
      return `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`;
    case "pan":
      return Math.abs(v) < 0.03 ? "C" : v < 0 ? `${Math.round(Math.abs(v) * 100)}% L` : `${Math.round(v * 100)}% R`;
    case "st":
      return `${v >= 0 ? "+" : ""}${Math.round(v)} st`;
    default:
      return `${v}${el.dataset.unit || ""}`;
  }
}

function fireRangeEvents(el) {
  syncRangeFill(el);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function resetRange(el) {
  if (el.hasAttribute("data-no-reset")) return;
  if (el.dataset.default === undefined && !el.dataset.label) return;
  const fallback = el.dataset.default !== undefined ? el.dataset.default : el.getAttribute("value");
  if (fallback === null) return;
  el.value = fallback;
  fireRangeEvents(el);
}

function setupRangeBehaviour() {
  document.querySelectorAll('input[type="range"]').forEach(syncRangeFill);
  // capture phase: the fill and the read-out are ready before the control's own handler runs
  document.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      if (!el || el.type !== "range") return;
      syncRangeFill(el);
      const text = formatRangeValue(el);
      el.setAttribute("aria-valuetext", text);
      if (el.hasAttribute("data-silent") || !el.dataset.label) return;
      setStatus(`${el.dataset.label} ${text}`, { kind: "value" });
    },
    true
  );
  document.addEventListener("dblclick", (e) => {
    if (e.target && e.target.type === "range") resetRange(e.target);
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target;
      if (el && el.type === "range" && e.pointerType === "mouse" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        resetRange(el);
      }
    },
    true
  );
  // the wheel only moves a slider that has focus, so an unfocused slider never captures the page scroll
  document.addEventListener(
    "wheel",
    (e) => {
      const el = e.target;
      if (!el || el.type !== "range" || document.activeElement !== el) return;
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      if (e.deltaY < 0) el.stepUp(n);
      else if (e.deltaY > 0) el.stepDown(n);
      fireRangeEvents(el);
    },
    { passive: false }
  );
}

// A long press fires "contextmenu" on touch screens. Right-click deletes with one click, so a
// press-and-hold must never reach those handlers (it would delete what the finger rests on).
let lastTouchDownAt = 0;
document.addEventListener(
  "pointerdown",
  (e) => {
    firstInteractionDone = true;
    lastInputWasPointer = true;
    if (e.pointerType === "touch") lastTouchDownAt = performance.now();
  },
  true
);
document.addEventListener(
  "keydown",
  () => {
    firstInteractionDone = true;
    lastInputWasPointer = false;
  },
  true
);

function isTouchContextMenu(e) {
  return e.pointerType === "touch" || performance.now() - lastTouchDownAt < 800;
}

// ---------------------------------------------------------------------------------------------
// Keyboard ownership: which focused element keeps which key.
// ---------------------------------------------------------------------------------------------
const SELECT_KEYS = new Set(["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const RANGE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "url", "email", "password", "tel"]);

function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
}

/** Controls whose Space / Enter activation must work for keyboard users. */
function isKeyboardActivatable(el) {
  if (!el) return false;
  if (el.tagName === "BUTTON" || el.tagName === "SUMMARY" || el.tagName === "A" || el.getAttribute("role") === "button") return true;
  return el.tagName === "INPUT" && ["checkbox", "radio", "file", "color"].includes(el.type);
}

// How the focused control got focus. Chromium reports :focus-visible on the first keydown after a
// mouse click, so it cannot tell a clicked button from a tabbed-to one; this flag can. Pointer
// input sets lastInputWasPointer before focus moves, Tab sets it to false before focus moves.
let focusArrivedByKeyboard = false;
document.addEventListener("focusin", () => {
  focusArrivedByKeyboard = !lastInputWasPointer;
});

// Escape in a text field restores what it held when it gained focus.
document.addEventListener("focusin", (e) => {
  if (isTextEntry(e.target)) e.target.dataset.revertValue = e.target.value;
});

// A dropdown changed with the pointer gives focus back, so transport keys work right after.
document.addEventListener("change", (e) => {
  if (e.target && e.target.tagName === "SELECT" && lastInputWasPointer) e.target.blur();
});

// ---------------------------------------------------------------------------------------------
// Tooltip: one styled bubble for hover (mouse and pen) and keyboard focus. Never on touch.
// It borrows the element's title while shown so the native tooltip does not appear as well.
// ---------------------------------------------------------------------------------------------
let hideTooltipNow = () => {};
/** Coordinate-placed tooltip for canvas-drawn content (clips, markers, ruler). */
let canvasTip = { show: () => {}, hide: () => {} };

function setupTooltips() {
  let bubble = null;
  let target = null;
  let pending = null;
  let showTimer = 0;
  let guardTimer = 0;
  let hiddenAt = 0;
  const SELECTOR = "[title],[data-tip]";

  const ensureBubble = () => {
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.id = "app-tooltip";
      bubble.className = "tooltip";
      bubble.setAttribute("role", "tooltip");
      bubble.hidden = true;
      document.body.appendChild(bubble);
    }
    return bubble;
  };

  const place = () => {
    if (!bubble || !target) return;
    const r = target.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = bubble.offsetWidth;
    const h = bubble.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    let top = r.bottom + 8;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 8);
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  };

  const hide = () => {
    clearTimeout(showTimer);
    showTimer = 0;
    pending = null;
    if (guardTimer) {
      clearInterval(guardTimer);
      guardTimer = 0;
    }
    if (target) {
      if (target.dataset.tipFromTitle !== undefined) {
        // give the title back unless something set a newer one while the tooltip was open
        if (!target.hasAttribute("title")) target.setAttribute("title", target.dataset.tip);
        delete target.dataset.tip;
        delete target.dataset.tipFromTitle;
      }
      if (target.getAttribute("aria-describedby") === "app-tooltip") target.removeAttribute("aria-describedby");
    }
    if (bubble && !bubble.hidden) {
      bubble.hidden = true;
      hiddenAt = performance.now();
    }
    target = null;
  };
  hideTooltipNow = hide;

  const show = (el) => {
    if (!el.isConnected) return;
    const text = el.dataset.tip || el.getAttribute("title") || "";
    if (!text) return;
    if (target && target !== el) hide();
    if (el.hasAttribute("title")) {
      el.dataset.tip = el.getAttribute("title");
      el.dataset.tipFromTitle = "";
      el.removeAttribute("title");
    }
    target = el;
    pending = null;
    const b = ensureBubble();
    b.textContent = text;
    b.hidden = false;
    el.setAttribute("aria-describedby", "app-tooltip");
    place();
    if (!guardTimer) {
      guardTimer = setInterval(() => {
        if (!target || !target.isConnected) hide();
      }, 250);
    }
  };

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest ? e.target.closest(SELECTOR) : null;
    if (!el) return;
    setHint(el.dataset.tip || el.getAttribute("title"));
    if (el === target || el === pending) return;
    hide();
    pending = el;
    const delay = performance.now() - hiddenAt < 300 ? 0 : 450;
    showTimer = setTimeout(() => show(el), delay);
  });
  document.addEventListener("pointerout", (e) => {
    clearHint();
    const anchor = target || pending;
    if (anchor && e.relatedTarget && anchor.contains(e.relatedTarget)) return;
    hide();
  });
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest ? e.target.closest(SELECTOR) : null;
    if (!el || !isFocusVisible(e.target)) return;
    setHint(el.dataset.tip || el.getAttribute("title"));
    show(el);
  });
  document.addEventListener("focusout", () => {
    clearHint();
    hide();
  });

  // Canvas content has no DOM node to carry a title, so the same bubble is
  // placed straight at the pointer instead.
  canvasTip = {
    show(clientX, clientY, text) {
      if (!text) return;
      hide();
      const b = ensureBubble();
      b.textContent = text;
      b.hidden = false;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const w = b.offsetWidth;
      const h = b.offsetHeight;
      let left = Math.max(8, Math.min(clientX + 14, vw - w - 8));
      let top = clientY + 18;
      if (top + h > vh - 8) top = Math.max(8, clientY - h - 14);
      b.style.left = `${Math.round(left)}px`;
      b.style.top = `${Math.round(top)}px`;
    },
    hide() {
      hide();
    },
  };

  return canvasTip;
}

/** :focus-visible with a fallback for Safari before 15.4, where the selector throws. */
function isFocusVisible(el) {
  if (!el || document.activeElement !== el) return false;
  try {
    return el.matches(":focus-visible");
  } catch (_) {
    return !lastInputWasPointer;
  }
}

function snapBeat(beat, altKey = false) {
  const step = altKey ? 0 : ui.snapBeats;
  if (!step || step <= 0) return Math.max(0, Number(beat.toFixed(4)));
  return Math.max(0, Math.round(beat / step) * step);
}

function registerAsset(id, name, color, audioBuffer) {
  const peaks = computeWaveformPeaks(audioBuffer, 220);
  let firstOnsetSec = 0;
  if (peaks && peaks.rms && peaks.rms.length > 0 && peaks.rms[0] < 0.004) {
    for (let i = 0; i < peaks.rms.length; i++) {
      if (peaks.rms[i] >= 0.004) {
        firstOnsetSec = Math.max(0, (i - 0.5) / peaks.bucketsPerSecond);
        break;
      }
    }
  }
  const asset = {
    id,
    name,
    color,
    buffer: audioBuffer,
    peaks,
    durationSec: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    firstOnsetSec,
  };
  assets.set(id, asset);
  return asset;
}

function getActiveTheme() {
  return THEMES[ui.theme] || THEMES.amoled;
}

/** Copies the active theme's --cv-* tokens into its canvas palette. Missing tokens keep their fallback. */
function syncCanvasTheme() {
  const cs = getComputedStyle(document.body);
  const theme = getActiveTheme();
  for (const [key, prop] of Object.entries(CANVAS_TOKENS)) {
    const value = cs.getPropertyValue(prop).trim();
    if (value) theme[key] = value;
  }
}

const THEME_WALLPAPER_MAP = {
  "audius-dark": "Aurora-Glow",
  "amoled": "Wireframe-Peaks",
  "daylight": "Pastel-Icons",
  "forest": "The-Grid",
  "cyberpunk": "The-Grid",
  "ocean": "Aurora-Glow",
  "amethyst": "Aurora-Glow",
  "platinum-slate": "Wireframe-Peaks",
  "nordic": "Wireframe-Peaks",
};

function getResolvedWallpaper() {
  const mode = ui.wallpaper || "auto";
  if (mode === "none") return "none";
  if (mode === "auto") {
    return THEME_WALLPAPER_MAP[ui.theme] || "Aurora-Glow";
  }
  return mode;
}

function applyWallpaper(mode, announce = false) {
  ui.wallpaper = mode || "auto";
  if (dom.wallpaperSelect && dom.wallpaperSelect.value !== ui.wallpaper) {
    dom.wallpaperSelect.value = ui.wallpaper;
  }
  const resolved = getResolvedWallpaper();
  document.body.dataset.wallpaper = resolved;
  drawAllCanvases();
  savePrefs();
  if (announce) {
    setStatus(resolved === "none" ? "Wallpaper disabled (Solid Canvas)" : `Audius Wallpaper: ${resolved.replace("-", " ")}`);
  }
}

function applyTheme(themeId, announce = true) {
  if (!THEMES[themeId]) themeId = "amoled";
  ui.theme = themeId;
  document.body.dataset.theme = themeId;
  document.body.dataset.wallpaper = getResolvedWallpaper();
  document.body.removeAttribute("style");
  syncCanvasTheme();

  if (dom.themeSelect && dom.themeSelect.value !== themeId) {
    dom.themeSelect.value = themeId;
  }
  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    setLit(btn, btn.dataset.themeSwatch === themeId);
  });

  const themeObj = getActiveTheme();
  const pal = themeObj.palette;

  if (dom.customAccentPicker) dom.customAccentPicker.value = pal[0];
  if (dom.customBgPicker) dom.customBgPicker.value = themeObj.canvasBg;

  // Re-color tracks, stems, clips, and markers to match the selected palette
  project.tracks.forEach((trk, idx) => {
    trk.color = pal[idx % pal.length];
  });

  let stemIdx = 0;
  const assetColorMap = new Map();
  for (const asset of assets.values()) {
    asset.color = pal[stemIdx % pal.length];
    assetColorMap.set(asset.id, asset.color);
    stemIdx++;
  }

  for (const clip of project.clips) {
    const trkIdx = project.tracks.findIndex((t) => t.id === clip.trackId);
    if (assetColorMap.has(clip.assetId)) {
      clip.color = assetColorMap.get(clip.assetId);
    } else if (trkIdx >= 0) {
      clip.color = pal[trkIdx % pal.length];
    }
  }

  if (Array.isArray(project.markers)) {
    project.markers.forEach((m, idx) => {
      m.color = pal[(idx + 1) % pal.length];
    });
  }

  renderAssetPool();
  renderTrackHeaders();
  renderChannelRack();
  renderMixerStrips();
  renderTrellisPads();
  updateClipInspector();
  drawAllCanvases();
  savePrefs();
  if (announce) {
    setStatus(`Palette changed to ${themeObj.name}`);
  }
}

/**
 * Loads the built-in demo session ("Untitled — Demo Session", 138 BPM): five
 * synthesized stems arranged as the original session's playlist — drums and
 * ostinato from bar 1, the synth arp joins at bar 5, the sub bass at bar 9 and
 * the lead line at bar 17. The note/clip data lives in demo-song.js (a
 * generated file; see its header) and is voiced by generateStemsFromSong().
 */
function loadBuiltInDemoArrangement() {
  const pal = getActiveTheme().palette;

  project.name = DEMO_SONG.title;
  project.bpm = DEMO_SONG.bpm;
  project.loopEnabled = true;
  project.loopStartBeat = 0;
  project.loopEndBeat = DEMO_SONG.totalBeats;
  project.markers = DEMO_SONG.markers.map((m, i) => ({
    id: "m-" + (i + 1),
    beat: m.beat,
    name: m.name,
    color: pal[(i + 1) % pal.length],
  }));
  project.tracks = DEMO_SONG.tracks.map((t) =>
    Object.assign(
      { muted: false, solo: false, volumeDb: 0, pan: 0, eqLowDb: 0, eqMidDb: 0, eqHighDb: 0 },
      t
    )
  );

  const stems = generateStemsFromSong(DEMO_SONG, 44100);
  stems.forEach((s, idx) => {
    registerAsset(s.id, s.name, pal[idx % pal.length], s.buffer);
  });

  project.clips = DEMO_SONG.clips.map((c) => ({
    id: nextId("clip"),
    assetId: c.stem,
    trackId: c.track,
    name: c.name,
    color: "#888888", // recoloured from the theme palette by applyTheme() below
    startBeat: c.start,
    durationBeats: c.dur,
    sourceOffsetSec: 0,
    gainDb: 0,
    pan: 0,
    pitchSemitones: 0,
    fadeInBeats: 0,
    fadeOutBeats: 0.05,
    reverse: false,
    muted: false,
  }));

  // Deep-copy so rack/piano-roll edits never mutate the generated demo data.
  ui.patterns = cloneProjectState(DEMO_SONG.rackPatterns).map((p) => ({
    name: p.name,
    steps: p.steps,
    notes: p.notes.map((n) => Object.assign({ id: nextId("prn") }, n)),
  }));
  ui.activePatternIndex = 0;
  ui.activeAssetId = "stem-drums";
  ui.selectedTrackId = "trk-1";

  ui.selectedClipIds.clear();
  if (project.clips.length > 0) {
    ui.selectedClipIds.add(project.clips[0].id);
  }

  if (dom.projectName) dom.projectName.value = project.name;
  syncProjectNameLabel();
  if (dom.bpmInput) dom.bpmInput.value = project.bpm;
  syncPatternSelect();

  applyTheme(ui.theme, false);
  updateTrackInspector();
}

function onProjectMutated(statusText = null) {
  if (statusText) setStatus(statusText);
  dom.projectName.value = project.name;
  syncProjectNameLabel();
  dom.bpmInput.value = project.bpm;
  setRange(dom.masterVol, project.masterVolumeDb ?? 0);
  setLit(dom.btnLoop, !!project.loopEnabled);
  setLit(dom.btnMetro, !!project.metronome);

  engine.syncTrackNodes(project);
  if (engine.isPlaying) {
    engine.play(project, assets, engine.getPlayheadBeat(project));
  }
  instruments.syncLive({ refreshEditor: false });
  syncPatternSelect();
  renderTrackHeaders();
  renderChannelRack();
  renderMixerStrips();
  renderTrellisPads();
  updateClipInspector();
  updateTrackInspector();
  drawAllCanvases();
  if (gateUi) gateUi.refresh();
  if (fxUi) fxUi.refresh();
  savePrefs();
}

/** Rebuilds the PAT dropdown from the current patterns, so a loaded project's patterns all show. */
function syncPatternSelect() {
  if (!dom.patternSelect) return;
  const options = ui.patterns.map((pat, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = pat.name;
    return opt;
  });
  dom.patternSelect.replaceChildren(...options);
  dom.patternSelect.value = String(ui.activePatternIndex);
}

/**
 * Renders the 8-pad Multi-Touch Trellis Slice Launcher in the bottom dock
 */
function renderTrellisPads() {
  if (!dom.trellisPadMatrix) return;
  dom.trellisPadMatrix.innerHTML = "";

  const padDefs = [
    { label: "Kick Hit", assetId: "stem-drums", offsetBeat: 0, dur: 1, color: "#ff7a45", rev: false },
    { label: "Snare Hit", assetId: "stem-drums", offsetBeat: 2, dur: 1, color: "#ff7a45", rev: false },
    { label: "Hat Roll", assetId: "stem-drums", offsetBeat: 2.75, dur: 1, color: "#ffa940", rev: false },
    { label: "Rev Fill", assetId: "stem-drums", offsetBeat: 2, dur: 1, color: "#fa541c", rev: true },
    { label: "Sub Bass", assetId: "stem-bass", offsetBeat: 0, dur: 2, color: "#36cfc9", rev: false },
    { label: "Arp Motif", assetId: "stem-arp", offsetBeat: 0, dur: 2, color: "#9254de", rev: false },
    { label: "Ostinato", assetId: "stem-ostinato", offsetBeat: 0, dur: 2, color: "#38bdf8", rev: false },
    { label: "Lead Line", assetId: "stem-lead", offsetBeat: 4, dur: 4, color: "#f59e0b", rev: false },
  ];

  const secPerBeat = 60 / project.bpm;
  padDefs.forEach((def, idx) => {
    const pad = document.createElement("button");
    pad.className = "matrix-pad";
    pad.style.setProperty("--pad-color", def.color);
    pad.style.setProperty("--pad-rgb", hexToTriplet(def.color));
    // The pad keeps its colour on the border, glow and dot (--pad-color); the name uses the
    // theme's text colour so it stays readable on light themes too.
    const name = document.createElement("div");
    name.className = "matrix-pad-name";
    name.textContent = `${idx + 1} · ${def.label}`;
    const meta = document.createElement("div");
    meta.className = "matrix-pad-meta";
    meta.textContent = `${def.dur} beat${def.dur > 1 ? "s" : ""}${def.rev ? " · REV" : ""}`;
    pad.append(name, meta);

    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pad.classList.add("triggered");
      triggerTrellisPad(def, secPerBeat);
    });
    const clear = () => pad.classList.remove("triggered");
    pad.addEventListener("pointerup", clear);
    pad.addEventListener("pointercancel", clear);
    pad.addEventListener("pointerleave", clear);

    dom.trellisPadMatrix.appendChild(pad);
  });
}

function triggerTrellisPad(def, secPerBeat) {
  const asset = assets.get(def.assetId) || Array.from(assets.values())[0];
  if (!asset || !asset.buffer) return;

  const ctx = engine.ensureContext();
  const rate = Math.pow(2, (def.pitch || 0) / 12);
  const buf = def.rev ? engine.getReversedBuffer(asset.buffer) : asset.buffer;

  const offsetSec = Math.min(Math.max(0, buf.duration - 0.05), (def.offsetBeat || 0) * secPerBeat);
  const durSec = Math.max(0.02, Math.min((buf.duration - offsetSec) / rate, def.dur * secPerBeat));
  const now = ctx.currentTime;
  const relSec = Math.min(0.02, durSec * 0.25);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(0.85, now + 0.002);
  g.gain.setValueAtTime(0.85, Math.max(now + 0.002, now + durSec - relSec));
  g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
  src.connect(g);
  g.connect(engine.masterGain);

  src.start(now, offsetSec, durSec + 0.005);

  if (dom.padStampMode && dom.padStampMode.checked) {
    pushUndoState();
    const beatNow = snapBeat(engine.getPlayheadBeat(project));
    const targetTrackId = ui.selectedTrackId || project.tracks[0]?.id;
    const newClip = {
      id: nextId("clip"),
      assetId: asset.id,
      trackId: targetTrackId,
      name: def.label,
      color: def.color,
      startBeat: beatNow,
      durationBeats: def.dur,
      sourceOffsetSec: Number(offsetSec.toFixed(4)),
      gainDb: 0,
      pan: 0,
      pitchSemitones: def.pitch || 0,
      fadeInBeats: 0.02,
      fadeOutBeats: 0.02,
      reverse: !!def.rev,
      muted: false,
    };
    project.clips.push(newClip);
    ui.selectedClipIds.clear();
    ui.selectedClipIds.add(newClip.id);
    if (!engine.isPlaying) {
      engine.seek(project, assets, beatNow + def.dur);
    }
    onProjectMutated(`Stamped "${def.label}" @ ${formatBeatBar(beatNow)}`);
  } else {
    setStatus(`Triggered Pad: ${def.label}`);
  }
}

/**
 * Renders the Left Audio Pool list
 */
function renderAssetPool() {
  dom.assetList.innerHTML = "";
  // An empty library shows the drop zone (see .lib-empty in styles.css).
  dom.leftPanel.classList.toggle("lib-empty", assets.size === 0);
  if (assets.size === 0) {
    const demo = document.createElement("button");
    demo.type = "button";
    demo.className = "lib-link-btn";
    demo.textContent = "Load the demo session";
    demo.addEventListener("click", () => dom.btnLoadDemo.click());
    dom.assetList.appendChild(makeEmptyState("No stems in this project yet. ", demo));
    return;
  }

  if (!ui.activeAssetId || !assets.has(ui.activeAssetId)) {
    ui.activeAssetId = assets.keys().next().value || null;
  }

  const selectAsset = (asset, refocus) => {
    ui.activeAssetId = asset.id;
    renderAssetPool();
    renderChannelRack();
    drawPianoRollCanvas();
    setStatus(`Active Channel/Stem: "${asset.name}" (Click steps in Channel Rack, notes in Piano Roll, or double-click Playlist)`);
    if (refocus) {
      const row = dom.assetList.querySelector(".asset-card.selected-stem");
      if (row) row.focus();
    }
  };

  const iconButton = (name, label, title) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = icon(name, { solo: true });
    btn.title = title;
    btn.setAttribute("aria-label", label);
    return btn;
  };

  for (const asset of assets.values()) {
    const card = document.createElement("div");
    card.className = "asset-card" + (asset.id === ui.activeAssetId ? " selected-stem" : "");
    if (asset.color) card.style.setProperty("--stem-color", asset.color);
    card.draggable = true;
    card.tabIndex = 0;

    card.addEventListener("click", () => selectAsset(asset, false));
    // Enter selects a focused row; Space keeps its app-wide meaning (play / stop).
    card.addEventListener("keydown", (e) => {
      if (e.target !== card || e.key !== "Enter") return;
      e.preventDefault();
      selectAsset(asset, true);
    });

    card.addEventListener("dragstart", (ev) => {
      ui.activeAssetId = asset.id;
      ev.dataTransfer.setData("text/plain", asset.id);
    });

    // The file extension moves out of the name and into the tooltip.
    const ext = (asset.name.match(/\.(wav|mp3|flac|ogg|oga|opus|m4a|aac|aiff?|webm|midi?)$/i) || [])[1] || "";
    const text = document.createElement("div");
    text.className = "asset-text";

    const nameEl = document.createElement("div");
    nameEl.className = "asset-name";
    nameEl.textContent = ext ? asset.name.slice(0, -(ext.length + 1)) : asset.name;

    const meta = document.createElement("div");
    meta.className = "asset-meta";
    const synth = instruments.instrumentForAsset(asset);
    if (synth) {
      meta.textContent = `Synth · ${synth.patch.name}`;
      card.title = `${asset.name} · Mammoth synth · ${synth.patch.name}`;
    } else {
      const beats = Number((asset.durationSec * (project.bpm / 60)).toFixed(1));
      meta.textContent = `${asset.durationSec.toFixed(1)} s · ${beats} beats`;
      card.title = `${asset.name} · ${asset.durationSec.toFixed(2)} s · ${(asset.sampleRate / 1000).toFixed(1)} kHz`;
    }
    text.append(nameEl, meta);

    const actions = document.createElement("div");
    actions.className = "asset-actions";

    const btnPrev = iconButton("play", `Preview ${asset.name}`, "Preview");
    btnPrev.addEventListener("click", (e) => {
      e.stopPropagation();
      auditionAsset(asset);
    });

    let btnAdd;
    if (asset.instrumentId) {
      // A synth channel has no audio of its own to place: its button opens the synth instead.
      btnAdd = iconButton("sliders-vertical", `Edit synth ${asset.name}`, "Open the synth editor");
      btnAdd.addEventListener("click", (e) => {
        e.stopPropagation();
        instruments.openEditor(asset);
      });
    } else {
      btnAdd = iconButton("plus", `Add ${asset.name} to the selected track`, "Add to the selected track at the playhead");
      btnAdd.addEventListener("click", (e) => {
        e.stopPropagation();
        addAssetClipToPlaylist(
          asset.id,
          ui.selectedTrackId || project.tracks[0]?.id,
          engine.getPlayheadBeat(project)
        );
      });
    }

    const btnDel = iconButton("trash-2", `Delete ${asset.name}`, "Delete this stem and its clips");
    btnDel.classList.add("del-asset-btn");
    btnDel.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      assets.delete(asset.id);
      project.clips = project.clips.filter((c) => c.assetId !== asset.id);
      instruments.onAssetDeleted(asset.id);
      ui.selectedClipIds.clear();
      renderAssetPool();
      onProjectMutated(`Removed ${asset.instrumentId ? "synth channel" : "stem"} "${asset.name}"`);
    });

    actions.append(btnPrev, btnAdd, btnDel);
    card.append(text, actions);
    dom.assetList.appendChild(card);
  }
}

function auditionAsset(asset) {
  if (instruments.playPhrase(asset)) return;
  const ctx = engine.ensureContext();
  if (ui.previewSource) {
    try {
      ui.previewSource.stop();
    } catch (_) {}
    ui.previewSource = null;
  }
  const src = ctx.createBufferSource();
  src.buffer = asset.buffer;
  src.connect(engine.masterGain);
  src.start();
  ui.previewSource = src;
  setStatus(`Auditioning: ${asset.name}`);
}

function addAssetClipToPlaylist(assetId, trackId, atBeat = 0) {
  const asset = assets.get(assetId);
  if (!asset) return;
  const targetTrack = project.tracks.find((t) => t.id === trackId) || project.tracks[0];
  if (!targetTrack) return;

  pushUndoState();
  const durBeats = Math.max(0.25, Number((asset.durationSec * (project.bpm / 60)).toFixed(3)));
  const newClip = {
    id: nextId("clip"),
    assetId: asset.id,
    trackId: targetTrack.id,
    name: asset.name.replace(/\.[^.]+$/, ""),
    color: asset.color || targetTrack.color || "#ff7a45",
    startBeat: snapBeat(atBeat),
    durationBeats: durBeats,
    sourceOffsetSec: 0,
    gainDb: 0,
    pan: 0,
    pitchSemitones: 0,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    reverse: false,
    muted: false,
  };
  project.clips.push(newClip);
  ui.selectedClipIds.clear();
  ui.selectedClipIds.add(newClip.id);
  onProjectMutated(`Added "${newClip.name}" to ${targetTrack.name}`);
}

/**
 * Which header buttons (menu, delete) a clip shows. Narrow clips keep their header for the name and
 * only show the buttons once selected, so chopped slices stay readable and are not deleted by a
 * stray tap. Drawing and hit-testing both use this, so they always agree.
 */
function clipHeaderButtons(clip, w, touch) {
  const reveal = w >= (touch ? 180 : 120) || ui.selectedClipIds.has(clip.id);
  return touch
    ? { menu: reveal && w >= 132, del: reveal && w >= 86 }
    : { menu: reveal && w >= 46, del: reveal && w >= 28 };
}

/**
 * Renders the Track Headers column (aligned pixel-for-pixel with canvas rows)
 */
function renderTrackHeaders() {
  dom.trackHeadersList.innerHTML = "";
  dom.trackHeadersList.style.transform = `translateY(${-ui.scrollY}px)`;

  project.tracks.forEach((track, idx) => {
    const item = document.createElement("div");
    item.className = "track-header-item" + (track.id === ui.selectedTrackId ? " selected" : "");
    item.style.height = `${ui.trackHeight}px`;

    item.addEventListener("click", () => {
      ui.selectedTrackId = track.id;
      renderTrackHeaders();
      updateTrackInspector();
      if (fxUi) fxUi.refresh();
    });

    const strip = document.createElement("div");
    strip.className = "track-color-strip";
    strip.style.background = track.color || "var(--accent)";

    const topRow = document.createElement("div");
    topRow.className = "track-row-top";

    const title = document.createElement("div");
    title.className = "track-title";
    title.textContent = track.name;
    title.title = `${track.name} — double-click or long-press to rename`;
    // Rename: double-click with a mouse, long-press (contextmenu) on touch.
    const renameTrack = () => {
      const next = prompt("Rename Track:", track.name);
      if (next && next.trim()) {
        pushUndoState();
        track.name = next.trim().slice(0, 120);
        onProjectMutated(`Renamed track to ${track.name}`);
      }
    };
    title.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      renameTrack();
    });

    const btns = document.createElement("div");
    btns.className = "track-btns";

    const btnMute = document.createElement("button");
    btnMute.className = "trk-btn mute" + (track.muted ? " on" : "");
    btnMute.textContent = "M";
    const syncMuteLabel = () => {
      btnMute.title = track.muted ? "Unmute track" : "Mute track";
      btnMute.setAttribute("aria-label", `${track.muted ? "Unmute" : "Mute"} ${track.name}`);
      btnMute.setAttribute("aria-pressed", String(!!track.muted));
    };
    syncMuteLabel();
    btnMute.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      track.muted = !track.muted;
      onProjectMutated(`${track.name} ${track.muted ? "muted" : "unmuted"}`);
    });

    const btnSolo = document.createElement("button");
    btnSolo.className = "trk-btn solo" + (track.solo ? " on" : "");
    btnSolo.textContent = "S";
    const syncSoloLabel = () => {
      btnSolo.title = track.solo ? "Unsolo track" : "Solo track";
      btnSolo.setAttribute("aria-label", `${track.solo ? "Unsolo" : "Solo"} ${track.name}`);
      btnSolo.setAttribute("aria-pressed", String(!!track.solo));
    };
    syncSoloLabel();
    btnSolo.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      track.solo = !track.solo;
      onProjectMutated(`${track.name} ${track.solo ? "soloed" : "unsoloed"}`);
    });

    const btnDel = document.createElement("button");
    btnDel.className = "trk-btn del-trk";
    btnDel.innerHTML = icon("trash-2", { solo: true });
    btnDel.title = "Delete track";
    btnDel.setAttribute("aria-label", `Delete ${track.name}`);
    btnDel.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      project.clips = project.clips.filter((c) => c.trackId !== track.id);
      if (project.tracks.length > 1) {
        project.tracks.splice(idx, 1);
        if (ui.selectedTrackId === track.id) {
          ui.selectedTrackId = project.tracks[0].id;
        }
        onProjectMutated(`Deleted track "${track.name}"`);
      } else {
        onProjectMutated(`Cleared all clips on "${track.name}"`);
      }
    });
    // Long-press anywhere on the header renames it (touch equivalent of double-click).
    item.addEventListener("contextmenu", (e) => {
      if (!isTouchContextMenu(e)) return;
      e.preventDefault();
      renameTrack();
    });

    btns.append(btnMute, btnSolo, btnDel);
    topRow.append(title, btns);

    // Volume & Pan Row
    const slidersRow = document.createElement("div");
    slidersRow.className = "track-row-Sliders";

    const volLbl = document.createElement("span");
    volLbl.textContent = "Vol";
    const volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.min = "-36";
    volSlider.max = "6";
    volSlider.step = "0.5";
    volSlider.dataset.label = "Volume";
    volSlider.dataset.format = "db";
    volSlider.dataset.default = "0";
    volSlider.setAttribute("aria-label", `Volume, ${track.name}`);
    setRange(volSlider, track.volumeDb ?? 0);
    undoOnGesture(volSlider);
    volSlider.addEventListener("input", (e) => {
      track.volumeDb = Number(e.target.value);
      engine.syncTrackNodes(project);
    });

    const panLbl = document.createElement("span");
    panLbl.textContent = "Pan";
    const panSlider = document.createElement("input");
    panSlider.type = "range";
    panSlider.min = "-1";
    panSlider.max = "1";
    panSlider.step = "0.05";
    panSlider.dataset.label = "Pan";
    panSlider.dataset.format = "pan";
    panSlider.dataset.default = "0";
    panSlider.dataset.bipolar = "";
    panSlider.setAttribute("aria-label", `Pan, ${track.name}`);
    setRange(panSlider, track.pan ?? 0);
    undoOnGesture(panSlider);
    panSlider.addEventListener("input", (e) => {
      track.pan = Number(e.target.value);
      engine.syncTrackNodes(project);
    });

    slidersRow.append(volLbl, volSlider, panLbl, panSlider);

    const meterWrap = document.createElement("div");
    meterWrap.className = "track-meter-mini";
    const meterFill = document.createElement("div");
    meterFill.className = "track-meter-fill";
    meterFill.dataset.trackMeter = track.id;
    meterWrap.appendChild(meterFill);

    item.append(strip, topRow, slidersRow, meterWrap);
    dom.trackHeadersList.appendChild(item);
  });
}

/**
 * Splits a clip into two independent segments at `cutBeat` (in timeline beats).
 */
function splitClipAtBeat(clip, cutBeat) {
  const minSegmentBeats = 0.0625;
  const clipEnd = clip.startBeat + clip.durationBeats;
  if (cutBeat <= clip.startBeat + minSegmentBeats || cutBeat >= clipEnd - minSegmentBeats) {
    return null;
  }

  const leftBeats = Number((cutBeat - clip.startBeat).toFixed(4));
  const rightBeats = Number((clipEnd - cutBeat).toFixed(4));
  const secPerBeat = 60 / project.bpm;
  const rate = Math.pow(2, (clip.pitchSemitones || 0) / 12) * (clip.playbackRate || 1);
  const deltaSourceSec = leftBeats * secPerBeat * rate;

  const leftClip = {
    ...clip,
    id: nextId("clip"),
    name: `${clip.name} [L]`,
    durationBeats: leftBeats,
    fadeOutBeats: Math.min(clip.fadeOutBeats || 0, leftBeats * 0.4),
  };

  const rightClip = {
    ...clip,
    id: nextId("clip"),
    name: `${clip.name} [R]`,
    startBeat: Number(cutBeat.toFixed(4)),
    durationBeats: rightBeats,
    sourceOffsetSec: Number(((clip.sourceOffsetSec || 0) + deltaSourceSec).toFixed(4)),
    fadeInBeats: Math.min(clip.fadeInBeats || 0, rightBeats * 0.4),
  };

  return [leftClip, rightClip];
}

function cutSelectedClipInHalf() {
  const targets = getTargetClipsForOperation();
  if (targets.length === 0) {
    setStatus("Select a clip first to cut in half");
    return;
  }
  pushUndoState();
  const nextClips = [];
  const newSel = new Set();
  for (const c of project.clips) {
    if (!targets.includes(c)) {
      nextClips.push(c);
      continue;
    }
    const midBeat = c.startBeat + c.durationBeats / 2;
    const pair = splitClipAtBeat(c, midBeat);
    if (pair) {
      nextClips.push(pair[0], pair[1]);
      newSel.add(pair[1].id);
    } else {
      nextClips.push(c);
    }
  }
  project.clips = nextClips;
  ui.selectedClipIds = newSel;
  onProjectMutated("Cut selected segment in half (50/50)");
}

function nudgeSelectedClips(deltaBeats) {
  const targets = getTargetClipsForOperation();
  if (targets.length === 0) {
    setStatus("Select a clip first to move");
    return;
  }
  pushUndoState();
  for (const c of targets) {
    c.startBeat = Math.max(0, Number((c.startBeat + deltaBeats).toFixed(4)));
  }
  onProjectMutated(`Moved clip ${deltaBeats > 0 ? "right" : "left"}`);
}

function moveSelectedClipsTrack(deltaTrack) {
  const targets = getTargetClipsForOperation();
  if (targets.length === 0) {
    setStatus("Select a clip first to move tracks");
    return;
  }
  pushUndoState();
  for (const c of targets) {
    const idx = project.tracks.findIndex((t) => t.id === c.trackId);
    const nextIdx = Math.max(0, Math.min(project.tracks.length - 1, idx + deltaTrack));
    c.trackId = project.tracks[nextIdx].id;
    ui.selectedTrackId = c.trackId;
  }
  onProjectMutated("Moved clip to track " + (project.tracks.find((t) => t.id === ui.selectedTrackId)?.name || ""));
}

function trimSelectedClipsLength(deltaBeats) {
  const targets = getTargetClipsForOperation();
  if (targets.length === 0) {
    setStatus("Select a clip first to trim length");
    return;
  }
  pushUndoState();
  for (const c of targets) {
    c.durationBeats = Math.max(0.25, Number((c.durationBeats + deltaBeats).toFixed(4)));
  }
  onProjectMutated("Adjusted clip length");
}

function chopSelectedClipsEvery(intervalBeats) {
  const targets = getTargetClipsForOperation();
  if (targets.length === 0) {
    setStatus("Select a clip first to chop");
    return;
  }

  pushUndoState();
  const nextClips = [];
  const newSelection = new Set();
  let totalSlices = 0;

  for (const clip of project.clips) {
    if (!targets.includes(clip)) {
      nextClips.push(clip);
      continue;
    }

    // A grid coarser than the clip itself would only rename it.
    if (intervalBeats >= clip.durationBeats) {
      nextClips.push(clip);
      continue;
    }

    const secPerBeat = 60 / project.bpm;
    const rate = Math.pow(2, (clip.pitchSemitones || 0) / 12) * (clip.playbackRate || 1);
    const clipEnd = clip.startBeat + clip.durationBeats;
    let cursor = clip.startBeat;
    let sliceIndex = 1;

    while (cursor < clipEnd - 0.001) {
      const segEnd = Math.min(clipEnd, cursor + intervalBeats);
      const segBeats = Number((segEnd - cursor).toFixed(4));
      if (segBeats >= 0.05) {
        const elapsedBeats = cursor - clip.startBeat;
        const seg = {
          ...clip,
          id: nextId("clip"),
          name: `${clip.name.replace(/ #\d+$/, "")} #${sliceIndex}`,
          startBeat: Number(cursor.toFixed(4)),
          durationBeats: segBeats,
          sourceOffsetSec: Number(
            ((clip.sourceOffsetSec || 0) + elapsedBeats * secPerBeat * rate).toFixed(4)
          ),
          fadeInBeats: 0.02,
          fadeOutBeats: 0.02,
        };
        nextClips.push(seg);
        newSelection.add(seg.id);
        sliceIndex++;
        totalSlices++;
      }
      cursor = segEnd;
    }
  }

  project.clips = nextClips;
  ui.selectedClipIds = newSelection;
  onProjectMutated(`Sliced into ${totalSlices} segments (${intervalBeats} beat grid)`);
}

function chopSelectedClipsByTransients() {
  const targets = getTargetClipsForOperation();
  if (targets.length === 0) {
    setStatus("Select a clip first to auto-slice transients");
    return;
  }

  pushUndoState();
  const secPerBeat = 60 / project.bpm;
  const nextClips = [];
  const newSelection = new Set();
  let createdCount = 0;

  for (const clip of project.clips) {
    if (!targets.includes(clip)) {
      nextClips.push(clip);
      continue;
    }
    const asset = assets.get(clip.assetId);
    if (!asset || !asset.buffer) {
      nextClips.push(clip);
      continue;
    }

    const rate = Math.pow(2, (clip.pitchSemitones || 0) / 12) * (clip.playbackRate || 1);
    const srcStart = clip.sourceOffsetSec || 0;
    const srcDur = clip.durationBeats * secPerBeat * rate;
    const onsetsSec = detectTransients(asset.buffer, srcStart, srcDur, 0.58);

    if (onsetsSec.length === 0) {
      nextClips.push(clip);
      newSelection.add(clip.id);
      continue;
    }

    const cutBeats = [
      clip.startBeat,
      ...onsetsSec.map((sec) => clip.startBeat + (sec - srcStart) / (secPerBeat * rate)),
      clip.startBeat + clip.durationBeats,
    ];

    for (let i = 0; i < cutBeats.length - 1; i++) {
      const b0 = cutBeats[i];
      const b1 = cutBeats[i + 1];
      const dur = Number((b1 - b0).toFixed(4));
      if (dur < 0.06) continue;
      const elapsedBeats = b0 - clip.startBeat;
      const seg = {
        ...clip,
        id: nextId("clip"),
        name: `${clip.name.replace(/ \[Hit \d+\]$/, "")} [Hit ${i + 1}]`,
        startBeat: Number(b0.toFixed(4)),
        durationBeats: dur,
        sourceOffsetSec: Number((srcStart + elapsedBeats * secPerBeat * rate).toFixed(4)),
        fadeInBeats: 0.01,
        fadeOutBeats: 0.02,
      };
      nextClips.push(seg);
      newSelection.add(seg.id);
      createdCount++;
    }
  }

  project.clips = nextClips;
  ui.selectedClipIds = newSelection;
  onProjectMutated(`Auto-sliced ${createdCount} transient segments`);
}

function getTargetClipsForOperation() {
  const selected = project.clips.filter((c) => ui.selectedClipIds.has(c.id));
  if (selected.length > 0) return selected;
  return [];
}

function splitAtPlayhead() {
  const playhead = engine.getPlayheadBeat(project);
  const candidates = project.clips.filter(
    (c) =>
      (ui.selectedClipIds.size === 0 || ui.selectedClipIds.has(c.id)) &&
      playhead > c.startBeat + 0.0625 &&
      playhead < c.startBeat + c.durationBeats - 0.0625
  );

  if (candidates.length === 0) {
    setStatus("Move playhead inside a clip to split at playhead");
    return;
  }

  pushUndoState();
  const nextClips = [];
  const newSel = new Set();
  for (const c of project.clips) {
    if (!candidates.includes(c)) {
      nextClips.push(c);
      continue;
    }
    const pair = splitClipAtBeat(c, playhead);
    if (pair) {
      nextClips.push(pair[0], pair[1]);
      newSel.add(pair[1].id);
    } else {
      nextClips.push(c);
    }
  }
  project.clips = nextClips;
  ui.selectedClipIds = newSel;
  onProjectMutated(`Split ${candidates.length} clip(s) at Bar ${formatBeatBar(playhead)}`);
}

function duplicateSelectedClips() {
  const selected = getTargetClipsForOperation();
  if (selected.length === 0) {
    setStatus("Select one or more clips to duplicate");
    return;
  }
  pushUndoState();
  const minStart = Math.min(...selected.map((c) => c.startBeat));
  const maxEnd = Math.max(...selected.map((c) => c.startBeat + c.durationBeats));
  const span = Math.max(0.25, maxEnd - minStart);

  const newSel = new Set();
  for (const c of selected) {
    const copy = {
      ...c,
      id: nextId("clip"),
      startBeat: Number((c.startBeat + span).toFixed(4)),
    };
    project.clips.push(copy);
    newSel.add(copy.id);
  }
  ui.selectedClipIds = newSel;
  onProjectMutated(`Duplicated ${selected.length} segment(s)`);
}

function reverseSelectedClips() {
  const selected = getTargetClipsForOperation();
  if (selected.length === 0) {
    setStatus("Select a clip segment to reverse");
    return;
  }
  pushUndoState();
  for (const c of selected) {
    c.reverse = !c.reverse;
  }
  onProjectMutated(`Toggled reverse on ${selected.length} segment(s)`);
}

function deleteSelectedClips() {
  if (ui.selectedClipIds.size === 0) {
    setStatus("Tap × on any clip or select a clip first to delete");
    return;
  }
  pushUndoState();
  const count = ui.selectedClipIds.size;
  project.clips = project.clips.filter((c) => !ui.selectedClipIds.has(c.id));
  ui.selectedClipIds.clear();
  onProjectMutated(`Deleted ${count} segment(s)`);
}

function clearPlaylistClips() {
  if (project.clips.length === 0) {
    setStatus("Playlist is already empty");
    return;
  }
  pushUndoState();
  const count = project.clips.length;
  project.clips = [];
  ui.selectedClipIds.clear();
  onProjectMutated(`Cleared all ${count} clips from Playlist`);
}

function clearAllStemsAndClips() {
  if (assets.size === 0 && project.clips.length === 0) {
    setStatus("Stems & Playlist are already empty");
    return;
  }
  pushUndoState();
  if (engine.isPlaying) {
    engine.stop(project);
    dom.btnPlay.classList.remove("playing");
    setPlayIcon(false);
  }
  assets.clear();
  project.clips = [];
  instruments.onCleared();
  ui.selectedClipIds.clear();
  renderAssetPool();
  onProjectMutated("Cleared all stems & playlist clips");
}

function getPrimarySelectedClip() {
  for (const c of project.clips) {
    if (ui.selectedClipIds.has(c.id)) return c;
  }
  return null;
}

function updateClipInspector() {
  syncCommandAvailability();
  const clip = getPrimarySelectedClip();
  if (dom.selectedClipBadge) {
    dom.selectedClipBadge.textContent = clip
      ? `${clip.name} (${clip.durationBeats}b)`
      : "No Clip Selected";
  }
  if (!clip) {
    dom.clipInspectorEmpty.hidden = false;
    dom.clipInspector.hidden = true;
    return;
  }
  dom.clipInspectorEmpty.hidden = true;
  dom.clipInspector.hidden = false;

  dom.inspName.value = clip.name || "";
  dom.inspStart.value = Number(clip.startBeat.toFixed(3));
  dom.inspDuration.value = Number(clip.durationBeats.toFixed(3));
  dom.inspOffset.value = Number((clip.sourceOffsetSec || 0).toFixed(3));
  dom.inspColor.value = clip.color || "#ff7a45";
  setRange(dom.inspGain, clip.gainDb || 0);
  dom.inspGainVal.textContent = `${(clip.gainDb || 0) >= 0 ? "+" : ""}${(clip.gainDb || 0).toFixed(1)} dB`;
  setRange(dom.inspPitch, clip.pitchSemitones || 0);
  dom.inspPitchVal.textContent = `${(clip.pitchSemitones || 0) >= 0 ? "+" : ""}${clip.pitchSemitones || 0} st`;
  setRange(dom.inspPan, clip.pan || 0);
  dom.inspPanVal.textContent =
    Math.abs(clip.pan || 0) < 0.03
      ? "C"
      : (clip.pan || 0) < 0
      ? `${Math.round(Math.abs(clip.pan) * 100)}% L`
      : `${Math.round(clip.pan * 100)}% R`;
  dom.inspFadeIn.value = Number((clip.fadeInBeats || 0).toFixed(3));
  dom.inspFadeOut.value = Number((clip.fadeOutBeats || 0).toFixed(3));
  dom.inspReverse.checked = !!clip.reverse;
  dom.inspMuted.checked = !!clip.muted;
}

function updateTrackInspector() {
  const track = project.tracks.find((t) => t.id === ui.selectedTrackId) || project.tracks[0];
  if (!track) return;
  dom.trackInspTitle.textContent = track.name;
  setRange(dom.trkEqLow, track.eqLowDb ?? 0);
  dom.trkEqLowVal.textContent = `${(track.eqLowDb ?? 0).toFixed(1)} dB`;
  setRange(dom.trkEqMid, track.eqMidDb ?? 0);
  dom.trkEqMidVal.textContent = `${(track.eqMidDb ?? 0).toFixed(1)} dB`;
  setRange(dom.trkEqHigh, track.eqHighDb ?? 0);
  dom.trkEqHighVal.textContent = `${(track.eqHighDb ?? 0).toFixed(1)} dB`;
}

/**
 * CANVAS RENDERING: Playlist Timeline & Arrangement Minimap
 */
function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { width: rect.width, height: rect.height, dpr };
}

function beatToX(beat) {
  return (beat - ui.scrollBeat) * ui.pixelsPerBeat;
}

function xToBeat(x) {
  return ui.scrollBeat + x / ui.pixelsPerBeat;
}

/** The timeline's virtual length: the loop, the last clip, or a floor. */
function timelineTotalBeats() {
  const clipEnd = project.clips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0);
  return Math.max(32, project.loopEndBeat + 8, clipEnd + 8);
}

function maxScrollY() {
  const laneHeight = project.tracks.length * ui.trackHeight;
  const viewHeight = dom.playlistCanvas ? dom.playlistCanvas.clientHeight - ui.rulerHeight : 0;
  return Math.max(0, laneHeight - viewHeight + 20);
}

/** Keeps the playhead scroll inside the arrangement and the scroll
    controls' ranges in step with it (called after every redraw). */
function syncScrollLimits() {
  const canvas = dom.playlistCanvas;
  if (!canvas || canvas.clientWidth === 0) return;
  const viewBeats = canvas.clientWidth / ui.pixelsPerBeat;
  const maxBeat = Math.max(0, timelineTotalBeats() - viewBeats);
  if (ui.scrollBeat > maxBeat) ui.scrollBeat = maxBeat;
  const maxY = maxScrollY();
  if (ui.scrollY > maxY) ui.scrollY = Math.max(0, maxY);
  if (dom.hscrollSlider) {
    const nextMax = Number(maxBeat.toFixed(2));
    if (Number(dom.hscrollSlider.max) !== nextMax) dom.hscrollSlider.max = String(nextMax);
    setRange(dom.hscrollSlider, ui.scrollBeat);
  }
  updateVscrollThumb();
}

function updateVscrollThumb() {
  const rail = dom.vscrollRail;
  const thumb = dom.vscrollThumb;
  if (!rail || !thumb) return;
  const total = Math.max(1, project.tracks.length * ui.trackHeight);
  const view = Math.max(1, dom.playlistCanvas ? dom.playlistCanvas.clientHeight - ui.rulerHeight : 1);
  const frac = Math.min(1, view / total);
  const thumbPct = Math.max(8, frac * 100);
  thumb.style.height = `${thumbPct}%`;
  const maxY = maxScrollY();
  const scrollFrac = maxY > 0 ? Math.min(1, ui.scrollY / maxY) : 0;
  thumb.style.top = `${scrollFrac * (100 - thumbPct)}%`;
  rail.setAttribute("aria-valuenow", String(Math.round(scrollFrac * 100)));
}

function setupVerticalScroll() {
  const rail = dom.vscrollRail;
  if (!rail) return;
  let dragStartY = 0;
  let dragStartScroll = 0;
  const pageStep = () =>
    Math.max(1, (dom.playlistCanvas ? dom.playlistCanvas.clientHeight - ui.rulerHeight : 100) / ui.trackHeight);

  rail.addEventListener("pointerdown", (e) => {
    rail.setPointerCapture(e.pointerId);
    const rect = rail.getBoundingClientRect();
    const thumbPct = Number(dom.vscrollThumb.style.height.replace("%", "")) || 20;
    const thumbTop = (rect.height * Number(dom.vscrollThumb.style.top.replace("%", "")) || 0) / 100;
    const y = e.clientY - rect.top;
    if (y >= thumbTop && y <= thumbTop + (rect.height * thumbPct) / 100) {
      dragStartY = y;
      dragStartScroll = ui.scrollY;
      rail.dataset.dragging = "";
    } else {
      const frac = Math.max(0, Math.min(1, y / rect.height));
      ui.scrollY = Math.round(frac * maxScrollY());
      renderTrackHeaders();
      drawAllCanvases();
    }
  });
  rail.addEventListener("pointermove", (e) => {
    if (!rail.dataset.dragging) return;
    const rect = rail.getBoundingClientRect();
    const thumbPct = Number(dom.vscrollThumb.style.height.replace("%", "")) || 20;
    const thumbPx = (rect.height * thumbPct) / 100;
    const dy = e.clientY - rect.top - dragStartY;
    const scale = maxScrollY() / Math.max(1, rect.height - thumbPx);
    ui.scrollY = Math.max(0, Math.min(maxScrollY(), dragStartScroll + dy * scale));
    renderTrackHeaders();
    drawAllCanvases();
  });
  const endDrag = () => delete rail.dataset.dragging;
  rail.addEventListener("pointerup", endDrag);
  rail.addEventListener("pointercancel", endDrag);
  rail.addEventListener("keydown", (e) => {
    const step = ui.trackHeight;
    let next = ui.scrollY;
    if (e.key === "ArrowDown") next += step;
    else if (e.key === "ArrowUp") next -= step;
    else if (e.key === "PageDown") next += step * pageStep();
    else if (e.key === "PageUp") next -= step * pageStep();
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = maxScrollY();
    else return;
    e.preventDefault();
    ui.scrollY = Math.max(0, Math.min(maxScrollY(), next));
    renderTrackHeaders();
    drawAllCanvases();
  });
}

function drawAllCanvases() {
  drawPlaylistCanvas();
  drawMinimapCanvas();
  drawPianoRollCanvas();
  syncScrollLimits();
}

function drawPlaylistCanvas() {
  const canvas = dom.playlistCanvas;
  if (!canvas || canvas.clientWidth === 0) return;
  const { width, height, dpr } = resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  const rulerH = ui.rulerHeight;
  const touchControls = window.matchMedia("(pointer: coarse), (hover: none)").matches;
  const trackH = ui.trackHeight;
  const ppb = ui.pixelsPerBeat;
  const startBeat = ui.scrollBeat;
  const endBeat = startBeat + width / ppb;
  const theme = getActiveTheme();

  // 1. Track Lane Backgrounds
  ctx.clearRect(0, 0, width, height);
  const activeWallpaper = getResolvedWallpaper();
  if (activeWallpaper !== "none") {
    ctx.fillStyle = theme.veil;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = theme.canvasBg;
    ctx.fillRect(0, 0, width, height);
  }

  project.tracks.forEach((trk, idx) => {
    const y = rulerH + idx * trackH - ui.scrollY;
    if (y + trackH < rulerH || y > height) return;
    if (activeWallpaper !== "none") {
      ctx.fillStyle = idx % 2 === 0 ? theme.wpLaneEven : theme.wpLaneOdd;
      if (trk.id === ui.selectedTrackId) {
        ctx.fillStyle = theme.wpLaneSelected;
      }
    } else {
      ctx.fillStyle = idx % 2 === 0 ? theme.laneEven : theme.laneOdd;
      if (trk.id === ui.selectedTrackId) {
        ctx.fillStyle = theme.laneSelected;
      }
    }
    ctx.fillRect(0, y, width, trackH);

    ctx.strokeStyle = theme.laneBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + trackH + 0.5);
    ctx.lineTo(width, y + trackH + 0.5);
    ctx.stroke();
  });

  // 2. Vertical Grid Lines (Subdivisions, Beats, Bars)
  const firstBeatInt = Math.floor(startBeat);
  const lastBeatInt = Math.ceil(endBeat);

  if (ppb >= 36 && ui.snapBeats > 0 && ui.snapBeats < 1) {
    ctx.strokeStyle = theme.gridSub;
    ctx.lineWidth = 1;
    const step = ui.snapBeats;
    for (let b = firstBeatInt; b <= lastBeatInt; b += step) {
      const x = Math.round(beatToX(b)) + 0.5;
      if (x < 0 || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, rulerH);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  for (let b = firstBeatInt; b <= lastBeatInt; b++) {
    const x = Math.round(beatToX(b)) + 0.5;
    if (x < 0 || x > width) continue;
    const isBar = b % 4 === 0;
    ctx.strokeStyle = isBar ? theme.gridBar : theme.gridBeat;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, rulerH);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // 3. Loop Region Shading in Tracks
  if (project.loopEnabled && project.loopEndBeat > project.loopStartBeat) {
    const lx0 = Math.max(0, beatToX(project.loopStartBeat));
    const lx1 = Math.min(width, beatToX(project.loopEndBeat));
    if (lx1 > lx0) {
      ctx.fillStyle = theme.loopShade;
      ctx.fillRect(lx0, rulerH, lx1 - lx0, height - rulerH);
    }
  }

  // 4. Clips & Waveforms
  for (const clip of project.clips) {
    const trackIdx = project.tracks.findIndex((t) => t.id === clip.trackId);
    if (trackIdx === -1) continue;
    const x = beatToX(clip.startBeat);
    const w = clip.durationBeats * ppb;
    const y = rulerH + trackIdx * trackH + 4 - ui.scrollY;
    const h = trackH - 8;
    if (x + w < 0 || x > width || y + h < rulerH || y > height) continue;

    const isSelected = ui.selectedClipIds.has(clip.id);
    const baseColor = clip.muted ? "#5a6572" : clip.color || "#ff7a45";

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(4, w), h, 5);
    ctx.clip();

    // Clip body background
    ctx.fillStyle = clip.muted ? "rgba(70, 78, 89, 0.55)" : hexToRgba(baseColor, 0.24);
    ctx.fillRect(x, y, w, h);

    // Clip header bar; touch devices reserve enough vertical room for 44px actions.
    const headH = touchControls ? 44 : 22;
    ctx.fillStyle = clip.muted ? "#454e59" : hexToRgba(baseColor, 0.88);
    ctx.fillRect(x, y, w, headH);

    // Clip labels are shortened to stay clear of the action buttons.
    ctx.fillStyle = "#0e1116";
    ctx.font = '600 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
    const flags = [];
    if (clip.reverse) flags.push("REV");
    if (clip.pitchSemitones) flags.push(`${clip.pitchSemitones > 0 ? "+" : ""}${clip.pitchSemitones}st`);
    const labelText = flags.length > 0 ? `${clip.name} [${flags.join(" · ")}]` : clip.name;
    const headerButtons = clipHeaderButtons(clip, w, touchControls);
    const actionSpace = touchControls
      ? (headerButtons.menu ? 94 : headerButtons.del ? 48 : 0)
      : (headerButtons.menu ? 40 : headerButtons.del ? 22 : 0);
    const labelWidth = Math.max(0, w - 14 - actionSpace);
    let fittedLabel = labelText;
    while (fittedLabel.length > 1 && ctx.measureText(fittedLabel).width > labelWidth) {
      fittedLabel = `${fittedLabel.slice(0, -2).trimEnd()}…`;
    }
    if (labelWidth >= ctx.measureText("…").width) {
      ctx.fillText(fittedLabel, x + 7, y + (touchControls ? 28 : 16));
    }

    // Draw Waveform Peaks
    const asset = assets.get(clip.assetId);
    if (asset && asset.peaks) {
      drawClipWaveform(ctx, clip, asset, x, y + headH, w, h - headH, baseColor);
    }

    // Fade In shading
    if ((clip.fadeInBeats || 0) > 0.01) {
      const fw = Math.min(w, clip.fadeInBeats * ppb);
      ctx.fillStyle = "rgba(12, 15, 20, 0.48)";
      ctx.beginPath();
      ctx.moveTo(x, y + headH);
      ctx.lineTo(x + fw, y + headH);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + fw, y + headH);
      ctx.stroke();
    }

    // Fade Out shading
    if ((clip.fadeOutBeats || 0) > 0.01) {
      const fw = Math.min(w, clip.fadeOutBeats * ppb);
      ctx.fillStyle = "rgba(12, 15, 20, 0.48)";
      ctx.beginPath();
      ctx.moveTo(x + w, y + headH);
      ctx.lineTo(x + w - fw, y + headH);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w - fw, y + headH);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
    }

    // Trim edge grip markers
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(x + 1, y + h / 2 - 8, 2.5, 16);
    ctx.fillRect(x + w - 3.5, y + h / 2 - 8, 2.5, 16);

    // Direct clip actions use larger touch targets on touch-first screens.
    if (touchControls) {
      if (headerButtons.menu) {
        const menuX = x + w - 88;
        const by = y + 1;
        ctx.fillStyle = "rgba(18, 21, 25, 0.82)";
        ctx.beginPath();
        ctx.roundRect(menuX, by, 44, 44, 5);
        ctx.fill();
        ctx.fillStyle = "#e6edf3";
        ctx.font = "800 20px sans-serif";
        ctx.fillText("⋯", menuX + 12, by + 29);
      }
      if (headerButtons.del) {
        const deleteX = x + w - 44;
        const by = y + 1;
        ctx.fillStyle = "rgba(18, 21, 25, 0.82)";
        ctx.beginPath();
        ctx.roundRect(deleteX, by, 44, 44, 5);
        ctx.fill();
        ctx.fillStyle = "#ffa39e";
        ctx.font = "800 20px sans-serif";
        ctx.fillText("×", deleteX + 15, by + 29);
      }
    } else {
      // Desktop keeps compact clip actions, but the glyphs still obey the 15px floor.
      const glyphFont = '800 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
      if (headerButtons.menu) {
        const mxBtn = x + w - 41;
        const by = y + 2;
        ctx.fillStyle = "rgba(18, 21, 25, 0.72)";
        ctx.beginPath();
        ctx.roundRect(mxBtn, by, 18, 18, 3);
        ctx.fill();
        ctx.fillStyle = "#e6edf3";
        ctx.font = glyphFont;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⋯", mxBtn + 9, by + 9.5);
      }
      if (headerButtons.del) {
        const bx = x + w - 20;
        const by = y + 2;
        ctx.fillStyle = "rgba(18, 21, 25, 0.72)";
        ctx.beginPath();
        ctx.roundRect(bx, by, 18, 18, 3);
        ctx.fill();
        ctx.fillStyle = "#ffa39e";
        ctx.font = glyphFont;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("×", bx + 9, by + 9.5);
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    ctx.restore();

    // Border (highlighted white/amber when selected)
    ctx.strokeStyle = isSelected ? "#ffffff" : hexToRgba(baseColor, 0.85);
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, Math.max(4, w - 1), h - 1, 5);
    ctx.stroke();
  }

  // 5. Razor / Slice Tool Live Preview Line
  if (ui.tool === "slice" && ui.hoverClipId) {
    const clip = project.clips.find((c) => c.id === ui.hoverClipId);
    if (clip) {
      const trackIdx = project.tracks.findIndex((t) => t.id === clip.trackId);
      const cutX = beatToX(ui.hoverBeat);
      const y = rulerH + trackIdx * trackH + 2 - ui.scrollY;
      ctx.strokeStyle = "#ff4d4f";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cutX, y);
      ctx.lineTo(cutX, y + trackH - 4);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#ff4d4f";
      ctx.fillRect(cutX - 34, y + 2, 68, 21);
      ctx.fillStyle = "#fff";
      ctx.font = '700 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
      ctx.fillText(`CUT ${formatBeatBar(ui.hoverBeat)}`, cutX - 31, y + 17);
    }
  }

  // 6. Box Selection Marquee
  if (ui.dragState && ui.dragState.mode === "marquee") {
    const { x0, y0, x1, y1 } = ui.dragState;
    const rx = Math.min(x0, x1);
    const ry = Math.min(y0, y1);
    const rw = Math.abs(x1 - x0);
    const rh = Math.abs(y1 - y0);
    ctx.fillStyle = hexToRgba(theme.marquee, 0.15);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = theme.marquee;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
  }

  // 7. Top Timeline Ruler & Loop Bar & Section Markers
  ctx.fillStyle = theme.rulerBg;
  ctx.fillRect(0, 0, width, rulerH);
  ctx.strokeStyle = theme.rulerBorder;
  ctx.beginPath();
  ctx.moveTo(0, rulerH + 0.5);
  ctx.lineTo(width, rulerH + 0.5);
  ctx.stroke();

  if (project.loopEnabled && project.loopEndBeat > project.loopStartBeat) {
    const lx0 = beatToX(project.loopStartBeat);
    const lx1 = beatToX(project.loopEndBeat);
    ctx.fillStyle = hexToRgba(theme.loopColor, 0.25);
    ctx.fillRect(lx0, 0, lx1 - lx0, 14);
    ctx.strokeStyle = theme.loopColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx0, 1);
    ctx.lineTo(lx1, 1);
    ctx.stroke();
  }

  ctx.fillStyle = theme.rulerText;
  ctx.font = '600 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
  for (let b = firstBeatInt; b <= lastBeatInt; b++) {
    const x = Math.round(beatToX(b)) + 0.5;
    if (x < 0 || x > width) continue;
    const isBar = b % 4 === 0;
    ctx.strokeStyle = isBar ? theme.tickBar : theme.tickBeat;
    ctx.beginPath();
    ctx.moveTo(x, isBar ? 16 : 25);
    ctx.lineTo(x, rulerH);
    ctx.stroke();

    if (isBar) {
      const barNum = Math.floor(b / 4) + 1;
      ctx.fillText(`${barNum}`, x + 4, touchControls ? 32 : 28);
    } else if (ppb >= 65) {
      const beatInBar = (b % 4) + 1;
      ctx.fillStyle = theme.rulerTextDim;
      ctx.fillText(`${Math.floor(b / 4) + 1}.${beatInBar}`, x + 3, touchControls ? 33 : 29);
      ctx.fillStyle = theme.rulerText;
    }
  }

  // Section markers keep the close target distinct from their fitted label.
  for (const m of project.markers || []) {
    const mx = beatToX(m.beat);
    const geo = markerGeometry(touchControls);
    if (mx < -geo.width || mx > width + geo.width) continue;
    ctx.fillStyle = m.color || "#36cfc9";
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx + geo.width, 0);
    ctx.lineTo(mx + geo.width - 6, geo.height);
    ctx.lineTo(mx, geo.height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#0d1117";
    ctx.font = '700 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
    let markerLabel = String(m.name || "");
    while (markerLabel.length > 1 && ctx.measureText(markerLabel).width > geo.labelWidth) {
      markerLabel = `${markerLabel.slice(0, -2).trimEnd()}…`;
    }
    ctx.fillText(markerLabel, mx + 4, touchControls ? 30 : 15);
    ctx.fillText("×", mx + geo.closeX, touchControls ? 30 : 15);

    ctx.strokeStyle = hexToRgba(m.color || "#36cfc9", 0.45);
    ctx.beginPath();
    ctx.moveTo(mx + 0.5, geo.height);
    ctx.lineTo(mx + 0.5, height);
    ctx.stroke();
  }

  // 8. Playhead Line & Triangle Cap
  const playBeat = engine.getPlayheadBeat(project);
  const px = beatToX(playBeat);
  if (px >= -10 && px <= width + 10) {
    ctx.strokeStyle = theme.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    ctx.fillStyle = theme.playhead;
    ctx.beginPath();
    ctx.moveTo(px - 7, 0);
    ctx.lineTo(px + 7, 0);
    ctx.lineTo(px, 11);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawClipWaveform(ctx, clip, asset, x, y, w, h, color) {
  const peaks = asset.peaks;
  if (!peaks) return;

  const secPerBeat = 60 / project.bpm;
  const rate = Math.pow(2, (clip.pitchSemitones || 0) / 12) * (clip.playbackRate || 1);
  const gainScale = Math.min(2.5, Math.pow(10, (clip.gainDb || 0) / 20));
  const midY = y + h / 2;
  const amp = h * 0.44 * gainScale;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, midY);
  ctx.lineTo(x + w, midY);
  ctx.stroke();

  const stepPx = w > 500 ? 2 : 1;
  ctx.fillStyle = clip.muted ? "rgba(180, 190, 205, 0.45)" : hexToRgba(color, 0.85);

  for (let px = 0; px < w; px += stepPx) {
    const clipFrac = px / Math.max(1, w);
    const beatInClip = clipFrac * clip.durationBeats;
    let srcSec = (clip.sourceOffsetSec || 0) + beatInClip * secPerBeat * rate;
    if (clip.reverse) {
      const totalSrcSpan = clip.durationBeats * secPerBeat * rate;
      srcSec =
        (clip.sourceOffsetSec || 0) + Math.max(0, totalSrcSpan - beatInClip * secPerBeat * rate);
    }

    const bucket = Math.floor(srcSec * peaks.bucketsPerSecond);
    if (bucket < 0 || bucket >= peaks.totalBuckets) continue;
    const minVal = peaks.min[bucket];
    const maxVal = peaks.max[bucket];
    const topY = Math.max(y + 1, midY - maxVal * amp);
    const botY = Math.min(y + h - 1, midY - minVal * amp);
    const barH = Math.max(1.5, botY - topY);
    ctx.fillRect(x + px, topY, Math.max(1, stepPx - 0.3), barH);
  }
}

function drawMinimapCanvas() {
  const canvas = dom.minimapCanvas;
  if (!canvas || canvas.clientWidth === 0) return;
  const { width, height, dpr } = resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  const theme = getActiveTheme();
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, width, height);

  const totalBeats = Math.max(
    32,
    project.loopEndBeat + 8,
    ...project.clips.map((c) => c.startBeat + c.durationBeats + 8)
  );
  const numTracks = Math.max(1, project.tracks.length);
  const rowH = (height - 4) / numTracks;

  for (const clip of project.clips) {
    const tIdx = project.tracks.findIndex((t) => t.id === clip.trackId);
    if (tIdx === -1) continue;
    const cx = (clip.startBeat / totalBeats) * width;
    const cw = Math.max(2, (clip.durationBeats / totalBeats) * width);
    const cy = 2 + tIdx * rowH;
    ctx.fillStyle = clip.muted ? "#555" : clip.color || theme.palette[0];
    ctx.fillRect(cx, cy, cw, Math.max(2, rowH - 1.5));
  }

  const viewBeats = dom.playlistCanvas.clientWidth / ui.pixelsPerBeat;
  const vx = (ui.scrollBeat / totalBeats) * width;
  const vw = Math.max(16, (viewBeats / totalBeats) * width);
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(vx, 0, vw, height);
  ctx.strokeStyle = theme.playhead;
  ctx.lineWidth = 1;
  ctx.strokeRect(vx + 0.5, 0.5, vw - 1, height - 1);

  ctx.restore();
}

/**
 * Audius Studio CHANNEL RACK & 16-STEP SEQUENCER (F6)
 */
function getActivePattern() {
  return ui.patterns[ui.activePatternIndex] || ui.patterns[0];
}

function ensurePatternStepsForAsset(pat, assetId) {
  if (!pat.steps[assetId]) {
    pat.steps[assetId] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  return pat.steps[assetId];
}

/** Per-row channel mix (volume dB, pan) lives on the pattern, so each pattern can differ. */
function getRowMix(pat, assetId) {
  pat.mix = pat.mix || {};
  if (!pat.mix[assetId]) pat.mix[assetId] = { volumeDb: 0, pan: 0 };
  return pat.mix[assetId];
}

function renderChannelRack() {
  if (!dom.channelRackRows) return;
  dom.channelRackRows.innerHTML = "";
  const pat = getActivePattern();
  if (dom.crPatternLabel) {
    dom.crPatternLabel.textContent = pat.name.split("—")[0].trim();
  }

  let idx = 1;
  for (const asset of assets.values()) {
    // Rendered synth clips are audio for the playlist, not rack channels.
    if (asset.renderOf) continue;
    const steps = ensurePatternStepsForAsset(pat, asset.id);
    const row = document.createElement("div");
    row.className = "cr-row" + (asset.id === ui.activeAssetId ? " active-channel" : "");

    const led = document.createElement("div");
    led.className = "cr-led" + (asset.muted ? "" : " on");
    led.title = "Channel Mute / Active Switch";
    led.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      asset.muted = !asset.muted;
      renderChannelRack();
    });

    const insertBox = document.createElement("div");
    insertBox.className = "cr-insert-box";
    insertBox.textContent = String(idx);
    insertBox.title = `Target Mixer Track ${idx}`;

    const chBtn = document.createElement("button");
    chBtn.className = "cr-channel-btn";
    chBtn.style.background = `linear-gradient(180deg, ${hexToRgba(asset.color || "#3b82f6", 0.85)} 0%, ${hexToRgba(asset.color || "#3b82f6", 0.55)} 100%)`;
    chBtn.textContent = asset.name.replace(/^\d+\s*[-·]\s*/, "");
    chBtn.title = `Select "${asset.name}" for Piano Roll & Playlist Painting (Click to audition)`;
    chBtn.addEventListener("click", () => {
      ui.activeAssetId = asset.id;
      renderAssetPool();
      renderChannelRack();
      drawPianoRollCanvas();
      previewAssetOneShot(asset, 0, 0.35);
    });
    let synthEditBtn = null;
    if (asset.instrumentId) {
      chBtn.addEventListener("dblclick", () => instruments.openEditor(asset));
      synthEditBtn = document.createElement("button");
      synthEditBtn.type = "button";
      synthEditBtn.className = "mmth-rack-edit";
      synthEditBtn.innerHTML = icon("sliders-vertical", { solo: true });
      synthEditBtn.title = `Edit synth "${asset.name}"`;
      synthEditBtn.setAttribute("aria-label", `Edit synth ${asset.name}`);
      synthEditBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        instruments.openEditor(asset);
      });
    }

    const mix = getRowMix(pat, asset.id);
    const mixWrap = document.createElement("div");
    mixWrap.className = "cr-row-mix";
    const volInput = document.createElement("input");
    volInput.type = "range";
    volInput.min = "-36";
    volInput.max = "6";
    volInput.step = "0.5";
    volInput.className = "cr-row-vol";
    volInput.dataset.format = "db";
    volInput.dataset.label = "Row volume";
    volInput.dataset.default = "0";
    volInput.title = "Channel volume (double-click to reset)";
    volInput.setAttribute("aria-label", `${asset.name} volume`);
    setRange(volInput, mix.volumeDb);
    const panInput = document.createElement("input");
    panInput.type = "range";
    panInput.min = "-1";
    panInput.max = "1";
    panInput.step = "0.05";
    panInput.className = "cr-row-pan";
    panInput.dataset.format = "pan";
    panInput.dataset.label = "Row pan";
    panInput.dataset.default = "0";
    panInput.title = "Channel pan (double-click to centre)";
    panInput.setAttribute("aria-label", `${asset.name} pan`);
    setRange(panInput, mix.pan);
    // One undo point per slider gesture (pointer down) or per key press.
    undoOnGesture(volInput);
    undoOnGesture(panInput);
    volInput.addEventListener("input", () => {
      mix.volumeDb = Number(volInput.value);
    });
    panInput.addEventListener("input", () => {
      mix.pan = Number(panInput.value);
    });
    mixWrap.append(volInput, panInput);

    const stepsGrid = document.createElement("div");
    stepsGrid.className = "cr-steps-grid";

    for (let s = 0; s < 16; s++) {
      const groupIdx = Math.floor(s / 4);
      const stepBtn = document.createElement("button");
      stepBtn.className =
        "cr-step " +
        (groupIdx % 2 === 0 ? "beat-even" : "beat-odd") +
        (steps[s] ? " active" : "");
      stepBtn.dataset.stepIndex = String(s);
      stepBtn.title = `Step ${s + 1} (Click to toggle, Right-click to clear)`;
      stepBtn.addEventListener("click", () => {
        pushUndoState();
        steps[s] = steps[s] ? 0 : 1;
        stepBtn.classList.toggle("active", !!steps[s]);
        if (steps[s]) {
          previewAssetOneShot(asset, 0, 0.25, 0.85, mix);
        }
      });
      stepBtn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (isTouchContextMenu(ev)) return;
        if (steps[s]) pushUndoState();
        steps[s] = 0;
        stepBtn.classList.remove("active");
      });
      stepsGrid.appendChild(stepBtn);
    }

    row.append(led, insertBox, chBtn);
    if (synthEditBtn) row.append(synthEditBtn);
    row.append(mixWrap, stepsGrid);
    dom.channelRackRows.appendChild(row);
    idx++;
  }
}

function previewAssetOneShot(asset, pitchSt = 0, maxSec = 0.45, gainVal = 0.85, mix = null) {
  // Synth channels play a note on their live synth: the root note, shifted like a sample would be.
  if (asset && asset.instrumentId) {
    instruments.previewNote(asset, pitchSt, maxSec, gainVal);
    return;
  }
  if (!asset || !asset.buffer) return;
  const ctx = engine.ensureContext();
  const rate = Math.pow(2, pitchSt / 12);
  const offsetSec = Math.min(Math.max(0, asset.durationSec - 0.05), asset.firstOnsetSec || 0);
  const availSec = Math.max(0.02, (asset.durationSec - offsetSec) / rate);
  const playDur = Math.max(0.02, Math.min(maxSec, availSec));
  const targetGain = Math.max(0.0002, gainVal * (mix ? dbToGain(mix.volumeDb) : 1));
  const now = ctx.currentTime;
  const relSec = Math.min(0.024, playDur * 0.28);

  const src = ctx.createBufferSource();
  src.buffer = asset.buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(targetGain, now + 0.002);
  g.gain.setValueAtTime(targetGain, Math.max(now + 0.002, now + playDur - relSec));
  g.gain.exponentialRampToValueAtTime(0.0001, now + playDur);
  src.connect(g);
  if (ctx.createStereoPanner && mix && mix.pan) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, mix.pan));
    g.connect(panner);
    panner.connect(engine.masterGain);
  } else {
    g.connect(engine.masterGain);
  }
  src.start(now, offsetSec, playDur + 0.005);
}

let crPreviewTimer = 0;
function playChannelRackPatternPreview() {
  // A second click restarts the audition instead of stacking two loops.
  if (crPreviewTimer) clearInterval(crPreviewTimer);
  const pat = getActivePattern();
  const stepDurSec = 60 / project.bpm / 4; // 16th note
  // Swing delays every off step by a share of a 16th, like the rack's Swing control.
  const swingSec = (ui.swing / 100) * stepDurSec * 0.5;
  let step = 0;
  setStatus(`Auditioning ${pat.name} (16 steps)`);
  const timer = setInterval(() => {
    document.querySelectorAll(".cr-step").forEach((el) => {
      el.classList.toggle("playing-step", Number(el.dataset.stepIndex) === step);
    });
    const delayMs = (step % 2 === 1 ? swingSec : 0) * 1000;
    for (const asset of assets.values()) {
      if (asset.muted || asset.renderOf) continue;
      const arr = pat.steps[asset.id];
      if (arr && arr[step]) {
        const mix = getRowMix(pat, asset.id);
        // A synth note gets a gate shorter than one step, so repeated steps retrigger cleanly.
        const dur = asset.instrumentId ? stepDurSec * 0.9 : stepDurSec * 1.8;
        if (delayMs > 0) {
          setTimeout(
            () => previewAssetOneShot(asset, 0, dur, 0.75, mix),
            delayMs
          );
        } else {
          previewAssetOneShot(asset, 0, dur, 0.75, mix);
        }
      }
    }
    step++;
    if (step >= 16) {
      clearInterval(timer);
      crPreviewTimer = 0;
      setTimeout(() => {
        document.querySelectorAll(".cr-step.playing-step").forEach((el) => el.classList.remove("playing-step"));
      }, 120);
    }
  }, stepDurSec * 1000);
  crPreviewTimer = timer;
}

function stampChannelRackPatternToPlaylist() {
  const pat = getActivePattern();
  pushUndoState();
  const baseBeat = snapBeat(engine.getPlayheadBeat(project));
  // Swing shifts every off step, matching the Step Rack's Swing control.
  const swingBeats = (ui.swing / 100) * 0.125;
  let added = 0;
  let assetIndex = 0;
  const synthRows = [];
  for (const asset of assets.values()) {
    if (asset.renderOf) continue;
    const steps = pat.steps[asset.id];
    if (!steps || asset.muted) {
      assetIndex++;
      continue;
    }
    const mix = getRowMix(pat, asset.id);
    const track = project.tracks[assetIndex % project.tracks.length];
    if (asset.instrumentId) {
      // Synth rows are rendered to one audio clip per row (below), not stamped as slices.
      if (steps.some((v) => v)) synthRows.push({ asset, steps: steps.slice(0, 16), mix, trackId: track.id });
      assetIndex++;
      continue;
    }
    for (let s = 0; s < 16; s++) {
      if (!steps[s]) continue;
      const clip = {
        id: nextId("clip"),
        assetId: asset.id,
        trackId: track.id,
        name: `${asset.name.split(" ")[0]} [S${s + 1}]`,
        color: asset.color || track.color,
        startBeat: Number((baseBeat + s * 0.25 + (s % 2 === 1 ? swingBeats : 0)).toFixed(4)),
        durationBeats: 0.25,
        sourceOffsetSec: Number((asset.firstOnsetSec || 0).toFixed(4)),
        gainDb: mix.volumeDb,
        pan: mix.pan,
        pitchSemitones: 0,
        fadeInBeats: 0.01,
        fadeOutBeats: 0.02,
        reverse: false,
        muted: false,
      };
      project.clips.push(clip);
      added++;
    }
    assetIndex++;
  }
  onProjectMutated(
    `Stamped ${pat.name} (${added} step slices${synthRows.length ? `, rendering ${synthRows.length} synth row${synthRows.length === 1 ? "" : "s"}…` : ""}) at ${formatBeatBar(baseBeat)}`
  );
  for (const row of synthRows) {
    instruments
      .renderSteps(row.asset, row.steps, { swingBeats, label: pat.name.split("—")[0].trim() })
      .then((res) => {
        if (!res) return;
        const track = project.tracks.find((t) => t.id === row.trackId) || project.tracks[0];
        if (!track) return;
        project.clips.push({
          id: nextId("clip"),
          assetId: res.assetId,
          trackId: track.id,
          name: `${row.asset.name} · ${pat.name.split("—")[0].trim()}`,
          color: row.asset.color || track.color,
          startBeat: baseBeat,
          durationBeats: Math.max(0.25, Number((res.durationSec * (project.bpm / 60)).toFixed(3))),
          sourceOffsetSec: 0,
          gainDb: row.mix.volumeDb,
          pan: row.mix.pan,
          pitchSemitones: 0,
          fadeInBeats: 0,
          fadeOutBeats: 0.02,
          reverse: false,
          muted: false,
        });
        onProjectMutated(`Rendered synth "${row.asset.name}" to ${track.name} at ${formatBeatBar(baseBeat)}`);
      })
      .catch((err) => setStatus(`Synth render failed: ${err.message}`, { kind: "error" }));
  }
}

/**
 * Audius Studio PIANO ROLL & VELOCITY EDITOR (F7)
 */
const PR_ROWS = [
  { row: 0,  note: "E5",  semi: 4,  black: false },
  { row: 1,  note: "D#5", semi: 3,  black: true },
  { row: 2,  note: "D5",  semi: 2,  black: false },
  { row: 3,  note: "C#5", semi: 1,  black: true },
  { row: 4,  note: "C5",  semi: 0,  black: false },
  { row: 5,  note: "B4",  semi: -1, black: false },
  { row: 6,  note: "A#4", semi: -2, black: true },
  { row: 7,  note: "A4",  semi: -3, black: false },
  { row: 8,  note: "G#4", semi: -4, black: true },
  { row: 9,  note: "G4",  semi: -5, black: false },
  { row: 10, note: "F#4", semi: -6, black: true },
  { row: 11, note: "F4",  semi: -7, black: false },
  { row: 12, note: "E4",  semi: -8, black: false },
  { row: 13, note: "D#4", semi: -9, black: true },
  { row: 14, note: "D4",  semi: -10, black: false },
  { row: 15, note: "C#4", semi: -11, black: true },
  { row: 16, note: "C4",  semi: -12, black: false },
];

function drawPianoRollCanvas() {
  const canvas = dom.pianoRollCanvas;
  if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
  const { width, height, dpr } = resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  const activeAsset = assets.get(ui.activeAssetId) || Array.from(assets.values())[0];
  if (dom.prChannelLabel && activeAsset) {
    dom.prChannelLabel.textContent = activeAsset.name;
  }

  const keyW = 42;
  const velH = Math.max(28, Math.round(height * 0.23));
  const gridH = height - velH;
  const numRows = PR_ROWS.length;
  const rowH = gridH / numRows;
  const totalSteps = 16;
  const stepW = (width - keyW) / totalSteps;

  // Background
  const theme = getActiveTheme();
  ctx.fillStyle = theme.canvasBg || "#181d22";
  ctx.fillRect(0, 0, width, height);

  // 1. Rows & Left Piano Keyboard
  for (let r = 0; r < numRows; r++) {
    const info = PR_ROWS[r];
    const y = r * rowH;

    // Grid lane background
    ctx.fillStyle = info.black ? "rgba(0, 0, 0, 0.26)" : "rgba(255, 255, 255, 0.03)";
    ctx.fillRect(keyW, y, width - keyW, rowH);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(keyW, y + rowH);
    ctx.lineTo(width, y + rowH);
    ctx.stroke();

    // Piano key on left
    ctx.fillStyle = info.black ? "#1f2428" : "#e2e8f0";
    ctx.fillRect(0, y, keyW - 1, rowH - 0.5);
    ctx.strokeStyle = "#0f1317";
    ctx.strokeRect(0, y, keyW - 1, rowH);

    if (info.note.startsWith("C") && !info.black) {
      ctx.fillStyle = "#0f172a";
      ctx.font = '700 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
      ctx.fillText(info.note, 6, y + rowH - 4);
    } else if (!info.black && rowH >= 17) {
      ctx.fillStyle = "#64748b";
      ctx.font = '600 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
      ctx.fillText(info.note, 8, y + rowH - 4);
    }
  }

  // 2. Vertical Step & Beat Grid Lines
  for (let s = 0; s <= totalSteps; s++) {
    const x = keyW + s * stepW;
    ctx.strokeStyle = s % 4 === 0 ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.06)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // 3. Draw Audius Magenta/Violet MIDI Note Bars
  const pat = getActivePattern();
  for (const n of pat.notes) {
    const nx = keyW + n.startStep * stepW;
    const nw = Math.max(6, n.lenSteps * stepW - 1);
    const ny = n.row * rowH + 0.5;
    const nh = Math.max(5, rowH - 1);

    ctx.fillStyle = "#D767E1";
    ctx.beginPath();
    ctx.roundRect(nx, ny, nw, nh, 3);
    ctx.fill();

    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1;
    ctx.strokeRect(nx, ny, nw, nh);

    const rowInfo = PR_ROWS[n.row] || PR_ROWS[4];
    // The note name inside the bar only when the bar is tall enough for 15px type.
    if (nh >= 17) {
      ctx.fillStyle = "#191026";
      ctx.font = '700 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
      ctx.fillText(n.label || rowInfo.note, nx + 3, ny + nh - 2);
    }
  }

  // 3b. Live MIDI keys held right now — a performance view; pattern data is untouched.
  if (ui.midiHeldNotes && ui.midiHeldNotes.size > 0) {
    for (const [row, vel] of midiHeldRowMap()) {
      const info = PR_ROWS[row];
      if (!info) continue;
      const y = row * rowH;
      ctx.fillStyle = `rgba(21, 216, 100, ${0.16 + 0.26 * vel})`;
      ctx.fillRect(keyW, y, width - keyW, rowH);
      ctx.strokeStyle = "rgba(21, 216, 100, 0.55)";
      ctx.beginPath();
      ctx.moveTo(keyW, y + rowH);
      ctx.lineTo(width, y + rowH);
      ctx.stroke();
      // The pressed piano key glows so the roll and the keyboard agree.
      ctx.fillStyle = "#15D864";
      ctx.fillRect(0, y, keyW - 1, rowH - 0.5);
      if (rowH >= 17) {
        ctx.fillStyle = "#08170d";
        ctx.font = '700 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
        ctx.fillText(info.note, 6, y + rowH - 4);
      }
    }
  }

  // 3c. A recording indicator that cannot be mistaken for the transport.
  if (ui.midiRecord) {
    const label = "REC";
    ctx.font = '800 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
    const textW = ctx.measureText(label).width;
    const bx = Math.max(keyW + 6, width - textW - 34);
    ctx.fillStyle = "rgba(239, 68, 68, 0.92)";
    ctx.beginPath();
    ctx.roundRect(bx, 6, textW + 26, 24, 6);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(bx + 11, 18, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, bx + 20, 23);
  }

  // 4. Bottom Control / Velocity Stalk Lane
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.fillRect(0, gridH, width, velH);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.beginPath();
  ctx.moveTo(0, gridH);
  ctx.lineTo(width, gridH);
  ctx.stroke();

  ctx.fillStyle = "#A6AAC0";
  ctx.font = '700 15px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
  ctx.fillText("VEL", 6, gridH + 19);

  for (const n of pat.notes) {
    const cx = keyW + n.startStep * stepW + 4;
    const stalkH = Math.max(4, (velH - 6) * (n.vel ?? 0.85));
    const sy = height - stalkH;

    ctx.strokeStyle = "#CC0FE0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, height);
    ctx.lineTo(cx, sy);
    ctx.stroke();

    ctx.fillStyle = "#F479FF";
    ctx.beginPath();
    ctx.arc(cx, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Playhead: the 16-step pattern loops in step with the transport (same mapping as the Step Rack).
  if (engine.isPlaying) {
    const stepPos = ((engine.getPlayheadBeat(project) * 4) % totalSteps + totalSteps) % totalSteps;
    const px = keyW + stepPos * stepW;
    ctx.fillStyle = "rgba(21, 216, 100, 0.12)";
    ctx.fillRect(px, 0, stepW, gridH);
    ctx.fillStyle = "#15D864";
    ctx.fillRect(px, 0, 2, height);
  }

  ctx.restore();
}

function setupPianoRollInteractions() {
  const canvas = dom.pianoRollCanvas;
  if (!canvas) return;

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (isTouchContextMenu(e)) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const keyW = 42;
    const velH = Math.max(28, Math.round(rect.height * 0.23));
    const gridH = rect.height - velH;
    const rowH = gridH / PR_ROWS.length;
    const stepW = (rect.width - keyW) / 16;
    if (x < keyW || y > gridH) return;
    const step = (x - keyW) / stepW;
    const row = Math.floor(y / rowH);
    const pat = getActivePattern();
    if (pat.notes.some((n) => n.row === row && step >= n.startStep && step <= n.startStep + n.lenSteps)) pushUndoState();
    pat.notes = pat.notes.filter(
      (n) => !(n.row === row && step >= n.startStep && step <= n.startStep + n.lenSteps)
    );
    drawPianoRollCanvas();
    setStatus("Deleted note in Piano Roll (Right-Click)");
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const keyW = 42;
    const velH = Math.max(28, Math.round(rect.height * 0.23));
    const gridH = rect.height - velH;
    const rowH = gridH / PR_ROWS.length;
    const stepW = (rect.width - keyW) / 16;
    const pat = getActivePattern();
    const activeAsset = assets.get(ui.activeAssetId) || Array.from(assets.values())[0];

    // Click on Left Piano Keys -> Audition Note
    if (x <= keyW && y <= gridH) {
      const row = Math.max(0, Math.min(PR_ROWS.length - 1, Math.floor(y / rowH)));
      const info = PR_ROWS[row];
      previewAssetOneShot(activeAsset, info.semi, 0.45);
      setStatus(`Piano Roll key: ${info.note}`);
      return;
    }

    // Click/Drag in Bottom Velocity Lane -> Adjust Velocity Stalk
    if (y > gridH && x > keyW) {
      const step = (x - keyW) / stepW;
      const target = pat.notes.find((n) => Math.abs(n.startStep - step) < 1.2);
      if (target) {
        pushUndoState();
        target.vel = Math.max(0.1, Math.min(1.0, 1 - (y - gridH) / velH));
        ui.prDrag = { mode: "vel", gridH, velH, keyW, stepW };
        drawPianoRollCanvas();
      }
      return;
    }

    // Click in Main Note Grid
    const stepFloat = (x - keyW) / stepW;
    const stepInt = Math.max(0, Math.min(15, Math.floor(stepFloat)));
    const row = Math.max(0, Math.min(PR_ROWS.length - 1, Math.floor(y / rowH)));
    const hit = pat.notes.find(
      (n) => n.row === row && stepFloat >= n.startStep && stepFloat <= n.startStep + n.lenSteps
    );

    if (hit) {
      pushUndoState();
      if (stepFloat >= hit.startStep + hit.lenSteps - 0.45) {
        ui.prDrag = { mode: "resize", note: hit, keyW, stepW, rowH };
      } else {
        ui.prDrag = {
          mode: "move",
          note: hit,
          offsetStep: stepFloat - hit.startStep,
          keyW,
          stepW,
          rowH,
        };
      }
      const info = PR_ROWS[hit.row] || PR_ROWS[4];
      previewAssetOneShot(activeAsset, info.semi, 0.35, hit.vel ?? 0.85);
    } else {
      const info = PR_ROWS[row];
      const newNote = {
        id: nextId("prn"),
        row,
        startStep: stepInt,
        lenSteps: 2,
        vel: 0.85,
        label: info.note,
      };
      pushUndoState();
      pat.notes.push(newNote);
      ui.prDrag = { mode: "resize", note: newNote, keyW, stepW, rowH };
      previewAssetOneShot(activeAsset, info.semi, 0.35, 0.85);
      drawPianoRollCanvas();
      setStatus(`Placed Piano Roll note ${info.note} at Step ${stepInt + 1}`);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!ui.prDrag) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const d = ui.prDrag;
    const pat = getActivePattern();

    if (d.mode === "vel") {
      const step = (x - d.keyW) / d.stepW;
      const target = pat.notes.find((n) => Math.abs(n.startStep - step) < 1.0);
      if (target) {
        target.vel = Math.max(0.1, Math.min(1.0, 1 - (y - d.gridH) / d.velH));
        drawPianoRollCanvas();
      }
    } else if (d.mode === "resize") {
      const curStep = Math.round((x - d.keyW) / d.stepW);
      d.note.lenSteps = Math.max(1, Math.min(16 - d.note.startStep, curStep - d.note.startStep));
      drawPianoRollCanvas();
    } else if (d.mode === "move") {
      const nextStep = Math.max(0, Math.min(16 - d.note.lenSteps, Math.round((x - d.keyW) / d.stepW - d.offsetStep)));
      const nextRow = Math.max(0, Math.min(PR_ROWS.length - 1, Math.floor(y / d.rowH)));
      d.note.startStep = nextStep;
      d.note.row = nextRow;
      d.note.label = PR_ROWS[nextRow].note;
      drawPianoRollCanvas();
    }
  });

  const endPr = () => {
    ui.prDrag = null;
  };
  canvas.addEventListener("pointerup", endPr);
  canvas.addEventListener("pointercancel", endPr);
}

/**
 * LIVE MIDI KEYBOARD INPUT (Web MIDI — Chromium/Edge only)
 *
 * A connected keyboard plays the Piano Roll's selected channel through the
 * existing engine graph (see AudioEngine.startLiveVoice), velocity -> gain,
 * polyphonic, with a lossless note-off (running status, 9x velocity 0, CC64
 * sustain and CC120/123 panic are all handled in midi-input.js).
 *
 * Firefox and Safari have no Web MIDI API at all: there `supported` is false,
 * the Enable button is disabled with an explanation and the pointer audition
 * and Ctrl+T typing keyboard keep working.
 *
 * Held keys are drawn on the roll as a live-performance view only — pattern
 * data is never touched unless Record (Rec) is on.
 */
ui.midiHeldNotes = new Map(); // "channel:note" -> { note, velocity, voice }
ui.midiRecord = null; // { startedAtMs, added } while recording
const midiPendingNotes = new Map(); // "channel:note" -> { absStartStep, row, vel }
let midiDeviceSummary = "No device";

const midiInput = new MidiInput({
  onEvent: handleMidiEvent,
  onStatus: (text, kind) => renderMidiStatus(text, kind),
  onDevices: (devices, selectedId) => renderMidiDevices(devices, selectedId),
});

function renderMidiStatus(text, kind = "off") {
  if (!dom.midiStatus) return;
  dom.midiStatus.textContent = text;
  dom.midiStatus.dataset.kind = kind;
}

function renderMidiDevices(devices, selectedId) {
  if (!dom.midiDeviceSelect) return;
  const select = dom.midiDeviceSelect;
  select.replaceChildren();
  if (!devices || devices.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = midiInput.enabled ? "No device" : "MIDI off";
    select.appendChild(opt);
    select.disabled = true;
    midiDeviceSummary = "No device connected";
    syncMidiControls();
    return;
  }
  for (const dev of devices) {
    const opt = document.createElement("option");
    opt.value = dev.id;
    opt.textContent = dev.manufacturer ? `${dev.name} · ${dev.manufacturer}` : dev.name;
    select.appendChild(opt);
  }
  select.disabled = false;
  if (selectedId && devices.some((d) => d.id === selectedId)) select.value = selectedId;
  midiDeviceSummary = devices.length === 1 ? devices[0].name : `${devices.length} devices`;
  syncMidiControls();
}

function syncMidiControls() {
  const on = midiInput.enabled;
  if (dom.btnMidiEnable) {
    dom.btnMidiEnable.setAttribute("aria-pressed", String(on));
    dom.btnMidiEnable.classList.toggle("on", on);
    dom.btnMidiEnable.innerHTML = on
      ? `${icon("keyboard")}MIDI On`
      : `${icon("keyboard")}Enable MIDI`;
  }
  if (dom.midiChannelSelect) dom.midiChannelSelect.disabled = !on;
  if (dom.btnMidiRecord) dom.btnMidiRecord.disabled = !on;
  if (dom.midiDeviceSelect && !on) dom.midiDeviceSelect.disabled = true;
}

/** The channel's sound: exactly what the Piano Roll header names. */
function midiSelectedAsset() {
  return assets.get(ui.activeAssetId) || Array.from(assets.values())[0] || null;
}

/** The insert whose FX chain should carry the live note: the channel's own track when it has one. */
function midiTrackForAsset(asset) {
  if (asset) {
    const clip = project.clips.find(
      (c) => c.assetId === asset.id && project.tracks.some((t) => t.id === c.trackId)
    );
    if (clip) return clip.trackId;
  }
  return ui.selectedTrackId;
}

function midiHeldRowMap() {
  const rows = new Map();
  for (const item of ui.midiHeldNotes.values()) {
    const semi = item.note - 72; // C5 (72) is the Piano Roll's row 4 anchor
    const row = PR_ROWS.findIndex((r) => r.semi === semi);
    if (row >= 0) rows.set(row, Math.max(rows.get(row) || 0, item.velocity / 127));
  }
  return rows;
}

/**
 * LMN-3 CONTROLLER: its encoders and buttons drive the studio the way they drive the LMN-3
 * software (lmn3-controller.js decodes the messages). Its octave knob shifts incoming notes.
 */
const lmn3NoteShift = new Map(); // "channel:note" as played -> note actually sounded
let lmn3TempoMode = false;
let lmn3Clipboard = null;

const lmn3SelectedTrack = () => project.tracks.find((t) => t.id === ui.selectedTrackId) || project.tracks[0];
const lmn3HeaderButton = (cls) => document.querySelector(`.track-header-item.selected .trk-btn.${cls}`);
const lmn3Playhead = () => engine.getPlayheadBeat(project);
const lmn3IsShown = (el) => !!(el && (el.offsetWidth || el.getClientRects().length));

function lmn3SelectTrack(delta) {
  const idx = project.tracks.findIndex((t) => t.id === ui.selectedTrackId);
  const next = project.tracks[Math.max(0, Math.min(project.tracks.length - 1, (idx < 0 ? 0 : idx) + delta))];
  if (!next) return;
  ui.selectedTrackId = next.id;
  renderTrackHeaders();
  drawAllCanvases();
  setStatus(`Selected ${next.name}`, { kind: "value" });
}

function lmn3SetLoop(startBeat, endBeat, message) {
  project.loopStartBeat = Math.max(0, startBeat);
  project.loopEndBeat = Math.max(project.loopStartBeat + 1, endBeat);
  onProjectMutated(message);
}

function lmn3ClipUnderPlayhead(track) {
  const beat = lmn3Playhead();
  return project.clips.find((c) => c.trackId === track.id && beat > c.startBeat && beat < c.startBeat + c.durationBeats);
}

function lmn3Slice() {
  const clip = lmn3ClipUnderPlayhead(lmn3SelectedTrack());
  if (!clip) return setStatus("No clip under the playhead on the selected track");
  ui.selectedClipIds.clear();
  ui.selectedClipIds.add(clip.id);
  splitAtPlayhead();
}

function lmn3Cut() {
  const clip = project.clips.find((c) => ui.selectedClipIds.has(c.id)) || lmn3ClipUnderPlayhead(lmn3SelectedTrack());
  if (!clip) return setStatus("No clip under the playhead on the selected track");
  pushUndoState();
  lmn3Clipboard = { ...clip };
  project.clips = project.clips.filter((c) => c.id !== clip.id);
  ui.selectedClipIds.delete(clip.id);
  onProjectMutated(`Cut "${clip.name}"`);
}

function lmn3Paste() {
  if (!lmn3Clipboard) return setStatus("Nothing to paste: cut a clip first");
  pushUndoState();
  const clip = { ...lmn3Clipboard, id: nextId("clip"), trackId: lmn3SelectedTrack().id, startBeat: Math.max(0, snapBeat(lmn3Playhead())) };
  project.clips.push(clip);
  ui.selectedClipIds.clear();
  ui.selectedClipIds.add(clip.id);
  onProjectMutated(`Pasted "${clip.name}" at ${formatBeatBar(clip.startBeat)}`);
}

// "Tracks" brings the Playlist forward: on phones it closes whichever window is in front.
function lmn3ShowPlaylist() {
  const toggles = { library: "btn-toggle-pool", step: "btn-toggle-channel-rack", piano: "btn-toggle-piano-roll", mixer: "btn-toggle-mixer", trellis: "btn-toggle-trellis", inspector: "btn-toggle-inspector" };
  const front = document.getElementById("workspace")?.dataset.mobileWindow;
  if (compactLayoutQuery.matches && front && toggles[front]) document.getElementById(toggles[front])?.click();
  setStatus("Playlist", { kind: "value" });
}

const lmn3 = createLmn3Controller({
  onDetected() {
    setStatus("LMN-3 controller connected");
  },
  onOctave(shift) {
    setStatus(`Octave ${shift > 0 ? "+" : ""}${shift}`, { kind: "value" });
  },
  onEncoder(index, delta, { control }) {
    const track = lmn3SelectedTrack();
    const mixerOpen = lmn3IsShown(dom.mixerWindow) && !dom.mixerWindow.classList.contains("collapsed");
    if (lmn3TempoMode && index === 1) {
      dom.bpmInput.value = String(Math.max(40, Math.min(260, Math.round(project.bpm + delta * (control ? 5 : 1)))));
      dom.bpmInput.dispatchEvent(new Event("change"));
      return;
    }
    if (index === 1) return lmn3SelectTrack(delta);
    if (index === 2) {
      if (mixerOpen && track) {
        track.volumeDb = Math.max(-60, Math.min(6, Math.round(((track.volumeDb ?? 0) + delta * (control ? 0.1 : 1)) * 10) / 10));
        engine.syncTrackNodes(project);
        renderTrackHeaders();
        renderMixerStrips();
        return setStatus(`${track.name} volume ${track.volumeDb.toFixed(1)} dB`, { kind: "value" });
      }
      if (control) return lmn3SetLoop(project.loopStartBeat + delta, project.loopEndBeat, `Loop start ${formatBeatBar(project.loopStartBeat + delta)}`);
      return lmn3SetLoop(project.loopStartBeat, project.loopEndBeat + delta, `Loop end ${formatBeatBar(project.loopEndBeat + delta)}`);
    }
    if (index === 3) {
      if (mixerOpen && track) {
        track.pan = Math.max(-1, Math.min(1, Math.round(((track.pan ?? 0) + delta * 0.05) * 100) / 100));
        engine.syncTrackNodes(project);
        renderTrackHeaders();
        renderMixerStrips();
        return setStatus(`${track.name} pan ${Math.round(track.pan * 100)}`, { kind: "value" });
      }
      const beat = lmn3Playhead();
      const target = Math.max(0, control ? Math.round(beat) + delta : beat + delta * (ui.snapBeats || 0.25));
      engine.seek(project, assets, target);
      drawAllCanvases();
      return setStatus(`Playhead ${formatBeatBar(target)}`, { kind: "value" });
    }
    if (index === 4) {
      if (mixerOpen) {
        project.masterVolumeDb = Math.max(-36, Math.min(6, (project.masterVolumeDb ?? 0) + delta));
        setRange(dom.masterVol, project.masterVolumeDb);
        engine.syncTrackNodes(project);
        return setStatus(`Master volume ${project.masterVolumeDb.toFixed(1)} dB`, { kind: "value" });
      }
      if (!track) return;
      const i = PALETTE.indexOf(track.color);
      track.color = PALETTE[(i + delta + PALETTE.length) % PALETTE.length];
      renderTrackHeaders();
      drawAllCanvases();
    }
  },
  onEncoderPress(index) {
    if (index === 1) return setStatus(`Selected ${lmn3SelectedTrack()?.name || "no track"}`, { kind: "value" });
    if (index === 3) return lmn3HeaderButton("solo")?.click();
    if (index === 4) return lmn3HeaderButton("mute")?.click();
  },
  onButton(name, { control }) {
    if (name !== "tempo") lmn3TempoMode = false;
    switch (name) {
      case "play": return dom.btnPlay.click();
      case "stop": return dom.btnStop.click();
      case "loop": return dom.btnLoop.click();
      case "loopIn": return lmn3SetLoop(Math.round(lmn3Playhead()), project.loopEndBeat, `Loop start set to ${formatBeatBar(Math.round(lmn3Playhead()))}`);
      case "loopOut": return lmn3SetLoop(project.loopStartBeat, Math.round(lmn3Playhead()), `Loop end set to ${formatBeatBar(Math.round(lmn3Playhead()))}`);
      case "undo": return control ? redo() : undo();
      case "save": return saveProject();
      case "slice": return lmn3Slice();
      case "cut": return lmn3Cut();
      case "paste": return lmn3Paste();
      case "plus": return dom.btnAddTrack.click();
      case "minus": return lmn3HeaderButton("del-trk")?.click();
      case "tracks": return lmn3ShowPlaylist();
      case "mixer": return dom.btnToggleMixer?.click();
      case "sequencers": return dom.btnToggleChannelRack?.click();
      case "plugins": return dom.btnToggleInspector?.click();
      case "settings": {
        const menu = document.querySelector(".topbar-menu");
        if (menu) menu.open = !menu.open;
        return undefined;
      }
      case "tempo":
        lmn3TempoMode = !lmn3TempoMode;
        return setStatus(lmn3TempoMode ? "Tempo: turn encoder 1 (hold Control for 5 BPM steps)" : "Tempo editing off");
      case "record":
        if (dom.btnMidiRecord && !dom.btnMidiRecord.disabled) return dom.btnMidiRecord.click();
        return setStatus("Turn MIDI on to record into the Piano Roll");
      case "modifiers": return setStatus("Modifiers aren't in Audius Studio yet");
      default: return undefined;
    }
  },
});

function handleMidiEvent(msg) {
  if (!msg) return;
  if (msg.channel === null) {
    // Real-time transport bytes are parsed and exposed; song sync lands in a later feature.
    return;
  }
  if (msg.type === "cc") {
    lmn3.handleCc(msg.controller, msg.value);
    return;
  }
  // The LMN-3 octave knob shifts notes; a note releases at the pitch it started on.
  if (msg.type === "noteon" || msg.type === "noteoff") {
    const key = `${msg.channel}:${msg.note}`;
    if (msg.type === "noteon") {
      const shifted = Math.max(0, Math.min(127, msg.note + lmn3.octaveShift * 12));
      lmn3NoteShift.set(key, shifted);
      msg = { ...msg, note: shifted };
    } else if (lmn3NoteShift.has(key)) {
      msg = { ...msg, note: lmn3NoteShift.get(key) };
      lmn3NoteShift.delete(key);
    }
  }
  if (msg.type === "noteon") {
    midiStartNote(msg);
  } else if (msg.type === "noteoff") {
    midiStopNote(msg);
  } else if (msg.type === "program") {
    midiProgramChange(msg);
  }
}

function midiStartNote(msg) {
  const key = `${msg.channel}:${msg.note}`;
  if (ui.midiHeldNotes.has(key)) midiStopNote(msg); // retrigger without a hanging voice
  const asset = midiSelectedAsset();
  if (!asset || !asset.buffer) {
    renderMidiStatus("MIDI note received, but this channel has no sound loaded.", "warn");
    return;
  }
  engine.ensureContext();
  let voice;
  if (asset.instrumentId) {
    // Synth channel: a real note-on (held until note-off), not a resampled one-shot.
    voice = instruments.midiNoteOn(asset, msg.note, Math.max(0.02, msg.velocity / 127));
  } else {
    const rate = Math.pow(2, (msg.note - 72) / 12);
    voice = engine.startLiveVoice({
      buffer: asset.buffer,
      rate,
      velocity: Math.max(0.02, msg.velocity / 127),
      offsetSec: asset.firstOnsetSec || 0,
      trackId: midiTrackForAsset(asset),
    });
  }
  ui.midiHeldNotes.set(key, { note: msg.note, velocity: msg.velocity, voice });
  renderMidiStatus(
    `${midiNoteName(msg.note)} · vel ${msg.velocity} · ${asset.name}${ui.midiRecord ? " · REC" : ""}`,
    "ok"
  );
  if (ui.midiRecord) captureMidiNoteOn(key, msg);
  drawPianoRollCanvas();
}

function midiStopNote(msg) {
  const key = `${msg.channel}:${msg.note}`;
  const held = ui.midiHeldNotes.get(key);
  if (held) {
    if (held.voice) held.voice.stop(0.045);
    ui.midiHeldNotes.delete(key);
    renderMidiStatus(`Note off · ${midiNoteName(msg.note)}`, "ok");
  }
  if (ui.midiRecord) captureMidiNoteOff(key);
  if (held) drawPianoRollCanvas();
}

/** Program change (0xCn) selects a channel — the same row the Piano Roll header names. */
function midiProgramChange(msg) {
  const list = Array.from(assets.values()).filter((a) => !a.renderOf);
  if (list.length === 0) return;
  const asset = list[msg.program % list.length];
  if (!asset) return;
  ui.activeAssetId = asset.id;
  renderChannelRack();
  drawPianoRollCanvas();
  setStatus(`MIDI program ${msg.program + 1} → channel "${asset.name}"`);
}

/* ---------- record mode: incoming notes into the active pattern ---------- */

function midiRecordGridSteps() {
  // The pattern grid is 16 sixteenth-steps. Snap finer than a 16th (or Off) records at a 16th.
  return Math.max(1, Math.round((ui.snapBeats || 0.25) * 4));
}

/** Position in sixteenth-steps: transport playhead while playing, time since Rec otherwise. */
function midiAbsStep() {
  if (engine.isPlaying) return engine.getPlayheadBeat(project) * 4;
  if (!ui.midiRecord) return 0;
  const elapsedSec = (performance.now() - ui.midiRecord.startedAtMs) / 1000;
  return elapsedSec * (project.bpm / 60) * 4;
}

const wrapPatternStep = (step) => ((Math.round(step) % 16) + 16) % 16;

function captureMidiNoteOn(key, msg) {
  const grid = midiRecordGridSteps();
  const absStep = midiAbsStep();
  const quantized = Math.round(absStep / grid) * grid;
  const startStep = wrapPatternStep(quantized);
  const semi = msg.note - 72;
  let row = PR_ROWS.findIndex((r) => r.semi === semi);
  if (row < 0) {
    // Outside the 17 visible keys: clamp to the nearest row so nothing is lost silently.
    row = Math.max(0, Math.min(PR_ROWS.length - 1, Math.round((76 - msg.note) / 1)));
    row = PR_ROWS.findIndex((r) => r.semi === msg.note - 72);
    if (row < 0) row = 4;
  }
  midiPendingNotes.set(key, {
    absStartStep: absStep,
    startStep: Math.min(15, startStep),
    row,
    vel: Math.max(0.1, Math.min(1, msg.velocity / 127)),
    label: PR_ROWS[row].note,
  });
}

function captureMidiNoteOff(key) {
  const pending = midiPendingNotes.get(key);
  if (!pending) return;
  midiPendingNotes.delete(key);
  const grid = midiRecordGridSteps();
  const absEnd = midiAbsStep();
  const rawLen = Math.max(grid, Math.round((absEnd - pending.absStartStep) / grid) * grid);
  const lenSteps = Math.max(1, Math.min(16 - pending.startStep, rawLen));
  const pat = getActivePattern();
  const note = {
    id: nextId("prn"),
    row: pending.row,
    startStep: pending.startStep,
    lenSteps,
    vel: Number(pending.vel.toFixed(3)),
    label: pending.label,
  };
  pat.notes.push(note);
  if (ui.midiRecord) ui.midiRecord.added += 1;
  renderMidiStatus(
    `REC · ${midiNoteName(72 + PR_ROWS[note.row].semi)} at step ${note.startStep + 1} · ${ui.midiRecord?.added || 0} note(s)`,
    "rec"
  );
  drawPianoRollCanvas();
}

function startMidiRecording() {
  if (!midiInput.enabled) return;
  pushUndoState(); // one undo step for the whole take
  ui.midiRecord = { startedAtMs: performance.now(), added: 0 };
  midiPendingNotes.clear();
  if (dom.midiBar) dom.midiBar.classList.add("is-recording");
  if (dom.btnMidiRecord) dom.btnMidiRecord.setAttribute("aria-pressed", "true");
  renderMidiStatus(
    engine.isPlaying
      ? "Recording into the active pattern at the transport playhead…"
      : "Recording into the active pattern — press keys (16-step grid). Press Rec again to stop.",
    "rec"
  );
  drawPianoRollCanvas();
}

function stopMidiRecording() {
  const take = ui.midiRecord;
  ui.midiRecord = null;
  midiPendingNotes.clear();
  if (dom.midiBar) dom.midiBar.classList.remove("is-recording");
  if (dom.btnMidiRecord) dom.btnMidiRecord.setAttribute("aria-pressed", "false");
  const added = take?.added || 0;
  renderMidiStatus(
    added > 0 ? `Recorded ${added} note(s) into "${getActivePattern().name}" · song undo has one step` : "Recording stopped — no notes captured",
    added > 0 ? "ok" : "warn"
  );
  if (added > 0) setStatus(`Recorded ${added} MIDI note(s) into "${getActivePattern().name}"`);
  drawPianoRollCanvas();
}

function toggleMidiRecording() {
  if (ui.midiRecord) stopMidiRecording();
  else startMidiRecording();
}

async function toggleMidiInput() {
  if (midiInput.enabled) {
    midiInput.disable();
    engine.panicLiveVoices();
    ui.midiHeldNotes.clear();
    if (ui.midiRecord) stopMidiRecording();
    syncMidiControls();
    drawPianoRollCanvas();
    return;
  }
  renderMidiStatus("Requesting MIDI access…", "warn");
  const res = await midiInput.enable();
  syncMidiControls();
  // enable() already wrote the specific, actionable line (denied / error / unsupported);
  // re-writing a generic one here would hide it.
  if (!res.ok) syncMidiControls();
}

function setupMidiInput() {
  if (dom.btnMidiEnable) {
    if (!midiInput.supported) {
      // One clear line, no dead controls pretending to work.
      dom.btnMidiEnable.disabled = true;
      dom.btnMidiEnable.title =
        "Web MIDI is available in Chromium and Edge only. Firefox and Safari have no Web MIDI API — use Play Notes or the Ctrl+T typing keyboard.";
      renderMidiStatus(
        "Web MIDI is not available in this browser (Chromium/Edge only). Use Play Notes, click the piano keys, or Ctrl+T to type notes.",
        "warn"
      );
      if (dom.midiDeviceSelect) dom.midiDeviceSelect.disabled = true;
      if (dom.midiChannelSelect) dom.midiChannelSelect.disabled = true;
      if (dom.btnMidiRecord) dom.btnMidiRecord.disabled = true;
    } else {
      dom.btnMidiEnable.addEventListener("click", toggleMidiInput);
      renderMidiStatus("MIDI off — click Enable MIDI to connect a keyboard.", "off");
    }
  }
  if (dom.midiDeviceSelect) {
    dom.midiDeviceSelect.addEventListener("change", () => {
      midiInput.setSelected(dom.midiDeviceSelect.value || null);
      renderMidiStatus(
        midiInput.selectedId
          ? `Listening · ${midiInput.devices.find((d) => d.id === midiInput.selectedId)?.name || "MIDI input"}`
          : "MIDI on · no device connected.",
        midiInput.selectedId ? "ok" : "warn"
      );
    });
  }
  if (dom.midiChannelSelect) {
    dom.midiChannelSelect.addEventListener("change", () => {
      const v = dom.midiChannelSelect.value;
      midiInput.setChannelFilter(v === "all" ? null : Number(v) - 1);
      renderMidiStatus(v === "all" ? "Listening to all MIDI channels" : `Listening to MIDI channel ${v}`, "ok");
    });
    for (let ch = 1; ch <= 16; ch++) {
      const opt = document.createElement("option");
      opt.value = String(ch);
      opt.textContent = String(ch);
      dom.midiChannelSelect.appendChild(opt);
    }
  }
  if (dom.btnMidiRecord) dom.btnMidiRecord.addEventListener("click", toggleMidiRecording);

  // Devices can appear or disappear while the window is closed; keep the chip honest.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && midiInput.enabled) midiInput.refreshDevices();
  });
  syncMidiControls();
}


/**
 * MIDI FILE IMPORT / EXPORT (Standard MIDI Files, SMF)
 *
 * Import: a .mid/.midi file becomes one Audius track per SMF track/channel
 * that carries notes, and one 16-step pattern per bar. Notes are quantized to
 * the pattern's 16th-note grid; every note keeps its MIDI number, so export is
 * exact even when the pitch sits outside the roll's visible C4-E5 range.
 *
 * Export: SMF format 1. The conductor track holds the project name and BPM;
 * each Audius track (or, for patterns that were never attached to a track,
 * each pattern) becomes one SMF track at 480 ticks per beat. Audio clips are
 * audio, not MIDI, so they are not exported — the export dialog says so.
 */

/** How many patterns one import may create; a full song would otherwise flood the PAT list. */
const MIDI_IMPORT_PATTERN_CAP = 400;

function isMidiFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".mid") || name.endsWith(".midi")) return true;
  const type = String(file.type || "").toLowerCase();
  return type === "audio/midi" || type === "audio/x-midi" || type === "application/x-midi";
}

/** Pattern notes -> SMF note events, bar-relative steps lifted to the song timeline. */
function patternNotesToSmf(pat) {
  const bar = Number.isFinite(pat.barIndex) ? Math.max(0, pat.barIndex) : 0;
  const ticksPerStep = MIDI_PPQ / 4;
  return (pat.notes || []).map((n) => ({
    tick: Math.round((bar * 16 + (n.startStep || 0)) * ticksPerStep),
    midi: noteMidi(n),
    velocity: Math.max(0.05, Math.min(1, n.vel ?? 0.85)),
    durationTicks: Math.max(1, Math.round((n.lenSteps || 1) * ticksPerStep)),
  }));
}

/**
 * Builds the SMF payload from the project. Groups imported patterns by their
 * track; patterns with no track become their own track named after the
 * pattern (that is the demo project's shape, and keeps hand-made patterns).
 */
function projectToMidiSong() {
  const groups = new Map(); // key -> { name, channel, notes }
  const trackById = new Map(project.tracks.map((t, i) => [t.id, { track: t, index: i }]));

  for (const pat of ui.patterns) {
    if (!pat || !Array.isArray(pat.notes) || pat.notes.length === 0) continue;
    const notes = patternNotesToSmf(pat);
    if (notes.length === 0) continue;
    if (pat.trackId && trackById.has(pat.trackId)) {
      if (!groups.has(pat.trackId)) {
        const { track, index } = trackById.get(pat.trackId);
        groups.set(pat.trackId, {
          key: pat.trackId,
          name: track.name.replace(/^\d+\s*·\s*/, ""),
          channel: index % 16,
          notes: [],
        });
      }
      groups.get(pat.trackId).notes.push(...notes);
    } else {
      groups.set(`pattern:${pat.name}:${groups.size}`, {
        key: `pattern:${pat.name}`,
        name: pat.name.split("—")[0].trim() || "Pattern",
        channel: groups.size % 16,
        notes,
      });
    }
  }

  const tracks = Array.from(groups.values()).map((g) => ({
    name: g.name,
    channel: g.channel,
    notes: g.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi),
  }));

  return {
    name: project.name || "Audius Studio Session",
    bpm: project.bpm,
    tracks,
    noteCount: tracks.reduce((n, t) => n + t.notes.length, 0),
  };
}

function exportMidiFile() {
  const song = projectToMidiSong();
  if (song.noteCount === 0) {
    setStatus("Nothing to export as MIDI: the project has no Piano Roll or Step Rack notes", { kind: "error" });
    if (dom.exportStatus) dom.exportStatus.textContent = "No notes to export — audio clips are audio, not MIDI.";
    return;
  }
  // Date-free filename; safeFileName strips characters the download attribute drops.
  const bytes = buildSmf(song);
  const blob = new Blob([bytes], { type: "audio/midi" });
  triggerDownload(blob, `${safeFileName(project.name)}.mid`);
  const fileLabel = `${safeFileName(project.name)}.mid`;
  const plural = song.tracks.length === 1 ? "" : "s";
  setStatus(`Exported MIDI: ${song.noteCount} note${song.noteCount === 1 ? "" : "s"} in ${song.tracks.length} track${plural} → ${fileLabel}`);
  if (dom.exportStatus) {
    dom.exportStatus.textContent = `MIDI exported: ${song.noteCount} notes · ${song.tracks.length} track${plural} · ${(bytes.length / 1024).toFixed(1)} KB.`;
  }
  if (dom.exportMidiHint && song.tracks.length < project.tracks.length) {
    dom.exportMidiHint.textContent = `Format 1 · ${project.tracks.length - song.tracks.length} track(s) have no notes and were skipped (audio clips are audio, not MIDI)`;
  }
}

/** Applies one parsed SMF: tracks, patterns and (when present) the tempo. */
function importParsedSmf(parsed, fileLabel) {
  const mapping = smfToParts(parsed);
  const notes = mapping.totalNotes;
  if (mapping.parts.length === 0 || notes === 0) {
    const why = parsed.warnings.find((w) => /header only|no readable/i.test(w));
    setStatus(`${fileLabel}: no notes found${why ? ` — ${why}` : ""}`, { kind: "error" });
    return { tracks: 0, notes: 0, patterns: 0 };
  }

  pushUndoState();
  const warnings = [...parsed.warnings, ...mapping.warnings];

  // Tempo: the file's first tempo wins, inside the app's 20-260 range.
  let tempoNote = "";
  if (parsed.bpm) {
    const next = Math.max(20, Math.min(260, Math.round(parsed.bpm)));
    if (next !== project.bpm) {
      project.bpm = next;
      syncPatternSelect();
      tempoNote = ` · tempo ${next} BPM from the file`;
    }
  }

  let createdTracks = 0;
  let createdPatterns = 0;
  let notesPlaced = 0;
  let skippedBars = 0;
  let skippedParts = 0;
  let firstPatternIndex = -1;

  for (const part of mapping.parts) {
    if (createdPatterns >= MIDI_IMPORT_PATTERN_CAP) {
      skippedParts += 1;
      continue;
    }
    const idx = project.tracks.length + 1;
    const color = PALETTE[(idx - 1) % PALETTE.length];
    const track = {
      id: nextId("trk"),
      name: `${idx} · ${part.name}`.slice(0, 120),
      color,
      muted: false,
      solo: false,
      volumeDb: 0,
      pan: 0,
      eqLowDb: 0,
      eqMidDb: 0,
      eqHighDb: 0,
    };
    project.tracks.push(track);
    createdTracks += 1;

    let partBars = 0;
    for (const bar of part.bars) {
      if (createdPatterns >= MIDI_IMPORT_PATTERN_CAP) {
        skippedBars += 1;
        continue;
      }
      partBars += 1;
      notesPlaced += bar.notes.length;
      const pattern = {
        name: bar.name.slice(0, 60),
        steps: {},
        notes: bar.notes.map((n) => ({
          id: nextId("prn"),
          row: n.row,
          startStep: n.startStep,
          lenSteps: n.lenSteps,
          vel: n.vel,
          label: n.label,
          midi: n.midi,
        })),
        mix: {},
        trackId: track.id,
        barIndex: bar.barIndex,
      };
      ui.patterns.push(pattern);
      if (firstPatternIndex < 0) firstPatternIndex = ui.patterns.length - 1;
      createdPatterns += 1;
    }

    if (partBars === 0) {
      // The cap hit before this part wrote a single pattern: drop its empty track.
      project.tracks.pop();
      createdTracks -= 1;
      skippedParts += 1;
    }
  }

  if (createdTracks === 0) {
    setStatus(`${fileLabel}: no importable channels`, { kind: "error" });
    return { tracks: 0, notes: 0, patterns: 0 };
  }

  ui.activePatternIndex = firstPatternIndex >= 0 ? firstPatternIndex : Math.min(ui.activePatternIndex, ui.patterns.length - 1);
  if (ui.midiRecord) stopMidiRecording();

  const summary =
    `Imported ${createdTracks} track${createdTracks === 1 ? "" : "s"} · ${notesPlaced} note${notesPlaced === 1 ? "" : "s"} · ` +
    `${createdPatterns} bar pattern${createdPatterns === 1 ? "" : "s"}${tempoNote}`;
  onProjectMutated(summary);
  setStatus(summary);

  // Honest follow-ups: skipped bars/channels, off-grid quantization, folded pitches.
  const extras = [];
  if (skippedBars > 0 || skippedParts > 0) {
    extras.push(
      `${skippedBars} bar(s)${skippedParts ? ` and ${skippedParts} channel(s)` : ""} past the ${MIDI_IMPORT_PATTERN_CAP}-pattern import cap were skipped`
    );
  }
  if (mapping.skippedChannels > 0) extras.push(`${mapping.skippedChannels} channel(s) beyond ${MAX_IMPORT_PARTS} were not imported`);
  if (mapping.offGrid > 0) extras.push(`${mapping.offGrid} note(s) quantized to 1/16`);
  if (parsed.truncated) extras.push("the file was truncated");
  if (extras.length > 0) showStatusToast(extras.join(" · "), "info");
  return { tracks: createdTracks, notes: notesPlaced, patterns: createdPatterns, extras };
}

async function importMidiFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (files.length === 0) return;
  for (const file of files) {
    if (file.size === 0) {
      setStatus(`Skipped "${file.name}": the file is empty`, { kind: "error" });
      continue;
    }
    if (file.size > MAX_MIDI_FILE_BYTES) {
      setStatus(
        `Skipped "${file.name}": ${(file.size / 1048576).toFixed(1)} MB — the MIDI limit is ${Math.round(MAX_MIDI_FILE_BYTES / 1048576)} MB`,
        { kind: "error" }
      );
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSmf(buffer);
      importParsedSmf(parsed, file.name);
    } catch (err) {
      if (err instanceof MidiCodecError) {
        setStatus(`Skipped "${file.name}": ${err.message}`, { kind: "error" });
      } else {
        console.error("MIDI import failed:", err);
        setStatus(`Could not import "${file.name}": ${err.message}`, { kind: "error" });
      }
    }
  }
}

let prPreviewToken = 0;
function playPianoRollPreview() {
  const pat = getActivePattern();
  const activeAsset = assets.get(ui.activeAssetId) || Array.from(assets.values())[0];
  if (!activeAsset) return;
  // A second click invalidates the previous audition's notes.
  const token = ++prPreviewToken;
  const stepSec = 60 / project.bpm / 4;
  for (const n of pat.notes) {
    const semi = noteMidi(n) - 72;
    const startedAt = token;
    setTimeout(() => {
      if (startedAt !== prPreviewToken) return;
      previewAssetOneShot(activeAsset, semi, n.lenSteps * stepSec, n.vel ?? 0.85);
    }, n.startStep * stepSec * 1000);
  }
  setStatus(`Playing Piano Roll pattern (${pat.notes.length} notes) on "${activeAsset.name}"`);
}

function stampPianoRollToPlaylist() {
  const pat = getActivePattern();
  const activeAsset = assets.get(ui.activeAssetId) || Array.from(assets.values())[0];
  if (!activeAsset || pat.notes.length === 0) {
    setStatus("Add notes in the Piano Roll first");
    return;
  }
  pushUndoState();
  const baseBeat = snapBeat(engine.getPlayheadBeat(project));
  const targetTrack =
    project.tracks.find((t) => t.id === ui.selectedTrackId) || project.tracks[3] || project.tracks[0];
  if (activeAsset.instrumentId) {
    // A synth channel renders the whole pattern through the synth into one audio clip.
    const notes = pat.notes.map((n) => ({ startStep: n.startStep, lenSteps: n.lenSteps, midi: noteMidi(n), vel: n.vel }));
    const label = pat.name.split("—")[0].trim();
    setStatus(`Rendering ${notes.length} notes through "${activeAsset.name}"…`);
    instruments
      .renderNotes(activeAsset, notes, { label })
      .then((res) => {
        if (!res) return;
        const track = project.tracks.find((t) => t.id === targetTrack.id) || project.tracks[0];
        const clip = {
          id: nextId("clip"),
          assetId: res.assetId,
          trackId: track.id,
          name: `${activeAsset.name} · ${label}`,
          color: activeAsset.color || "#4ade80",
          startBeat: baseBeat,
          durationBeats: Math.max(0.25, Number((res.durationSec * (project.bpm / 60)).toFixed(3))),
          sourceOffsetSec: 0,
          gainDb: 0,
          pan: 0,
          pitchSemitones: 0,
          fadeInBeats: 0,
          fadeOutBeats: 0.02,
          reverse: false,
          muted: false,
        };
        project.clips.push(clip);
        ui.selectedClipIds = new Set([clip.id]);
        onProjectMutated(`Rendered ${notes.length} notes through "${activeAsset.name}" to Playlist Track "${track.name}"`);
      })
      .catch((err) => setStatus(`Synth render failed: ${err.message}`, { kind: "error" }));
    return;
  }
  const newSel = new Set();
  for (const n of pat.notes) {
    const info = PR_ROWS[n.row] || PR_ROWS[4];
    const clip = {
      id: nextId("clip"),
      assetId: activeAsset.id,
      trackId: targetTrack.id,
      name: `${n.label || info.note} · ${activeAsset.name.split(" ")[0]}`,
      color: "#4ade80",
      startBeat: Number((baseBeat + n.startStep * 0.25).toFixed(4)),
      durationBeats: Number((n.lenSteps * 0.25).toFixed(4)),
      sourceOffsetSec: Number((activeAsset.firstOnsetSec || 0).toFixed(4)),
      gainDb: Number(((n.vel - 0.85) * 18).toFixed(1)),
      pan: 0,
      pitchSemitones: noteMidi(n) - 72,
      fadeInBeats: 0.01,
      fadeOutBeats: 0.02,
      reverse: false,
      muted: false,
    };
    project.clips.push(clip);
    newSel.add(clip.id);
  }
  ui.selectedClipIds = newSel;
  onProjectMutated(`Rendered ${pat.notes.length} Piano Roll notes to Playlist Track "${targetTrack.name}"`);
}

/**
 * Audius Studio MULTI-INSERT MIXER & FX SLOTS WINDOW (F9)
 */
function renderMixerStrips() {
  if (!dom.mixerStripsContainer) return;
  dom.mixerStripsContainer.innerHTML = "";

  // 1. Master Strip ("M")
  const masterStrip = document.createElement("div");
  masterStrip.className = "mixer-strip";
  masterStrip.innerHTML = `
    <div class="mixer-strip-topbar" style="background:var(--accent-amber)"></div>
    <div class="mixer-strip-num">M</div>
    <div class="cr-led on" title="Master Active"></div>
    <div class="mixer-fader-row">
      <div class="mixer-strip-name" title="Master">Master</div>
      <input type="range" class="mixer-v-fader" min="-36" max="6" step="0.5" value="${project.masterVolumeDb ?? 0}" title="Master Fader" aria-label="Master volume fader" />
      <div class="mixer-v-meter"><div class="mixer-v-meter-fill" data-mixer-meter="master"></div></div>
    </div>
    <div class="mixer-db-lbl" id="mixer-master-db">${(project.masterVolumeDb ?? 0).toFixed(1)}dB</div>
  `;
  const mFader = masterStrip.querySelector(".mixer-v-fader");
  const mLbl = masterStrip.querySelector("#mixer-master-db");
  undoOnGesture(mFader);
  mFader.addEventListener("input", () => {
    project.masterVolumeDb = Number(mFader.value);
    setRange(dom.masterVol, project.masterVolumeDb);
    mLbl.textContent = `${project.masterVolumeDb.toFixed(1)}dB`;
    engine.syncTrackNodes(project);
  });
  dom.mixerStripsContainer.appendChild(masterStrip);

  // 2. Insert Strips 1..N (Linked 1:1 with Playlist Tracks + extra inserts up to 10)
  const totalInserts = Math.max(8, project.tracks.length);
  for (let i = 0; i < totalInserts; i++) {
    const trk = project.tracks[i];
    const strip = document.createElement("div");
    strip.className = "mixer-strip" + (trk && trk.id === ui.selectedTrackId ? " selected" : "");
    const color = trk ? trk.color : "#334155";
    const name = trk ? trk.name.replace(/^\d+\s*·\s*/, "") : `Insert ${i + 1}`;
    const vol = trk ? trk.volumeDb ?? 0 : 0;
    const muted = trk ? !!trk.muted : false;

    strip.innerHTML = `
      <div class="mixer-strip-topbar"></div>
      <div class="mixer-strip-num">${i + 1}</div>
      <div class="cr-led ${muted ? "" : "on"}" title="Mute / Unmute Insert ${i + 1}"></div>
      <div class="mixer-fader-row">
        <div class="mixer-strip-name"></div>
        <input type="range" class="mixer-v-fader" min="-36" max="6" step="0.5" value="${vol}" ${trk ? "" : "disabled"} ${trk ? `aria-label="Insert ${i + 1} volume fader, ${trk.name}"` : `aria-label="Empty insert ${i + 1}"`} />
        <div class="mixer-v-meter"><div class="mixer-v-meter-fill" data-mixer-meter="${trk ? trk.id : ""}"></div></div>
      </div>
      <div class="mixer-db-lbl">${vol.toFixed(1)}dB</div>
    `;
    strip.querySelector(".mixer-strip-topbar").style.background = color;
    const nameEl = strip.querySelector(".mixer-strip-name");
    nameEl.textContent = name;
    nameEl.title = name;

    if (trk) {
      strip.addEventListener("click", () => {
        ui.selectedTrackId = trk.id;
        if (dom.fxTrackName) dom.fxTrackName.textContent = trk.name;
        if (dom.mixerSelectedLabel) dom.mixerSelectedLabel.textContent = `Insert ${i + 1} — ${trk.name}`;
        renderTrackHeaders();
        renderMixerStrips();
        updateTrackInspector();
        if (fxUi) fxUi.refresh();
      });

      const led = strip.querySelector(".cr-led");
      led.addEventListener("click", (e) => {
        e.stopPropagation();
        pushUndoState();
        trk.muted = !trk.muted;
        onProjectMutated(`${trk.name} ${trk.muted ? "muted" : "unmuted"}`);
      });

      const fader = strip.querySelector(".mixer-v-fader");
      const dbLbl = strip.querySelector(".mixer-db-lbl");
      undoOnGesture(fader);
      fader.addEventListener("input", (e) => {
        e.stopPropagation();
        trk.volumeDb = Number(fader.value);
        dbLbl.textContent = `${trk.volumeDb.toFixed(1)}dB`;
        engine.syncTrackNodes(project);
        renderTrackHeaders();
      });
    }

    dom.mixerStripsContainer.appendChild(strip);
  }
}

function hexToRgba(hex, alpha) {
  const src = String(hex || "#ff7a45").trim();
  // Theme tokens can arrive as rgb()/rgba() text; take their channels and apply the requested alpha.
  const fn = src.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (fn) return `rgba(${fn[1]}, ${fn[2]}, ${fn[3]}, ${alpha})`;
  const clean = src.replace("#", "");
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(clean)) return src;
  const six = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean.slice(0, 6);
  const num = parseInt(six, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** "#rrggbb" to "r, g, b" for the --*-rgb tint tokens. */
function hexToTriplet(hex) {
  const m = String(hex || "").trim().replace("#", "");
  const six = m.length === 3 ? m.replace(/(.)/g, "$1$1") : m;
  if (!/^[0-9a-f]{6}/i.test(six)) return "";
  const num = parseInt(six.slice(0, 6), 16);
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}

/** Mixes a hex colour toward black (keep = share of the original colour kept). */
function shadeHex(hex, keep) {
  const t = hexToTriplet(hex);
  if (!t) return hex;
  const [r, g, b] = t.split(",").map((v) => Math.round(Number(v) * keep));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function formatBeatBar(beat) {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / 4) + 1;
  const beatInBar = Math.floor(b % 4) + 1;
  const step = Math.floor((b % 1) * 4 + 1);
  return `${String(bar).padStart(3, "0")} : ${String(beatInBar).padStart(2, "0")} : ${String(step).padStart(2, "0")}`;
}

/**
 * Section-marker geometry, shared by the ruler drawing and the pointer
 * hit-test so the × target always matches what is on screen.
 */
function markerGeometry(touch) {
  return touch
    ? { width: 116, height: 44, closeStart: 72, labelWidth: 62, closeX: 76 }
    : { width: 96, height: 20, closeStart: 74, labelWidth: 44, closeX: 78 };
}

function formatSeconds(sec) {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, "0")}:${rem.toFixed(3).padStart(6, "0")}`;
}

/**
 * Hit-testing clips on the Playlist Canvas (with wider touch zones when using touch)
 */
/** The section marker whose flag (or its × zone) contains timeline x. */
function markerAtPoint(localX) {
  if (!Array.isArray(project.markers)) return null;
  for (let i = project.markers.length - 1; i >= 0; i--) {
    const m = project.markers[i];
    const mx = beatToX(m.beat);
    const geo = markerGeometry(false);
    if (localX >= mx && localX <= mx + geo.width) return m;
  }
  return null;
}

function hitTestClip(localX, localY, isTouch = false) {
  if (localY <= ui.rulerHeight) return null;
  const trackIdx = Math.floor((localY - ui.rulerHeight + ui.scrollY) / ui.trackHeight);
  if (trackIdx < 0 || trackIdx >= project.tracks.length) return null;
  const track = project.tracks[trackIdx];
  const edgeZone = isTouch ? 14 : 8;

  for (let i = project.clips.length - 1; i >= 0; i--) {
    const clip = project.clips[i];
    if (clip.trackId !== track.id) continue;
    const x = beatToX(clip.startBeat);
    const w = clip.durationBeats * ui.pixelsPerBeat;
    if (localX >= x && localX <= x + w) {
      const yTop = ui.rulerHeight + trackIdx * ui.trackHeight + 4 - ui.scrollY;
      const relX = localX - x;
      const relY = localY - yTop;
      let zone = "body";
      // Touch hit zones match the 44px buttons drawn on touch-first screens.
      const headerButtons = clipHeaderButtons(clip, w, isTouch);
      if (isTouch) {
        if (headerButtons.del && relY <= 45 && relX >= w - 44) zone = "delete-btn";
        else if (headerButtons.menu && relY <= 45 && relX >= w - 88 && relX < w - 44) zone = "menu-btn";
      } else {
        if (headerButtons.del && relY <= 18 && relX >= w - 18) zone = "delete-btn";
        else if (headerButtons.menu && relY <= 18 && relX >= w - 34 && relX < w - 18) zone = "menu-btn";
      }
      if (zone === "body" && relY <= 16 && relX <= 12) zone = "fade-in";
      else if (zone === "body" && relY <= 16 && relX >= w - 12 && w < 28) zone = "fade-out";
      else if (zone === "body" && relX <= edgeZone && w > edgeZone * 2.5) zone = "trim-left";
      else if (zone === "body" && relX >= w - edgeZone && w > edgeZone * 2.5) zone = "trim-right";
      return { clip, trackIdx, zone };
    }
  }
  return null;
}

/**
 * Pointer / Mouse & Multi-Touch Interactions on the Playlist Canvas
 */
function setupPlaylistInteractions() {
  const canvas = dom.playlistCanvas;

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTestClip(x, y, e.pointerType === "touch");

    // Touch: a long press opens the clip's action menu (right-click is
    // reserved for the mouse, where it deletes with one click).
    if (isTouchContextMenu(e)) {
      if (hit) {
        ui.selectedClipIds.clear();
        ui.selectedClipIds.add(hit.clip.id);
        updateClipInspector();
        drawAllCanvases();
        openClipContextMenu(hit.clip, e.clientX, e.clientY);
      }
      return;
    }

    if (hit) {
      pushUndoState();
      project.clips = project.clips.filter((c) => c.id !== hit.clip.id);
      ui.selectedClipIds.delete(hit.clip.id);
      onProjectMutated(`Deleted "${hit.clip.name}"`);
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Middle-mouse button drag -> Audius Studio Pan Timeline
    if (e.button === 1) {
      e.preventDefault();
      ui.dragState = {
        mode: "pan-scroll",
        startX: x,
        startY: y,
        origScrollBeat: ui.scrollBeat,
        origScrollY: ui.scrollY,
        moved: true,
        tapBeat: 0,
      };
      return;
    }

    ui.activePointers.set(e.pointerId, { x, y });
    updateTouchBadge();
    canvasTip.hide();

    // 2-Finger Multi-Touch Pinch-to-Zoom & 2-Finger Pan
    if (ui.activePointers.size === 2) {
      const pts = Array.from(ui.activePointers.values());
      const dist = Math.max(20, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      ui.dragState = null;
      ui.pinchState = {
        startDist: dist,
        startPpb: ui.pixelsPerBeat,
        anchorBeat: xToBeat(midX),
        startMidY: midY,
        startScrollY: ui.scrollY,
        startTime: performance.now(),
        moved: false,
      };
      return;
    }

    const rawBeat = Math.max(0, xToBeat(x));
    const snapped = snapBeat(rawBeat, e.altKey);

    // Close floating clip context menu when clicking elsewhere on canvas
    if (dom.clipContextMenu && !dom.clipContextMenu.hidden) {
      dom.clipContextMenu.hidden = true;
    }

    // 1. Clicking / dragging in the Top Ruler -> Delete Marker, Scrub Playhead, or Loop Handles
    if (y <= ui.rulerHeight) {
      const touchMarker = e.pointerType === "touch";
      const marker = markerGeometry(touchMarker);
      // The × zone spans the full ruler height on touch so it is a real
      // 44px target; on desktop it is the flag's lower band.
      const markerZoneH = touchMarker ? 44 : marker.height;
      if (y <= markerZoneH && Array.isArray(project.markers)) {
        for (let i = project.markers.length - 1; i >= 0; i--) {
          const m = project.markers[i];
          const mx = beatToX(m.beat);
          if (x >= mx + marker.closeStart && x <= mx + marker.width) {
            pushUndoState();
            project.markers.splice(i, 1);
            onProjectMutated(`Removed marker "${m.name}"`);
            return;
          }
        }
      }
      const lx0 = beatToX(project.loopStartBeat);
      const lx1 = beatToX(project.loopEndBeat);
      const loopGrab = touchMarker ? 16 : 10;
      const loopZoneH = touchMarker ? 44 : 15;
      if (y <= loopZoneH && Math.abs(x - lx0) <= loopGrab) {
        pushUndoState();
        ui.dragState = { mode: "loop-start" };
      } else if (y <= loopZoneH && Math.abs(x - lx1) <= loopGrab) {
        pushUndoState();
        ui.dragState = { mode: "loop-end" };
      } else {
        ui.dragState = { mode: "scrub" };
        engine.seek(project, assets, snapped);
        drawAllCanvases();
      }
      return;
    }

    // Pan tool -> 1-finger scroll
    if (ui.tool === "pan") {
      ui.dragState = {
        mode: "pan-scroll",
        startX: x,
        startY: y,
        origScrollBeat: ui.scrollBeat,
        origScrollY: ui.scrollY,
        moved: false,
        tapBeat: snapped,
      };
      return;
    }

    // A malformed project file could arrive with no tracks; never index one.
    if (project.tracks.length === 0) return;

    const hit = hitTestClip(x, y, e.pointerType === "touch");
    const trackIdx = Math.max(
      0,
      Math.min(
        project.tracks.length - 1,
        Math.floor((y - ui.rulerHeight + ui.scrollY) / ui.trackHeight)
      )
    );
    ui.selectedTrackId = project.tracks[trackIdx].id;
    renderTrackHeaders();
    updateTrackInspector();

    // Direct 1-tap "×" delete button on any clip header
    if (hit && hit.zone === "delete-btn") {
      pushUndoState();
      project.clips = project.clips.filter((c) => c.id !== hit.clip.id);
      ui.selectedClipIds.delete(hit.clip.id);
      onProjectMutated(`Deleted "${hit.clip.name}"`);
      return;
    }

    // Direct 1-tap "⋯" Clip Actions Menu button on clip header
    if (hit && hit.zone === "menu-btn") {
      ui.selectedClipIds.clear();
      ui.selectedClipIds.add(hit.clip.id);
      ui.contextClipId = hit.clip.id;
      ui.contextBeat = rawBeat;
      updateClipInspector();
      drawAllCanvases();
      openClipContextMenu(hit.clip, e.clientX, e.clientY);
      return;
    }

    // 2. Active Tool: SLICE (Razor Cut — Tap or Swipe across tracks)
    if (ui.tool === "slice") {
      ui.dragState = { mode: "razor-swipe", lastClipId: null };
      if (hit) {
        ui.dragState.lastClipId = hit.clip.id;
        sliceClipAtPointer(hit.clip, rawBeat, e.altKey);
      }
      return;
    }

    // 3. Active Tool: DELETE (Erase — click or drag across clips like Audius Studio)
    if (ui.tool === "delete") {
      pushUndoState();
      ui.dragState = { mode: "erase-swipe" };
      if (hit) {
        project.clips = project.clips.filter((c) => c.id !== hit.clip.id);
        ui.selectedClipIds.delete(hit.clip.id);
        onProjectMutated(`Erased "${hit.clip.name}"`);
      }
      return;
    }

    // 3b. Active Tool: PAINT BRUSH (Audius Studio "B" Tool — drag horizontally to paint repeating clips)
    if (ui.tool === "paint") {
      if (hit && hit.zone !== "body") {
        // Allow edge trim even in paint mode
      } else if (!hit) {
        const assetId = ui.activeAssetId || assets.keys().next().value;
        const asset = assets.get(assetId);
        if (asset) {
          pushUndoState();
          const durBeats = Math.max(0.5, Number((asset.durationSec * (project.bpm / 60)).toFixed(3)));
          const firstStart = snapped;
          const painted = createPaintedClip(asset, project.tracks[trackIdx], firstStart, durBeats);
          project.clips.push(painted);
          ui.selectedClipIds.clear();
          ui.selectedClipIds.add(painted.id);
          ui.dragState = {
            mode: "paint-brush",
            asset,
            durBeats,
            lastPaintEnd: firstStart + durBeats,
            lastPaintStart: firstStart,
          };
          onProjectMutated(`Painted "${painted.name}" (drag horizontally to repeat)`);
        }
        return;
      }
    }

    // 4. Active Tool: MUTE
    if (ui.tool === "mute") {
      if (hit) {
        pushUndoState();
        hit.clip.muted = !hit.clip.muted;
        onProjectMutated(`${hit.clip.muted ? "Muted" : "Unmuted"} "${hit.clip.name}"`);
      }
      return;
    }

    // 5. Active Tool: SELECT (Marquee Box)
    if (ui.tool === "select" || (!hit && e.shiftKey)) {
      if (!e.shiftKey) ui.selectedClipIds.clear();
      ui.dragState = { mode: "marquee", x0: x, y0: y, x1: x, y1: y };
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    // 6. Active Tool: SLIP (Slide waveform content inside clip)
    if (ui.tool === "slip" && hit) {
      pushUndoState();
      ui.selectedClipIds.clear();
      ui.selectedClipIds.add(hit.clip.id);
      ui.dragState = {
        mode: "slip",
        clip: hit.clip,
        startX: x,
        origOffsetSec: hit.clip.sourceOffsetSec || 0,
      };
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    // 7. Active Tool: DRAW / MOVE / TRIM / FADE (with Audius Studio Shift+Drag to Clone!)
    if (hit) {
      const clip = hit.clip;
      if (!ui.selectedClipIds.has(clip.id)) {
        ui.selectedClipIds.clear();
        ui.selectedClipIds.add(clip.id);
      }
      updateClipInspector();
      drawAllCanvases();

      pushUndoState();
      if (hit.zone === "trim-left") {
        ui.dragState = {
          mode: "trim-left",
          clip,
          origStartBeat: clip.startBeat,
          origDurBeats: clip.durationBeats,
          origOffsetSec: clip.sourceOffsetSec || 0,
        };
      } else if (hit.zone === "trim-right") {
        ui.dragState = {
          mode: "trim-right",
          clip,
          origStartBeat: clip.startBeat,
          origDurBeats: clip.durationBeats,
        };
      } else if (hit.zone === "fade-in") {
        ui.dragState = { mode: "fade-in", clip };
      } else if (hit.zone === "fade-out") {
        ui.dragState = { mode: "fade-out", clip };
      } else {
        let movingClips = project.clips.filter((c) => ui.selectedClipIds.has(c.id));
        // Audius Studio Shift + Drag on clip body -> Clone selected clip(s) and drag the clones!
        if (e.shiftKey) {
          const clones = movingClips.map((c) => ({
            ...c,
            id: nextId("clip"),
          }));
          project.clips.push(...clones);
          ui.selectedClipIds = new Set(clones.map((c) => c.id));
          movingClips = clones;
          setStatus(`Cloned ${clones.length} clip(s)`);
        }
        ui.dragState = {
          mode: "move",
          anchorBeat: rawBeat,
          anchorTrackIdx: trackIdx,
          snapshots: movingClips.map((c) => ({
            clip: c,
            origStartBeat: c.startBeat,
            origTrackIdx: project.tracks.findIndex((t) => t.id === c.trackId),
          })),
        };
      }
    } else {
      const now = performance.now();
      const isDoubleTap =
        now - ui.lastTapTime < 340 &&
        Math.hypot(x - ui.lastTapX, y - ui.lastTapY) < 28;
      ui.lastTapTime = now;
      ui.lastTapX = x;
      ui.lastTapY = y;

      if (isDoubleTap && ui.activeAssetId && assets.has(ui.activeAssetId)) {
        addAssetClipToPlaylist(ui.activeAssetId, project.tracks[trackIdx].id, snapped);
        return;
      }

      ui.selectedClipIds.clear();
      updateClipInspector();
      if (e.pointerType === "touch") {
        ui.dragState = {
          mode: "pan-scroll",
          startX: x,
          startY: y,
          origScrollBeat: ui.scrollBeat,
          origScrollY: ui.scrollY,
          moved: false,
          tapBeat: snapped,
        };
      } else {
        engine.seek(project, assets, snapped);
      }
      drawAllCanvases();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (ui.activePointers.has(e.pointerId)) {
      ui.activePointers.set(e.pointerId, { x, y });
    }

    // Handle 2-finger pinch-zoom & pan
    if (ui.pinchState && ui.activePointers.size >= 2) {
      const pts = Array.from(ui.activePointers.values());
      const dist = Math.max(20, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      if (
        Math.abs(dist - ui.pinchState.startDist) > 6 ||
        Math.abs(midY - ui.pinchState.startMidY) > 6
      ) {
        ui.pinchState.moved = true;
      }
      const scale = dist / ui.pinchState.startDist;
      ui.pixelsPerBeat = Math.max(18, Math.min(160, Math.round(ui.pinchState.startPpb * scale)));
      setRange(dom.zoomSlider, ui.pixelsPerBeat);
      savePrefs();
      ui.scrollBeat = Math.max(0, ui.pinchState.anchorBeat - midX / ui.pixelsPerBeat);
      setRange(dom.hscrollSlider, ui.scrollBeat);

      const dy = midY - ui.pinchState.startMidY;
      const maxScrollY = Math.max(
        0,
        project.tracks.length * ui.trackHeight - (canvas.clientHeight - ui.rulerHeight) + 20
      );
      ui.scrollY = Math.max(0, Math.min(maxScrollY, ui.pinchState.startScrollY - dy));
      renderTrackHeaders();
      drawAllCanvases();
      return;
    }

    const rawBeat = Math.max(0, xToBeat(x));
    const snapped = snapBeat(rawBeat, e.altKey);

    ui.hoverBeat = snapped;
    const hit = hitTestClip(x, y, e.pointerType === "touch");
    ui.hoverClipId = hit ? hit.clip.id : null;

    const barNum = Math.floor(snapped / 4) + 1;
    const beatInBar = (snapped % 4) + 1;
    setCursorInfo(barNum, beatInBar);

    if (!ui.dragState) {
      if (y <= ui.rulerHeight) {
        canvas.style.cursor = "ew-resize";
      } else if (ui.tool === "slice") {
        canvas.style.cursor = "crosshair";
      } else if (hit) {
        if (hit.zone === "trim-left" || hit.zone === "trim-right") canvas.style.cursor = "ew-resize";
        else if (hit.zone === "fade-in" || hit.zone === "fade-out") canvas.style.cursor = "nesw-resize";
        else canvas.style.cursor = "grab";
      } else {
        canvas.style.cursor = "default";
      }
      if (ui.tool === "slice") drawPlaylistCanvas();

      // Full names for canvas-only text: a hovered clip or marker shows its
      // untruncated name in the same tooltip bubble every other control uses.
      if (e.pointerType !== "touch") {
        if (hit) {
          const c = hit.clip;
          const flags = [];
          if (c.muted) flags.push("muted");
          if (c.reverse) flags.push("reversed");
          if (c.pitchSemitones) flags.push(`${c.pitchSemitones > 0 ? "+" : ""}${c.pitchSemitones} st`);
          canvasTip.show(
            e.clientX,
            e.clientY,
            `${c.name}\nBar ${Math.floor(c.startBeat / 4) + 1} · ${c.durationBeats} beats${c.gainDb ? ` · ${c.gainDb.toFixed(1)} dB` : ""}${flags.length ? ` · ${flags.join(", ")}` : ""}`
          );
        } else if (y <= ui.rulerHeight) {
          const marker = markerAtPoint(x);
          if (marker) {
            canvasTip.show(e.clientX, e.clientY, `${marker.name || "Section marker"} — Bar ${Math.floor(marker.beat / 4) + 1}`);
          } else {
            canvasTip.hide();
          }
        } else {
          canvasTip.hide();
        }
      }
      return;
    }

    const st = ui.dragState;
    const secPerBeat = 60 / project.bpm;

    if (st.mode === "razor-swipe") {
      if (hit && hit.clip.id !== st.lastClipId) {
        st.lastClipId = hit.clip.id;
        sliceClipAtPointer(hit.clip, rawBeat, e.altKey);
      }
      return;
    }

    if (st.mode === "erase-swipe") {
      if (hit) {
        project.clips = project.clips.filter((c) => c.id !== hit.clip.id);
        ui.selectedClipIds.delete(hit.clip.id);
        onProjectMutated(`Erased "${hit.clip.name}"`);
      }
      return;
    }

    if (st.mode === "paint-brush") {
      const curTrackIdx = Math.max(
        0,
        Math.min(
          project.tracks.length - 1,
          Math.floor((y - ui.rulerHeight + ui.scrollY) / ui.trackHeight)
        )
      );
      const trk = project.tracks[curTrackIdx];
      if (rawBeat >= st.lastPaintEnd - 0.05) {
        const nextStart = st.lastPaintEnd;
        const painted = createPaintedClip(st.asset, trk, nextStart, st.durBeats);
        project.clips.push(painted);
        ui.selectedClipIds.add(painted.id);
        st.lastPaintEnd = nextStart + st.durBeats;
        drawAllCanvases();
      }
      return;
    }

    if (st.mode === "pan-scroll") {
      const dx = x - st.startX;
      const dy = y - st.startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) st.moved = true;
      if (st.moved) {
        ui.scrollBeat = Math.max(0, st.origScrollBeat - dx / ui.pixelsPerBeat);
        setRange(dom.hscrollSlider, ui.scrollBeat);
        const maxScrollY = Math.max(
          0,
          project.tracks.length * ui.trackHeight - (canvas.clientHeight - ui.rulerHeight) + 20
        );
        ui.scrollY = Math.max(0, Math.min(maxScrollY, st.origScrollY - dy));
        renderTrackHeaders();
        drawAllCanvases();
      }
      return;
    }

    if (st.mode === "scrub") {
      engine.seek(project, assets, snapped);
      drawAllCanvases();
      return;
    }

    if (st.mode === "loop-start") {
      project.loopStartBeat = Math.max(0, Math.min(project.loopEndBeat - 1, snapped));
      drawAllCanvases();
      return;
    }

    if (st.mode === "loop-end") {
      project.loopEndBeat = Math.max(project.loopStartBeat + 1, snapped);
      drawAllCanvases();
      return;
    }

    if (st.mode === "marquee") {
      st.x1 = x;
      st.y1 = y;
      const rx0 = Math.min(st.x0, st.x1);
      const rx1 = Math.max(st.x0, st.x1);
      const ry0 = Math.min(st.y0, st.y1);
      const ry1 = Math.max(st.y0, st.y1);

      ui.selectedClipIds.clear();
      for (const c of project.clips) {
        const tIdx = project.tracks.findIndex((t) => t.id === c.trackId);
        if (tIdx === -1) continue;
        const cx0 = beatToX(c.startBeat);
        const cx1 = cx0 + c.durationBeats * ui.pixelsPerBeat;
        const cy0 = ui.rulerHeight + tIdx * ui.trackHeight + 4 - ui.scrollY;
        const cy1 = cy0 + ui.trackHeight - 8;
        if (cx1 >= rx0 && cx0 <= rx1 && cy1 >= ry0 && cy0 <= ry1) {
          ui.selectedClipIds.add(c.id);
        }
      }
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    if (st.mode === "move") {
      const deltaBeats = rawBeat - st.anchorBeat;
      const curTrackIdx = Math.floor((y - ui.rulerHeight + ui.scrollY) / ui.trackHeight);
      const deltaTrack = curTrackIdx - st.anchorTrackIdx;

      for (const item of st.snapshots) {
        const targetBeat = snapBeat(item.origStartBeat + deltaBeats, e.altKey);
        item.clip.startBeat = Math.max(0, targetBeat);
        const nextTrkIdx = Math.max(
          0,
          Math.min(project.tracks.length - 1, item.origTrackIdx + deltaTrack)
        );
        item.clip.trackId = project.tracks[nextTrkIdx].id;
      }
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    if (st.mode === "trim-left") {
      const c = st.clip;
      const origEnd = st.origStartBeat + st.origDurBeats;
      const newStart = Math.min(origEnd - 0.125, Math.max(0, snapped));
      const deltaBeats = newStart - st.origStartBeat;
      const rate = Math.pow(2, (c.pitchSemitones || 0) / 12) * (c.playbackRate || 1);
      const newOffset = st.origOffsetSec + deltaBeats * secPerBeat * rate;
      if (newOffset >= 0) {
        c.startBeat = Number(newStart.toFixed(4));
        c.durationBeats = Number((origEnd - newStart).toFixed(4));
        c.sourceOffsetSec = Number(newOffset.toFixed(4));
      }
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    if (st.mode === "trim-right") {
      const c = st.clip;
      const newEnd = Math.max(c.startBeat + 0.125, snapped);
      c.durationBeats = Number((newEnd - c.startBeat).toFixed(4));
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    if (st.mode === "fade-in") {
      const c = st.clip;
      const relBeats = Math.max(0, Math.min(c.durationBeats * 0.8, rawBeat - c.startBeat));
      c.fadeInBeats = Number(relBeats.toFixed(3));
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    if (st.mode === "fade-out") {
      const c = st.clip;
      const clipEnd = c.startBeat + c.durationBeats;
      const relBeats = Math.max(0, Math.min(c.durationBeats * 0.8, clipEnd - rawBeat));
      c.fadeOutBeats = Number(relBeats.toFixed(3));
      updateClipInspector();
      drawAllCanvases();
      return;
    }

    if (st.mode === "slip") {
      const c = st.clip;
      const asset = assets.get(c.assetId);
      const maxOffset = asset ? Math.max(0, asset.durationSec - 0.05) : 60;
      const deltaSec = ((st.startX - x) / ui.pixelsPerBeat) * secPerBeat;
      c.sourceOffsetSec = Number(
        Math.max(0, Math.min(maxOffset, st.origOffsetSec + deltaSec)).toFixed(4)
      );
      updateClipInspector();
      drawAllCanvases();
      return;
    }
  });

  const endPointer = (e) => {
    ui.activePointers.delete(e.pointerId);
    updateTouchBadge();

    if (ui.pinchState && ui.activePointers.size < 2) {
      if (!ui.pinchState.moved && performance.now() - ui.pinchState.startTime < 240) {
        undo();
      }
      ui.pinchState = null;
    }

    if (ui.activePointers.size === 0 && ui.dragState) {
      if (ui.dragState.mode === "pan-scroll" && !ui.dragState.moved) {
        engine.seek(project, assets, ui.dragState.tapBeat);
      } else if (engine.isPlaying && ui.dragState.mode !== "scrub") {
        engine.play(project, assets, engine.getPlayheadBeat(project));
      }
      ui.dragState = null;
      drawAllCanvases();
    }
  };

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  // Mouse Wheel: Ctrl+Wheel = Horizontal Zoom, Alt+Wheel = Vertical Track Height Zoom, Plain Wheel = Scroll
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.altKey) {
        const delta = e.deltaY < 0 ? 6 : -6;
        ui.trackHeight = Math.max(48, Math.min(130, ui.trackHeight + delta));
        renderTrackHeaders();
        drawAllCanvases();
        setStatus(`Track height: ${ui.trackHeight}px`);
        savePrefs();
      } else if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        ui.pixelsPerBeat = Math.max(18, Math.min(160, Math.round(ui.pixelsPerBeat * factor)));
        setRange(dom.zoomSlider, ui.pixelsPerBeat);
        drawAllCanvases();
        savePrefs();
      } else {
        const deltaBeats = (e.deltaX !== 0 ? e.deltaX : e.deltaY) / ui.pixelsPerBeat;
        ui.scrollBeat = Math.max(0, ui.scrollBeat + deltaBeats * 0.65);
        setRange(dom.hscrollSlider, ui.scrollBeat);
        drawAllCanvases();
      }
    },
    { passive: false }
  );

  // Drag & Drop from Left Audio Pool or OS File Manager onto Playlist Canvas
  canvas.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  canvas.addEventListener("drop", async (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beat = snapBeat(Math.max(0, xToBeat(x)));
    const trackIdx = Math.max(
      0,
      Math.min(
        project.tracks.length - 1,
        Math.floor((y - ui.rulerHeight + ui.scrollY) / ui.trackHeight)
      )
    );
    const track = project.tracks[trackIdx];

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleAudioFilesImport(e.dataTransfer.files, track.id, beat);
      return;
    }

    const assetId = e.dataTransfer.getData("text/plain");
    if (assetId && assets.has(assetId)) {
      addAssetClipToPlaylist(assetId, track.id, beat);
    }
  });

  // Minimap Click/Drag to Jump Viewport
  const jumpFromMinimap = (e) => {
    const rect = dom.minimapCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const totalBeats = Math.max(
      32,
      project.loopEndBeat + 8,
      ...project.clips.map((c) => c.startBeat + c.durationBeats + 8)
    );
    ui.scrollBeat = Math.max(0, frac * totalBeats - 2);
    setRange(dom.hscrollSlider, ui.scrollBeat);
    drawAllCanvases();
  };

  dom.minimapCanvas.addEventListener("pointerdown", (e) => {
    dom.minimapCanvas.setPointerCapture(e.pointerId);
    jumpFromMinimap(e);
  });
  dom.minimapCanvas.addEventListener("pointermove", (e) => {
    if (e.buttons > 0) jumpFromMinimap(e);
  });
}

// The menu is fixed to the viewport (moved to <body> so no transformed ancestor can trap it),
// placed under the pointer, flipped above it near the bottom edge and clamped inside the screen.
// On compact layouts CSS turns it into a bottom sheet, so no coordinates are set.
function openClipContextMenu(clip, clientX, clientY) {
  const menu = dom.clipContextMenu;
  if (!menu) return;
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  dom.ctxClipTitle.textContent = clip.name;
  menu.style.left = "";
  menu.style.top = "";
  menu.hidden = false;
  if (compactLayoutQuery.matches) return;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left = clientX - w / 2;
  let top = clientY + 14;
  if (top + h > window.innerHeight - 8) top = clientY - h - 14;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function createPaintedClip(asset, track, startBeat, durBeats) {
  return {
    id: nextId("clip"),
    assetId: asset.id,
    trackId: track.id,
    name: asset.name.replace(/\.[^.]+$/, ""),
    color: asset.color || track.color || "#3b82f6",
    startBeat: Number(startBeat.toFixed(4)),
    durationBeats: durBeats,
    sourceOffsetSec: 0,
    gainDb: 0,
    pan: 0,
    pitchSemitones: 0,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    reverse: false,
    muted: false,
  };
}

// Audius Studio 2-Octave Typing Keyboard to Piano Map (key -> [semitoneOffset, noteName])
const FL_PIANO_MAP = {
  // Lower Row (C4 = 0st to E5 = +16st)
  z: [0, "C4"],
  s: [1, "C#4"],
  x: [2, "D4"],
  d: [3, "D#4"],
  c: [4, "E4"],
  v: [5, "F4"],
  g: [6, "F#4"],
  b: [7, "G4"],
  h: [8, "G#4"],
  n: [9, "A4"],
  j: [10, "A#4"],
  m: [11, "B4"],
  ",": [12, "C5"],
  l: [13, "C#5"],
  ".": [14, "D5"],
  ";": [15, "D#5"],
  "/": [16, "E5"],
  // Upper Row (C5 = +12st to E6 = +28st)
  q: [12, "C5"],
  "2": [13, "C#5"],
  w: [14, "D5"],
  "3": [15, "D#5"],
  e: [16, "E5"],
  r: [17, "F5"],
  "5": [18, "F#5"],
  t: [19, "G5"],
  "6": [20, "G#5"],
  y: [21, "A5"],
  "7": [22, "A#5"],
  u: [23, "B5"],
  i: [24, "C6"],
  "9": [25, "C#6"],
  o: [26, "D6"],
  "0": [27, "D#6"],
  p: [28, "E6"],
};

function triggerTypingPianoNote(semitoneOffset, noteName) {
  const assetId = ui.activeAssetId || assets.keys().next().value;
  const asset = assets.get(assetId);
  if (!asset || !asset.buffer) return;

  const ctx = engine.ensureContext();
  const rate = Math.pow(2, (semitoneOffset - 12) / 12);
  const offsetSec = Math.min(Math.max(0, asset.durationSec - 0.05), asset.firstOnsetSec || 0);
  const playDur = Math.max(0.02, Math.min(2.5, (asset.durationSec - offsetSec) / rate));
  const now = ctx.currentTime;
  const relSec = Math.min(0.03, playDur * 0.25);

  const src = ctx.createBufferSource();
  src.buffer = asset.buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(0.85, now + 0.002);
  g.gain.setValueAtTime(0.85, Math.max(now + 0.002, now + playDur - relSec));
  g.gain.exponentialRampToValueAtTime(0.0001, now + playDur);
  src.connect(g);
  g.connect(engine.masterGain);
  src.start(now, offsetSec, playDur + 0.005);
  setStatus(`Typing keyboard: ${noteName} (${semitoneOffset - 12 >= 0 ? "+" : ""}${semitoneOffset - 12} st) · ${asset.name}`);
}

function sliceClipAtPointer(clip, rawBeat, altKey) {
  let cutBeat = snapBeat(rawBeat, altKey);
  if (
    cutBeat <= clip.startBeat + 0.0625 ||
    cutBeat >= clip.startBeat + clip.durationBeats - 0.0625
  ) {
    cutBeat = rawBeat;
  }
  const pair = splitClipAtBeat(clip, cutBeat);
  if (pair) {
    pushUndoState();
    const idx = project.clips.findIndex((c) => c.id === clip.id);
    project.clips.splice(idx, 1, pair[0], pair[1]);
    ui.selectedClipIds.clear();
    ui.selectedClipIds.add(pair[1].id);
    onProjectMutated(`Sliced "${clip.name}" at ${formatBeatBar(cutBeat)}`);
  }
}

function updateTouchBadge() {
  if (!dom.touchCounterBadge) return;
  const n = ui.activePointers.size;
  dom.touchCounterBadge.textContent =
    n > 1 ? `Multi-touch · ${n} fingers` : "Playlist";
}

/**
 * BROWSE AUDIUS (Library folder): search, trending and pasted links from the public Audius API.
 * Any track previews through normal Audius streaming; only tracks and stems their artists made
 * downloadable can be imported, and imports land on new tracks at the playhead like uploads.
 */
function setupAudiusBrowser() {
  const panel = document.getElementById("audius-browser");
  const results = document.getElementById("aud-results");
  const form = document.getElementById("aud-search-form");
  const query = document.getElementById("aud-query");
  const matchTempo = document.getElementById("aud-match-tempo");
  const tempoLabel = document.getElementById("aud-tempo-label");
  const downloadable = document.getElementById("aud-downloadable");
  const trendingBtn = document.getElementById("aud-trending");
  if (!panel || !results || !form) return;

  const libraryParts = [document.getElementById("lib-project")];
  const preview = new Audio();
  preview.preload = "none";
  let previewId = null;
  let previewButton = null;
  let loadedOnce = false;
  let requestSeq = 0;

  const fmtTime = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  function showMessage(text) {
    results.replaceChildren(makeEmptyState(text));
  }

  function setPreviewButton(btn, playing) {
    if (!btn) return;
    btn.innerHTML = icon(playing ? "pause" : "play", { solo: true });
    btn.setAttribute("aria-label", playing ? "Stop preview" : "Preview");
    setLit(btn, playing);
  }

  function stopPreview() {
    preview.pause();
    setPreviewButton(previewButton, false);
    previewId = null;
    previewButton = null;
  }

  preview.addEventListener("ended", stopPreview);
  preview.addEventListener("error", () => {
    if (previewId) setStatus("Audius couldn't stream that preview", { kind: "error" });
    stopPreview();
  });

  function togglePreview(track, btn) {
    if (previewId === track.id) return stopPreview();
    stopPreview();
    previewId = track.id;
    previewButton = btn;
    preview.src = streamUrl(track.id);
    preview.play().then(
      () => setPreviewButton(btn, true),
      () => {
        setStatus("The browser blocked the preview. Tap again to play.", { kind: "error" });
        stopPreview();
      }
    );
  }

  function fileNameFor(title, artist, origName) {
    const ext = (/\.[a-z0-9]{2,4}$/i.exec(origName || "") || [".mp3"])[0];
    return `${title} · ${artist}`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) + ext;
  }

  async function importItems(items, label) {
    setStatus(`Downloading ${label} from Audius…`);
    const files = [];
    for (const item of items) {
      try {
        const bytes = await fetchAudio(downloadUrl(item.id));
        files.push(new File([bytes], fileNameFor(item.title, item.artist, item.origName)));
      } catch (err) {
        setStatus(`${item.title}: ${err.message}`, { kind: "error" });
      }
    }
    if (!files.length) return;
    pushUndoState();
    await handleAudioFilesImport(files);
    setStatus(`Imported ${files.length === 1 ? `"${items[0].title}"` : `${files.length} stems`} from Audius`);
  }

  async function toggleStems(track, row, btn) {
    const open = row.querySelector(".aud-stems");
    if (open) {
      open.remove();
      setLit(btn, false);
      return;
    }
    setLit(btn, true);
    const box = document.createElement("div");
    box.className = "aud-stems";
    box.append(makeEmptyState("Loading stems…"));
    row.append(box);
    let stems = [];
    try {
      stems = await trackStems(track.id);
    } catch (err) {
      box.replaceChildren(makeEmptyState(err.message));
      return;
    }
    if (!stems || !stems.length) {
      box.replaceChildren(makeEmptyState("This track has no stems on Audius."));
      return;
    }
    const artist = (track.user && track.user.name) || "Audius";
    const toItem = (stem) => {
      const category = String(stem.category || "OTHER").replace(/_/g, " ").toLowerCase();
      return { id: stem.id, title: `${track.title} (${category})`, artist, origName: stem.orig_filename };
    };
    const list = document.createElement("ul");
    list.className = "aud-stem-list";
    stems.forEach((stem) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "aud-stem-name";
      const cat = document.createElement("strong");
      cat.textContent = String(stem.category || "OTHER").replace(/_/g, " ").toLowerCase();
      name.append(cat, ` ${stem.orig_filename || ""}`);
      name.title = stem.orig_filename || "";
      const imp = document.createElement("button");
      imp.type = "button";
      imp.className = "tiny-btn";
      imp.innerHTML = `${icon("download")}Import`;
      imp.addEventListener("click", () => importItems([toItem(stem)], "a stem"));
      li.append(name, imp);
      list.append(li);
    });
    const all = document.createElement("button");
    all.type = "button";
    all.className = "tiny-btn accent aud-import-all";
    all.innerHTML = `${icon("layers")}Import all ${stems.length} stems`;
    all.addEventListener("click", () => importItems(stems.map(toItem), `${stems.length} stems`));
    box.replaceChildren(list, all);
  }

  function renderTracks(tracks, emptyText) {
    stopPreview();
    if (!tracks || !tracks.length) return showMessage(emptyText || "No tracks found.");
    const list = document.createElement("ul");
    list.className = "aud-track-list";
    tracks.forEach((track) => {
      const li = document.createElement("li");
      li.className = "aud-track";
      const art = document.createElement("img");
      art.className = "aud-art";
      art.alt = "";
      art.loading = "lazy";
      const artUrl = trackArtwork(track);
      if (artUrl) art.src = artUrl;
      const info = document.createElement("div");
      info.className = "aud-info";
      const title = document.createElement("a");
      title.className = "aud-title";
      title.href = trackLink(track);
      title.target = "_blank";
      title.rel = "noopener";
      title.textContent = track.title || "Untitled";
      title.title = `${track.title} on Audius`;
      const meta = document.createElement("span");
      meta.className = "aud-meta";
      const bits = [(track.user && track.user.name) || "", track.bpm ? `${Math.round(track.bpm)} BPM` : "", track.musical_key || "", fmtTime(track.duration)];
      meta.textContent = bits.filter(Boolean).join(" · ");
      info.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "aud-actions";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "tiny-btn";
      setPreviewButton(play, false);
      play.addEventListener("click", () => togglePreview(track, play));
      actions.append(play);

      const importable = canImport(track);
      const imp = document.createElement("button");
      imp.type = "button";
      imp.className = "tiny-btn";
      imp.innerHTML = icon("download", { solo: true });
      imp.setAttribute("aria-label", importable ? "Import" : "Import (not downloadable)");
      imp.title = importable ? "Import onto a new track at the playhead" : "The artist hasn't made this track downloadable";
      imp.disabled = !importable;
      imp.addEventListener("click", () =>
        importItems([{ id: track.id, title: track.title, artist: (track.user && track.user.name) || "Audius", origName: track.orig_filename }], `"${track.title}"`)
      );
      actions.append(imp);

      if (importable) {
        const stemsBtn = document.createElement("button");
        stemsBtn.type = "button";
        stemsBtn.className = "tiny-btn";
        stemsBtn.innerHTML = icon("layers", { solo: true });
        stemsBtn.setAttribute("aria-label", "Show stems");
        stemsBtn.title = "Show this track's stems";
        stemsBtn.addEventListener("click", () => toggleStems(track, li, stemsBtn));
        actions.append(stemsBtn);
      }

      li.append(art, info, actions);
      list.append(li);
    });
    results.replaceChildren(list);
  }

  async function run(label, task, emptyText) {
    const seq = ++requestSeq;
    showMessage(`${label}…`);
    try {
      const data = await task();
      if (seq === requestSeq) renderTracks(data, emptyText);
    } catch (err) {
      if (seq === requestSeq) showMessage(err && err.message ? err.message : "Audius didn't answer.");
    }
  }

  function filters() {
    const bpm = Number(project.bpm) || 0;
    return {
      bpmMin: matchTempo.checked && bpm ? Math.floor(bpm - 3) : undefined,
      bpmMax: matchTempo.checked && bpm ? Math.ceil(bpm + 3) : undefined,
      downloadable: downloadable.checked,
    };
  }

  function loadTrending() {
    const f = filters();
    if (f.bpmMin || f.downloadable) {
      // Trending has no tempo or download filter, so filtered browsing searches instead.
      return run("Loading", () => searchTracks({ query: "", ...f, limit: 25 }), "Nothing matches those filters right now.");
    }
    return run("Loading trending tracks", () => trendingTracks({ limit: 25 }));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = query.value.trim();
    if (!q) return loadTrending();
    if (/audius\.co\//i.test(q)) {
      return run("Opening link", async () => {
        const found = await resolveLink(q);
        if (found && found.title && found.id && !found.playlist_name) return [found];
        throw new Error("That link isn't a track. Paste a link to a track.");
      });
    }
    return run(`Searching for "${q}"`, () => searchTracks({ query: q, ...filters(), limit: 25 }), `No tracks match "${q}".`);
  });
  trendingBtn.addEventListener("click", () => {
    query.value = "";
    loadTrending();
  });
  [matchTempo, downloadable].forEach((box) =>
    box.addEventListener("change", () => form.dispatchEvent(new Event("submit", { cancelable: true })))
  );

  function setOpen(open) {
    panel.hidden = !open;
    libraryParts.forEach((el) => {
      if (el) el.hidden = open;
    });
    if (!open) return stopPreview();
    if (tempoLabel) tempoLabel.textContent = `Near session tempo (${Math.round(project.bpm)} BPM)`;
    if (!loadedOnce) {
      loadedOnce = true;
      loadTrending();
    }
  }

  // Project | Audius tabs (WAI-ARIA tabs: arrow keys move between them).
  const tabs = Array.from(document.querySelectorAll(".lib-tab"));
  function selectTab(tab) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    setOpen(tab.dataset.libTab === "audius");
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });
}

/**
 * FILE IMPORT (WAV, MP3, FLAC, OGG, M4A)
 */
const PALETTE = ["#3b82f6", "#2dd4bf", "#a855f7", "#38bdf8", "#10b981", "#f43f5e", "#f59e0b"];

async function handleAudioFilesImport(fileList, targetTrackId = null, startBeat = null) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  setStatus(`Importing ${files.length} audio file(s)…`);
  const beatCursor = startBeat !== null ? startBeat : engine.getPlayheadBeat(project);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || file.size === 0) {
      setStatus(`Skipped "${file ? file.name : `file ${i + 1}`}": the file is empty`, { kind: "error" });
      continue;
    }
    try {
      const arrayBuf = await file.arrayBuffer();
      const audioBuf = await engine.decodeAudioFile(arrayBuf);
      const id = nextId("asset");
      const color = PALETTE[(assets.size + i) % PALETTE.length];
      registerAsset(id, file.name, color, audioBuf);

      let trackId = targetTrackId;
      if (!trackId) {
        const newTrackId = nextId("trk");
        project.tracks.push({
          id: newTrackId,
          name: `${project.tracks.length + 1} · ${file.name.replace(/\.[^.]+$/, "").slice(0, 24)}`,
          color,
          muted: false,
          solo: false,
          volumeDb: 0,
          pan: 0,
          eqLowDb: 0,
          eqMidDb: 0,
          eqHighDb: 0,
        });
        trackId = newTrackId;
        ui.selectedTrackId = newTrackId;
      }

      addAssetClipToPlaylist(id, trackId, beatCursor);
    } catch (err) {
      console.error("Failed to decode audio file:", file.name, err);
      setStatus(`Error decoding ${file.name}: ${err.message}`);
    }
  }

  renderAssetPool();
  onProjectMutated(`Imported ${files.length} audio file(s)`);
}

/**
 *EXPORT / BOUNCE ARRANGEMENT OR STEMS TO WAV
 */
async function executeExport() {
  const prefix = safeFileName(dom.exportFilename.value || "audius-studio-mix");
  const bitDepth = Number(dom.exportBitdepth.value || 24);
  const sampleRate = Number(dom.exportSamplerate.value || 44100);
  let rangeMode = dom.exportRange.value;
  const stemMode = dom.exportMode.value;

  // A loop region that was never set (or was emptied by a load) falls
  // back to the full arrangement instead of rendering silence.
  if (rangeMode === "loop" && !(project.loopEndBeat > project.loopStartBeat + 0.25)) {
    rangeMode = "song";
    dom.exportRange.value = "song";
    setStatus("Loop region not set — exporting the entire arrangement");
  }

  const startBeat = rangeMode === "loop" ? project.loopStartBeat : 0;
  const maxEnd = project.clips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 4);
  const endBeat = rangeMode === "loop" ? project.loopEndBeat : maxEnd;

  if (stemMode === "stems") {
    const tracksWithClips = project.tracks.filter((t) =>
      project.clips.some((c) => c.trackId === t.id && !c.muted)
    );
    if (tracksWithClips.length === 0) {
      dom.exportStatus.textContent =
        "Nothing to export as stems: every track is muted or the Playlist is empty.";
      setStatus("No unmuted clips to export as stems", { kind: "error" });
      return;
    }
  }

  dom.btnRunExport.disabled = true;
  try {
    if (stemMode === "master") {
      dom.exportStatus.textContent = "Rendering master stereo mixdown…";
      const rendered = await engine.renderProjectOffline(project, assets, {
        sampleRate,
        startBeat,
        endBeat,
        rangeMode,
      });
      const blob = encodeWavFromAudioBuffer(rendered, bitDepth);
      triggerDownload(blob, `${prefix}-${bitDepth}bit.wav`);
      dom.exportStatus.textContent = `Exported ${prefix}-${bitDepth}bit.wav (${rendered.duration.toFixed(2)}s)`;
      setStatus(`Exported ${prefix}-${bitDepth}bit.wav`);
    } else {
      const tracksWithClips = project.tracks.filter((t) =>
        project.clips.some((c) => c.trackId === t.id && !c.muted)
      );
      for (let i = 0; i < tracksWithClips.length; i++) {
        const trk = tracksWithClips[i];
        dom.exportStatus.textContent = `Rendering stem ${i + 1}/${tracksWithClips.length}: ${trk.name}…`;
        // Yield between stems so the progress line stays visible.
        await new Promise((r) => setTimeout(r, 0));
        const rendered = await engine.renderProjectOffline(project, assets, {
          sampleRate,
          startBeat,
          endBeat,
          onlyTrackId: trk.id,
        });
        const blob = encodeWavFromAudioBuffer(rendered, bitDepth);
        triggerDownload(blob, `${prefix}-${safeFileName(trk.name)}-${bitDepth}bit.wav`);
      }
      dom.exportStatus.textContent = `Exported ${tracksWithClips.length} track stems!`;
      setStatus(`Exported ${tracksWithClips.length} WAV stems`);
    }
  } catch (err) {
    dom.exportStatus.textContent = `Export error: ${err.message}`;
    setStatus(`Export failed: ${err.message}`, { kind: "error" });
  } finally {
    dom.btnRunExport.disabled = false;
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * SAVE & LOAD PROJECT (.dawproj.json + Browser LocalStorage for Cloudflare Pages + Ubuntu server disk persistence)
 */
const LOCAL_PROJECTS_KEY = "audius_studio_projects_v1";

function getLocalSavedProjects() {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

/** true when the entry was written; false when storage is blocked or full. */
function saveLocalProjectEntry(name, payload) {
  try {
    const map = getLocalSavedProjects();
    map[name] = {
      name,
      updatedAt: payload.savedAt || new Date().toISOString(),
      payload,
    };
    localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(map));
    return true;
  } catch (_) {
    return false;
  }
}

/** File-system-safe characters only, so the download attribute never drops the name. */
function safeFileName(name) {
  return String(name || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "audius-studio-project";
}

async function saveProject() {
  project.name = dom.projectName.value.trim() || "Audius Studio Session";
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...project,
    // Patterns hold the step grid, piano-roll notes and per-row mix, so they belong in the file.
    patterns: cloneProjectState(ui.patterns),
    activePatternIndex: ui.activePatternIndex,
  };

  // Save in Browser LocalStorage (works on Cloudflare Pages / audius-studio.online)
  const stored = saveLocalProjectEntry(project.name, payload);

  // Also save to local Ubuntu server disk if running via node app/server.mjs.
  // Static hosting (Cloudflare Pages) has no /api, so the project is never sent there.
  try {
    if (await hasLocalApi()) {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  } catch (_) {}

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  triggerDownload(blob, `${safeFileName(project.name)}.dawproj.json`);
  setStatus(
    stored
      ? `Saved project "${project.name}"`
      : `Downloaded "${safeFileName(project.name)}.dawproj.json" (browser storage unavailable, so it was not kept in Save/Open)`
  );
  savePrefs();
}

async function openProjectsModal() {
  dom.projectsModal.hidden = false;
  dom.savedProjectsList.replaceChildren(makeEmptyState("Loading saved projects…"));
  // A second tab may have saved or deleted a project since this list was built.
  if (!openProjectsModal._bound) {
    openProjectsModal._bound = true;
    window.addEventListener("storage", (e) => {
      if (e.key === LOCAL_PROJECTS_KEY && dom.projectsModal && !dom.projectsModal.hidden) {
        openProjectsModal();
      }
    });
  }

  const combined = new Map();

  // 1. Load projects from Browser LocalStorage (Cloudflare Pages / audius-studio.online)
  const localMap = getLocalSavedProjects();
  for (const [name, entry] of Object.entries(localMap)) {
    combined.set(name, {
      name: entry.name || name,
      updatedAt: entry.updatedAt || new Date().toISOString(),
      source: "Browser Storage",
      load: async () => entry.payload,
    });
  }

  // 2. Also check Ubuntu local server (/api/projects) if available
  try {
    const res = (await hasLocalApi()) ? await fetch("/api/projects") : null;
    if (res && res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
      const data = await res.json();
      if (Array.isArray(data.projects)) {
        for (const p of data.projects) {
          combined.set(p.name, {
            name: p.name,
            updatedAt: p.updatedAt,
            source: "Local server",
            load: async () => {
              const r = await fetch(`/api/projects/${encodeURIComponent(p.fileName)}`);
              return r.json();
            },
          });
        }
      }
    }
  } catch (_) {}

  dom.savedProjectsList.replaceChildren();
  const items = Array.from(combined.values()).sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt))
  );

  if (items.length === 0) {
    const code = document.createElement("code");
    code.textContent = ".dawproj.json";
    dom.savedProjectsList.replaceChildren(
      makeEmptyState("No saved projects yet. Choose Save in the Options menu, or use Browse below to load a ", code, " file from your device.")
    );
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "saved-proj-row";
    const nameEl = document.createElement("strong");
    nameEl.textContent = item.name;
    const metaEl = document.createElement("span");
    metaEl.className = "saved-proj-meta";
    const savedAt = new Date(item.updatedAt);
    metaEl.textContent = `${item.source} · ${Number.isNaN(savedAt.getTime()) ? "unknown date" : savedAt.toLocaleString()}`;
    row.append(nameEl, metaEl);
    row.addEventListener("click", async () => {
      const projData = await item.load();
      loadProjectObject(projData);
      dom.projectsModal.hidden = true;
    });
    dom.savedProjectsList.appendChild(row);
  }
}

const clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * Effect plugin slots stored in a project. Anything malformed degrades to an
 * empty slot rather than throwing, and sizes are capped so a hand-edited file
 * cannot blow up localStorage.
 */
function sanitizeFxPlugins(raw) {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set();
  const out = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object" || typeof item.type !== "string" || !item.type) continue;
    let id = typeof item.id === "string" && item.id ? item.id.slice(0, 80) : nextId("fxp");
    while (seen.has(id)) id = nextId("fxp");
    seen.add(id);
    const slot = { id, type: item.type.slice(0, 80), bypass: !!item.bypass };
    if (typeof item.name === "string") slot.name = item.name.slice(0, 60);
    if (item.values && typeof item.values === "object") {
      const values = {};
      for (const [k, v] of Object.entries(item.values).slice(0, 24)) {
        const n = Number(v);
        if (Number.isFinite(n)) values[String(k).slice(0, 40)] = n;
      }
      slot.values = values;
    }
    if (Number.isFinite(item.presetIndex)) slot.presetIndex = Math.max(0, Math.round(item.presetIndex));
    if (
      item.custom &&
      typeof item.custom === "object" &&
      typeof item.custom.jsB64 === "string" &&
      typeof item.custom.wasmB64 === "string" &&
      item.custom.jsB64.length < 2_100_000 &&
      item.custom.wasmB64.length < 11_000_000
    ) {
      slot.custom = {
        name: String(item.custom.name || "User effect").slice(0, 60),
        jsB64: item.custom.jsB64,
        wasmB64: item.custom.wasmB64,
      };
    }
    out.push(slot);
  }
  return out.length ? out : undefined;
}

/**
 * Normalises a project payload (saved here or written by hand) so a
 * malformed .dawproj.json can never crash a render: every field gets a
 * type-checked, in-range replacement and every id stays unique.
 */
function sanitizeProjectPayload(data) {
  const pal = getActiveTheme().palette;
  const seenIds = new Set();
  const uniqueId = (raw, prefix) => {
    let id = typeof raw === "string" && raw ? raw : nextId(prefix);
    while (seenIds.has(id)) id = nextId(prefix);
    seenIds.add(id);
    return id;
  };

  const tracks = (Array.isArray(data.tracks) ? data.tracks : []).map((t, i) => ({
    id: uniqueId(t && t.id, "trk"),
    name: String(t && t.name ? t.name : `Track ${i + 1}`).slice(0, 120),
    color: /^#[0-9a-f]{3,8}$/i.test(t && t.color) ? t.color : pal[i % pal.length],
    muted: !!(t && t.muted),
    solo: !!(t && t.solo),
    volumeDb: clampNum(t && t.volumeDb, -60, 12, 0),
    pan: clampNum(t && t.pan, -1, 1, 0),
    eqLowDb: clampNum(t && t.eqLowDb, -15, 15, 0),
    eqMidDb: clampNum(t && t.eqMidDb, -15, 15, 0),
    eqHighDb: clampNum(t && t.eqHighDb, -15, 15, 0),
    gateFx: t && t.gateFx ? t.gateFx : undefined,
    fxPlugins: sanitizeFxPlugins(t && t.fxPlugins),
  }));
  // A project always keeps at least one lane to paint into.
  if (tracks.length === 0) {
    tracks.push({
      id: nextId("trk"),
      name: "1 · Audio Track",
      color: pal[0],
      muted: false,
      solo: false,
      volumeDb: 0,
      pan: 0,
      eqLowDb: 0,
      eqMidDb: 0,
      eqHighDb: 0,
    });
  }
  const trackIds = new Set(tracks.map((t) => t.id));

  const clips = (Array.isArray(data.clips) ? data.clips : [])
    .filter((c) => c && trackIds.has(c.trackId))
    .map((c) => ({
      id: uniqueId(c.id, "clip"),
      assetId: String(c.assetId || ""),
      trackId: c.trackId,
      name: String(c.name || "Clip").slice(0, 120),
      color: /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : pal[0],
      startBeat: Math.max(0, clampNum(c.startBeat, 0, 100000, 0)),
      durationBeats: Math.max(0.0625, clampNum(c.durationBeats, 0.0625, 100000, 1)),
      sourceOffsetSec: Math.max(0, clampNum(c.sourceOffsetSec, 0, 3600, 0)),
      gainDb: clampNum(c.gainDb, -60, 12, 0),
      pan: clampNum(c.pan, -1, 1, 0),
      pitchSemitones: clampNum(c.pitchSemitones, -24, 24, 0),
      fadeInBeats: Math.max(0, clampNum(c.fadeInBeats, 0, 64, 0)),
      fadeOutBeats: Math.max(0, clampNum(c.fadeOutBeats, 0, 64, 0)),
      reverse: !!c.reverse,
      muted: !!c.muted,
    }));

  const markers = (Array.isArray(data.markers) ? data.markers : [])
    .filter((m) => m && Number.isFinite(m.beat))
    .map((m, i) => ({
      id: uniqueId(m.id, "m"),
      beat: Math.max(0, m.beat),
      name: String(m.name || `Section ${i + 1}`).slice(0, 80),
      color: /^#[0-9a-f]{3,8}$/i.test(m.color) ? m.color : pal[(i + 1) % pal.length],
    }));

  const bpm = clampNum(data.bpm, 20, 999, 124);
  let loopStartBeat = Math.max(0, clampNum(data.loopStartBeat, 0, 100000, 0));
  let loopEndBeat = Math.max(loopStartBeat + 1, clampNum(data.loopEndBeat, 1, 100000, 16));

  const patterns = Array.isArray(data.patterns)
    ? data.patterns.map((pat, i) => {
        const steps = {};
        if (pat && pat.steps && typeof pat.steps === "object") {
          for (const [assetId, arr] of Object.entries(pat.steps)) {
            if (Array.isArray(arr)) {
              steps[String(assetId)] = arr.slice(0, 16).map((v) => (v ? 1 : 0));
            }
          }
        }
        const notes = (Array.isArray(pat && pat.notes) ? pat.notes : [])
          .filter((n) => n && typeof n === "object")
          .map((n) => {
            const note = {
              id: uniqueId(n && n.id, "prn"),
              row: Math.max(0, Math.min(PR_ROWS.length - 1, Math.round(clampNum(n && n.row, 0, PR_ROWS.length - 1, 0)))),
              startStep: Math.max(0, Math.min(15, Math.round(clampNum(n && n.startStep, 0, 15, 0)))),
              lenSteps: Math.max(1, Math.min(16 - 0, Math.round(clampNum(n && n.lenSteps, 1, 16, 2)))),
              vel: clampNum(n && n.vel, 0.1, 1, 0.85),
              label: String((n && n.label) || "").slice(0, 8),
            };
            // Imported notes keep their real MIDI number so export is exact.
            if (n && Number.isFinite(n.midi)) note.midi = Math.max(0, Math.min(127, Math.round(n.midi)));
            return note;
          })
          .filter((n) => Number.isFinite(n.row) && Number.isFinite(n.startStep));
        const pattern = {
          name: String(pat && pat.name ? pat.name : `Pattern ${i + 1}`).slice(0, 60),
          steps,
          notes,
          mix: pat && pat.mix && typeof pat.mix === "object" ? pat.mix : {},
        };
        // Imported patterns remember their track and bar; a dangling track id is dropped.
        if (pat && typeof pat.trackId === "string" && trackIds.has(pat.trackId)) pattern.trackId = pat.trackId;
        if (pat && Number.isFinite(pat.barIndex)) pattern.barIndex = Math.max(0, Math.round(pat.barIndex));
        return pattern;
      })
    : [];

  return {
    name: String(data.name || "Imported Project").slice(0, 120),
    bpm,
    masterVolumeDb: clampNum(data.masterVolumeDb, -60, 12, 0),
    loopEnabled: !!data.loopEnabled,
    loopStartBeat,
    loopEndBeat,
    metronome: !!data.metronome,
    masterGateFx: data.masterGateFx || undefined,
    masterFxPlugins: sanitizeFxPlugins(data.masterFxPlugins),
    markers,
    tracks,
    clips,
    patterns,
    activePatternIndex: Math.max(0, Math.round(clampNum(data.activePatternIndex, 0, Math.max(0, patterns.length - 1), 0))),
    // Synth channels and the recipes of their rendered clips (re-rendered on load).
    instruments: sanitizeInstruments(data.instruments),
    synthRenders: sanitizeSynthRenders(data.synthRenders),
  };
}

function loadProjectObject(data) {
  if (!data || !Array.isArray(data.tracks) || !Array.isArray(data.clips)) {
    setStatus("Invalid project file", { kind: "error" });
    return;
  }
  pushUndoState();
  const clean = sanitizeProjectPayload(data);
  project = {
    name: clean.name,
    bpm: clean.bpm,
    masterVolumeDb: clean.masterVolumeDb,
    loopEnabled: clean.loopEnabled,
    loopStartBeat: clean.loopStartBeat,
    loopEndBeat: clean.loopEndBeat,
    metronome: clean.metronome,
    masterGateFx: clean.masterGateFx,
    masterFxPlugins: clean.masterFxPlugins,
    markers: clean.markers,
    tracks: clean.tracks,
    clips: clean.clips,
    instruments: clean.instruments,
    synthRenders: clean.synthRenders,
  };
  // Patterns come with the file. Older files have none, so keep the current ones for them.
  if (clean.patterns.length > 0) {
    ui.patterns = clean.patterns;
    ui.activePatternIndex = Math.min(clean.activePatternIndex, ui.patterns.length - 1);
  }
  ui.selectedClipIds.clear();
  ui.selectedTrackId = project.tracks[0].id;
  onProjectMutated(`Loaded project "${project.name}"`);
  // Synth channels come back as Library / Step Rack rows; their rendered clips are re-rendered.
  instruments.restoreProject().catch((err) => setStatus(`Synth channels could not be restored: ${err.message}`, { kind: "error" }));
  // User-loaded WASM effects travel inside the project: re-register them from
  // their saved source, then rebuild the chains that were waiting on them.
  if (fxUi) {
    fxUi.prepareProject(project).then(() => {
      engine.invalidateFxChains();
      try {
        engine.ensureContext();
      } catch (_) {}
      engine.syncTrackNodes(project);
      fxUi.refresh();
    }).catch(() => {});
  }
}

/**
 * UI & KEYBOARD EVENT BINDINGS
 */
function bindControls() {
  if (dom.themeSelect) {
    dom.themeSelect.addEventListener("change", () => {
      applyTheme(dom.themeSelect.value, true);
    });
  }

  if (dom.wallpaperSelect) {
    dom.wallpaperSelect.addEventListener("change", () => {
      applyWallpaper(dom.wallpaperSelect.value, true);
    });
  }

  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeSwatch, true);
    });
  });

  if (dom.customAccentPicker) {
    dom.customAccentPicker.addEventListener("input", () => {
      const col = dom.customAccentPicker.value;
      const body = document.body.style;
      body.setProperty("--accent-orange", col);
      body.setProperty("--accent-orange-bright", col);
      body.setProperty("--accent-amber", col);
      // the system reads the role tokens, so the picked colour is mapped onto each of them
      const gradient = `linear-gradient(135deg, ${col} 0%, ${shadeHex(col, 0.55)} 100%)`;
      body.setProperty("--accent-fill", col);
      body.setProperty("--accent-text", col);
      body.setProperty("--accent-gradient", gradient);
      body.setProperty("--play-gradient", gradient);
      body.setProperty("--accent-press", shadeHex(col, 0.84));
      body.setProperty("--play-glow", col);
      body.setProperty("--accent-rgb", hexToTriplet(col));
      body.setProperty("--play-glow-rgb", hexToTriplet(col));
      getActiveTheme().playhead = col;
      drawAllCanvases();
      setStatus(`Custom Accent Color: ${col}`);
    });
  }

  if (dom.customBgPicker) {
    dom.customBgPicker.addEventListener("input", () => {
      const bg = dom.customBgPicker.value;
      document.body.style.setProperty("--bg-darkest", bg);
      document.body.style.setProperty("--bg-panel", bg);
      const t = getActiveTheme();
      t.canvasBg = bg;
      t.laneOdd = bg;
      t.laneEven = bg;
      t.rulerBg = bg;
      drawAllCanvases();
      setStatus(`Custom Background Color: ${bg}`);
    });
  }

  const syncWindowButtons = () => {
    const poolOpen = !dom.leftPanel.classList.contains("collapsed");
    const crOpen = dom.channelRackWindow && !dom.channelRackWindow.classList.contains("collapsed");
    const prOpen = dom.pianoRollWindow && !dom.pianoRollWindow.classList.contains("collapsed");
    const mixOpen = dom.mixerWindow && !dom.mixerWindow.classList.contains("collapsed");

    setLit(dom.btnTogglePool, poolOpen);
    setLit(dom.btnToggleChannelRack, crOpen);
    setLit(dom.btnTogglePianoRoll, prOpen);
    // A taller dock gives the piano roll room for its note grid (no :has(), for older browsers).
    const upperDock = document.getElementById("fl-upper-dock");
    if (upperDock) upperDock.classList.toggle("piano-tall", !!prOpen);
    setLit(dom.btnToggleMixer, mixOpen);
    setLit(dom.btnToggleTrellis, !dom.trellisDock.classList.contains("collapsed"));
    setLit(dom.btnToggleInspector, !dom.rightPanel.classList.contains("collapsed"));
    const gateWindow = document.getElementById("gate-shaper-window");
    if (dom.btnToggleGate && gateWindow) setLit(dom.btnToggleGate, !gateWindow.classList.contains("collapsed"));

    if (dom.flUpperDock) {
      dom.flUpperDock.classList.toggle("all-collapsed", !crOpen && !prOpen);
    }
    if (dom.btnLayoutPreset) {
      const anyRackOpen = crOpen || prOpen || mixOpen;
      dom.btnLayoutPreset.innerHTML = anyRackOpen
        ? icon("rows-3")
        : icon("layout-dashboard");
      const presetLabel = anyRackOpen ? "Focus Playlist (F5)" : "All 5 Studio Windows (F5)";
      dom.btnLayoutPreset.title = presetLabel;
      dom.btnLayoutPreset.setAttribute("aria-label", presetLabel);
      dom.btnLayoutPreset.setAttribute("aria-pressed", String(anyRackOpen));
    }
    if (dom.btnReopenPool) dom.btnReopenPool.hidden = poolOpen;
    animateOpenedWindows();
    setTimeout(drawAllCanvases, 25);
  };

  const studioWindows = [dom.leftPanel, dom.channelRackWindow, dom.pianoRollWindow, dom.mixerWindow, dom.trellisDock, dom.rightPanel].filter(Boolean);
  const windowWasOpen = new WeakMap();
  const easeWindowIn = (el) =>
    playMotion(
      el,
      [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: 220 },
      [{ opacity: 0 }, { opacity: 1 }]
    );
  function animateOpenedWindows() {
    studioWindows.forEach((el) => {
      const open = !el.classList.contains("collapsed");
      if (open && windowWasOpen.get(el) === false) easeWindowIn(el);
      windowWasOpen.set(el, open);
    });
  }

  const workspaceEl = document.getElementById("workspace");
  const gateWindowEl = document.getElementById("gate-shaper-window");

  // Compact screens show one window at a time. Everything routes through focusWorkspaceWindow(),
  // so the visible panel, data-mobile-window and every lit button always agree.
  const compactWindows = {
    library: () => dom.leftPanel,
    step: () => dom.channelRackWindow,
    piano: () => dom.pianoRollWindow,
    mixer: () => dom.mixerWindow,
    trellis: () => dom.trellisDock,
    inspector: () => dom.rightPanel,
    gate: () => gateWindowEl,
    plugin: () => document.getElementById("plugin-window"),
  };

  const updateResponsiveMenus = () => {
    document.querySelectorAll(".transport-extras, .transport-readouts").forEach((menu) => {
      menu.open = !compactLayoutQuery.matches;
    });
  };

  const focusWorkspaceWindow = (name) => {
    if (!compactLayoutQuery.matches) return;
    Object.entries(compactWindows).forEach(([key, getPanel]) => {
      const panel = getPanel();
      if (!panel) return;
      if (key === name) panel.classList.remove("collapsed");
      else panel.classList.add("collapsed");
    });
    workspaceEl.dataset.mobileWindow = name;
    const changed = workspaceEl.dataset.mobileWindowShown !== name;
    workspaceEl.dataset.mobileWindowShown = name;
    syncWindowButtons();
    if (changed) playMotion(workspaceEl, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 180 }, [{ opacity: 0.35 }, { opacity: 1 }]);
  };

  /** One window button: on phones it brings the panel to the front, on larger screens it toggles. */
  const toggleStudioWindow = (name, getPanel) => {
    const panel = getPanel();
    if (!panel) return;
    if (compactLayoutQuery.matches) {
      const alreadyShown = !panel.classList.contains("collapsed") && workspaceEl.dataset.mobileWindow === name;
      if (alreadyShown) {
        panel.classList.add("collapsed");
        focusWorkspaceWindow("playlist");
      } else {
        focusWorkspaceWindow(name);
      }
      return;
    }
    panel.classList.toggle("collapsed");
    syncWindowButtons();
  };

  // The Gate Shaper is opened from the Mixer header and from FX slot 6; follow its own state
  // so the lit button and the phone's single-window view stay in step.
  if (gateWindowEl) {
    new MutationObserver(() => {
      const open = !gateWindowEl.classList.contains("collapsed");
      if (compactLayoutQuery.matches) {
        if (open && workspaceEl.dataset.mobileWindow !== "gate") focusWorkspaceWindow("gate");
        else if (!open && workspaceEl.dataset.mobileWindow === "gate") focusWorkspaceWindow("playlist");
      }
      syncWindowButtons();
    }).observe(gateWindowEl, { attributes: true, attributeFilter: ["class"] });
  }

  // The effect window opens from the mixer's plugin list; follow it the same
  // way the Gate Shaper is followed.
  const pluginWindowEl = document.getElementById("plugin-window");
  if (pluginWindowEl) {
    new MutationObserver(() => {
      const open = !pluginWindowEl.classList.contains("collapsed");
      if (compactLayoutQuery.matches) {
        if (open && workspaceEl.dataset.mobileWindow !== "plugin") focusWorkspaceWindow("plugin");
        else if (!open && workspaceEl.dataset.mobileWindow === "plugin") focusWorkspaceWindow("playlist");
      }
      syncWindowButtons();
    }).observe(pluginWindowEl, { attributes: true, attributeFilter: ["class"] });
  }

  updateResponsiveMenus();
  // Collapse the empty Step Rack / Piano Roll dock on first load, not only after a window toggle.
  syncWindowButtons();
  // Phones show one window at a time: settle the first paint on the Playlist so the strip's
  // lit state always describes what is actually on screen.
  if (compactLayoutQuery.matches) {
    workspaceEl.dataset.mobileWindowShown = workspaceEl.dataset.mobileWindow;
    focusWorkspaceWindow(workspaceEl.dataset.mobileWindow || "playlist");
  }

  // ---------------------------------------------------------------------------
  // Popover layer: one scrim, panels anchored to their trigger, aria-expanded kept
  // true, Escape / tap-outside closes, and focus returns to the trigger. Nothing is
  // focus-trapped: these are popovers, not modal dialogs.
  // ---------------------------------------------------------------------------
  const popoverScrim = document.getElementById("popover-scrim");
  const popoverMenus = [...document.querySelectorAll("details[data-popover]")];
  const transportMenus = [...document.querySelectorAll(".transport-extras, .transport-readouts")];
  const closeTransportMenus = () => {
    if (!compactLayoutQuery.matches) return; // Desktop keeps them open: their content is inline.
    transportMenus.forEach((menu) => {
      if (menu.open) menu.open = false;
    });
  };

  const isCompactSheet = (menu) => compactLayoutQuery.matches && menu.dataset.popover === "options";

  function placePopover(menu) {
    const panel = menu.querySelector(".popover");
    const trigger = menu.querySelector("summary");
    if (!panel || !trigger) return;
    panel.style.removeProperty("left");
    panel.style.removeProperty("right");
    panel.style.removeProperty("top");
    panel.style.removeProperty("bottom");
    panel.style.removeProperty("width");
    panel.style.removeProperty("max-height");
    if (isCompactSheet(menu)) return; // The phone sheet is positioned by CSS.
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const rect = trigger.getBoundingClientRect();
    const natural = panel.getBoundingClientRect();
    const width = Math.min(natural.width || 320, vw - 16);
    panel.style.width = `${Math.round(width)}px`;
    const alignRight = menu.dataset.popoverAlign === "right";
    let left = alignRight ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    const below = vh - rect.bottom - 10;
    const above = rect.top - 10;
    const wanted = Math.min(panel.scrollHeight || natural.height || 320, vh * 0.8);
    const openUp = below < wanted && above > below;
    const space = Math.max(180, openUp ? above : below);
    panel.style.maxHeight = `${Math.round(Math.min(space, vh * 0.8))}px`;
    panel.style.left = `${Math.round(left)}px`;
    if (openUp) {
      panel.style.top = "auto";
      panel.style.bottom = `${Math.round(vh - rect.top + 6)}px`;
    } else {
      panel.style.top = `${Math.round(rect.bottom + 6)}px`;
      panel.style.bottom = "auto";
    }
  }

  function syncScrim() {
    if (!popoverScrim) return;
    const anyOpen = popoverMenus.some((menu) => menu.open) || transportMenus.some((menu) => menu.open && compactLayoutQuery.matches);
    popoverScrim.hidden = !anyOpen;
    document.body.classList.toggle("popover-open", anyOpen);
  }

  function closePopover(menu, restoreFocus = false) {
    if (!menu || !menu.open) return;
    const hadFocus = menu.contains(document.activeElement);
    menu.open = false;
    if (restoreFocus && hadFocus) menu.querySelector("summary")?.focus({ preventScroll: true });
  }

  function closeAllPopovers(restoreFocus = false) {
    popoverMenus.forEach((menu) => closePopover(menu, restoreFocus));
    closeTransportMenus();
    syncScrim();
  }

  popoverMenus.forEach((menu) => {
    const summary = menu.querySelector("summary");
    const panel = menu.querySelector(".popover");
    summary?.setAttribute("aria-expanded", "false");
    if (panel) panel.tabIndex = -1;
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        popoverMenus.forEach((other) => {
          if (other !== menu && other.open) other.open = false;
        });
        closeTransportMenus();
        summary?.setAttribute("aria-expanded", "true");
        placePopover(menu);
        syncScrim();
        panel?.focus({ preventScroll: true });
      } else {
        summary?.setAttribute("aria-expanded", "false");
        syncScrim();
        if (menu.contains(document.activeElement)) summary?.focus({ preventScroll: true });
      }
    });
    // A chosen action closes the menu; the trigger keeps the focus.
    panel?.addEventListener("click", (event) => {
      if (event.target.closest("[data-popover-close]")) {
        menu.open = false;
        summary?.focus({ preventScroll: true });
        return;
      }
      if (event.target.closest(".popover-row") && !event.target.closest("[aria-disabled='true']")) {
        menu.open = false;
        summary?.focus({ preventScroll: true });
      }
    });
  });

  transportMenus.forEach((menu) => {
    const summary = menu.querySelector("summary");
    summary?.setAttribute("aria-expanded", String(menu.open));
    menu.addEventListener("toggle", () => {
      summary?.setAttribute("aria-expanded", String(menu.open));
      syncScrim();
    });
  });

  popoverScrim?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    closeAllPopovers(true);
  });

  document.addEventListener("pointerdown", (event) => {
    const owner = event.target.closest?.("details[data-popover], .transport-extras, .transport-readouts");
    popoverMenus.forEach((menu) => {
      if (menu.open && menu !== owner) closePopover(menu);
    });
    transportMenus.forEach((menu) => {
      if (menu.open && menu !== owner && compactLayoutQuery.matches) menu.open = false;
    });
    syncScrim();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openMenu = popoverMenus.find((menu) => menu.open);
    if (openMenu) {
      closePopover(openMenu, true);
      return;
    }
    closeAllPopovers(false);
  });

  const repositionPopovers = () => {
    popoverMenus.forEach((menu) => {
      if (menu.open) placePopover(menu);
    });
  };
  window.addEventListener("resize", repositionPopovers);
  window.addEventListener("orientationchange", repositionPopovers);

  // Crossing the compact breakpoint changes where panels live and how they size: close them,
  // so nothing is ever left open, orphaned or half off the screen.
  let wasCompact = compactLayoutQuery.matches;
  const onLayoutModeChange = (event) => {
    const compact = event ? event.matches : compactLayoutQuery.matches;
    // Every anchored panel is dismissed on a breakpoint change: its trigger may have moved rows.
    closeAllPopovers(false);
    wasCompact = compact;
    updateResponsiveMenus();
    syncWindowButtons();
    // Re-apply single-window focus so the lit strip always matches what is on screen
    // after a resize across 760px. Without this a Library-open/Playlist-lit desync
    // survives the breakpoint swap.
    if (compact) {
      const current = workspaceEl.dataset.mobileWindow;
      if (current && compactWindows[current]) {
        focusWorkspaceWindow(current);
      } else {
        focusWorkspaceWindow("playlist");
      }
    }
  };
  if (compactLayoutQuery.addEventListener) compactLayoutQuery.addEventListener("change", onLayoutModeChange);
  else if (compactLayoutQuery.addListener) compactLayoutQuery.addListener(onLayoutModeChange);
  dom.btnTogglePool.addEventListener("click", () => toggleStudioWindow("library", () => dom.leftPanel));
  dom.btnClosePool.addEventListener("click", () => {
    dom.leftPanel.classList.add("collapsed");
    focusWorkspaceWindow("playlist");
    syncWindowButtons();
  });
  if (dom.btnReopenPool) {
    dom.btnReopenPool.addEventListener("click", () => {
      dom.leftPanel.classList.remove("collapsed");
      focusWorkspaceWindow("library");
      syncWindowButtons();
    });
  }

  // Step Rack (F6), Piano Roll (F7), Studio Mixer (F9), and Layout Preset (F5)
  if (dom.btnToggleChannelRack && dom.channelRackWindow) {
    dom.btnToggleChannelRack.addEventListener("click", () => toggleStudioWindow("step", () => dom.channelRackWindow));
  }
  if (dom.btnCloseChannelRack && dom.channelRackWindow) {
    dom.btnCloseChannelRack.addEventListener("click", () => {
      dom.channelRackWindow.classList.add("collapsed");
      focusWorkspaceWindow("playlist");
      syncWindowButtons();
    });
  }
  if (dom.btnTogglePianoRoll && dom.pianoRollWindow) {
    dom.btnTogglePianoRoll.addEventListener("click", () => toggleStudioWindow("piano", () => dom.pianoRollWindow));
  }
  if (dom.btnClosePianoRoll && dom.pianoRollWindow) {
    dom.btnClosePianoRoll.addEventListener("click", () => {
      dom.pianoRollWindow.classList.add("collapsed");
      focusWorkspaceWindow("playlist");
      syncWindowButtons();
    });
  }
  if (dom.btnToggleMixer && dom.mixerWindow) {
    dom.btnToggleMixer.addEventListener("click", () => toggleStudioWindow("mixer", () => dom.mixerWindow));
  }
  if (dom.btnCloseMixer && dom.mixerWindow) {
    dom.btnCloseMixer.addEventListener("click", () => {
      dom.mixerWindow.classList.add("collapsed");
      focusWorkspaceWindow("playlist");
      syncWindowButtons();
    });
  }
  if (dom.btnMixerOpenInsp) {
    dom.btnMixerOpenInsp.addEventListener("click", () => {
      dom.rightPanel.classList.toggle("collapsed");
      focusWorkspaceWindow(dom.rightPanel.classList.contains("collapsed") ? "playlist" : "inspector");
      syncWindowButtons();
    });
  }
  if (dom.btnLayoutPreset) {
    dom.btnLayoutPreset.addEventListener("click", () => {
      if (compactLayoutQuery.matches) {
        focusWorkspaceWindow("playlist");
        setStatus("F5 Layout: Focus Playlist");
        return;
      }
      const anyRackOpen =
        !dom.channelRackWindow.classList.contains("collapsed") ||
        !dom.pianoRollWindow.classList.contains("collapsed") ||
        !dom.mixerWindow.classList.contains("collapsed");
      if (anyRackOpen) {
        dom.channelRackWindow.classList.add("collapsed");
        dom.pianoRollWindow.classList.add("collapsed");
        dom.mixerWindow.classList.add("collapsed");
        setStatus("F5 Layout: Focus Playlist + Audius Library");
      } else {
        dom.leftPanel.classList.remove("collapsed");
        dom.channelRackWindow.classList.remove("collapsed");
        dom.pianoRollWindow.classList.remove("collapsed");
        dom.mixerWindow.classList.remove("collapsed");
        setStatus("F5 Layout: All 5 Audius Studio Windows Docked (Library · Step Rack · Piano Roll · Playlist · Mixer)");
      }
      syncWindowButtons();
    });
  }

  // PAT / SONG Mode Selector
  if (dom.btnModePat && dom.btnModeSong) {
    dom.btnModePat.addEventListener("click", () => {
      ui.transportMode = "pat";
      setLit(dom.btnModePat, true);
      setLit(dom.btnModeSong, false);
      setStatus("Audius Studio Mode: PAT (Plays active 16-Step Rack & Piano Roll pattern)");
    });
    dom.btnModeSong.addEventListener("click", () => {
      ui.transportMode = "song";
      setLit(dom.btnModeSong, true);
      setLit(dom.btnModePat, false);
      setStatus("Audius Studio Mode: SONG (Plays full Playlist arrangement)");
    });
  }

  // Pattern Selector & Step Rack / Piano Roll Controls
  if (dom.patternSelect) {
    dom.patternSelect.addEventListener("change", () => {
      ui.activePatternIndex = Number(dom.patternSelect.value) || 0;
      renderChannelRack();
      drawPianoRollCanvas();
      setStatus(`Selected ${getActivePattern().name}`);
    });
  }
  if (dom.crSwing) {
    // The document-level input listener announces the value and fills
    // the track; this keeps the rack's swing in step with it.
    dom.crSwing.addEventListener("input", () => {
      ui.swing = Number(dom.crSwing.value);
    });
  }
  if (dom.btnStampPattern) {
    dom.btnStampPattern.addEventListener("click", stampChannelRackPatternToPlaylist);
  }
  // "+ Synth": a new Mammoth channel (Library header and Step Rack header).
  for (const btn of [dom.btnAddSynth, dom.btnCrAddSynth]) {
    if (btn) btn.addEventListener("click", () => instruments.addInstrument("mammoth"));
  }
  if (dom.btnCrPlay) {
    dom.btnCrPlay.addEventListener("click", playChannelRackPatternPreview);
  }
  if (dom.btnCrClear) {
    dom.btnCrClear.addEventListener("click", () => {
      const pat = getActivePattern();
      pushUndoState();
      for (const k of Object.keys(pat.steps)) {
        pat.steps[k] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      }
      renderChannelRack();
      setStatus(`Cleared all 16-step buttons in ${pat.name}`);
    });
  }
  if (dom.btnPrPlay) {
    dom.btnPrPlay.addEventListener("click", playPianoRollPreview);
  }
  if (dom.btnPrStamp) {
    dom.btnPrStamp.addEventListener("click", stampPianoRollToPlaylist);
  }
  if (dom.btnPrClear) {
    dom.btnPrClear.addEventListener("click", () => {
      getActivePattern().notes = [];
      drawPianoRollCanvas();
      setStatus("Cleared Piano Roll notes");
    });
  }

  // Audius Ranked Top Menu Bar items + Live Hover Hint Panel
  const menuActions = {
    "menu-file": () => dom.btnExportModal.click(),
    "menu-edit": () => undo(),
    "menu-add": () => dom.btnAddTrack.click(),
    "menu-patterns": () => stampChannelRackPatternToPlaylist(),
    "menu-view": () => dom.btnLayoutPreset && dom.btnLayoutPreset.click(),
    "menu-options": () => dom.btnTypingPiano && dom.btnTypingPiano.click(),
    "menu-tools": () => chopSelectedClipsByTransients(),
    "menu-help": () => dom.btnFlShortcuts && dom.btnFlShortcuts.click(),
  };
  for (const [id, fn] of Object.entries(menuActions)) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }

  // Hover and keyboard hints, the styled tooltip, and slider behaviour (reset, read-out, fill)
  setupTooltips();
  setupRangeBehaviour();
  syncCommandAvailability();

  // Floating Clip Context Menu actions
  if (dom.ctxCloseBtn) {
    dom.ctxCloseBtn.addEventListener("click", () => (dom.clipContextMenu.hidden = true));
  }
  if (dom.ctxSplitHere) {
    dom.ctxSplitHere.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      const clip = getPrimarySelectedClip();
      if (clip) sliceClipAtPointer(clip, ui.contextBeat || clip.startBeat + clip.durationBeats / 2, false);
    });
  }
  if (dom.ctxCutHalf) {
    dom.ctxCutHalf.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      cutSelectedClipInHalf();
    });
  }
  if (dom.ctxChopBeat) {
    dom.ctxChopBeat.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      chopSelectedClipsEvery(1);
    });
  }
  if (dom.ctxChopTrans) {
    dom.ctxChopTrans.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      chopSelectedClipsByTransients();
    });
  }
  if (dom.ctxChopBar) {
    dom.ctxChopBar.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      chopSelectedClipsEvery(4);
    });
  }
  if (dom.ctxDuplicate) {
    dom.ctxDuplicate.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      duplicateSelectedClips();
    });
  }
  if (dom.ctxReverse) {
    dom.ctxReverse.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      reverseSelectedClips();
    });
  }
  if (dom.ctxFade) {
    dom.ctxFade.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      dom.btnFadeQuick.click();
    });
  }
  if (dom.ctxMute) {
    dom.ctxMute.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      const clip = getPrimarySelectedClip();
      if (clip) {
        pushUndoState();
        clip.muted = !clip.muted;
        onProjectMutated(`${clip.muted ? "Muted" : "Unmuted"} "${clip.name}"`);
      }
    });
  }
  if (dom.ctxDelete) {
    dom.ctxDelete.addEventListener("click", () => {
      dom.clipContextMenu.hidden = true;
      deleteSelectedClips();
    });
  }

  dom.btnToggleTrellis.addEventListener("click", () => toggleStudioWindow("trellis", () => dom.trellisDock));
  dom.btnCloseTrellis.addEventListener("click", () => {
    dom.trellisDock.classList.add("collapsed");
    focusWorkspaceWindow("playlist");
    syncWindowButtons();
  });

  dom.btnToggleInspector.addEventListener("click", () => toggleStudioWindow("inspector", () => dom.rightPanel));
  dom.btnCloseInspector.addEventListener("click", () => {
    dom.rightPanel.classList.add("collapsed");
    focusWorkspaceWindow("playlist");
    syncWindowButtons();
  });

  // Transport
  dom.btnPlay.addEventListener("click", () => {
    if (engine.isPlaying) {
      engine.pause(project);
      dom.btnPlay.classList.remove("playing");
      setPlayIcon(false);
      setStatus("Paused");
    } else {
      engine.play(project, assets);
      dom.btnPlay.classList.add("playing");
      setPlayIcon(true);
      setStatus("Playing arrangement…");
    }
  });

  dom.btnStop.addEventListener("click", () => {
    engine.stop(project);
    dom.btnPlay.classList.remove("playing");
    setPlayIcon(false);
    drawAllCanvases();
    setStatus("Stopped");
  });

  dom.timeReadoutBox.addEventListener("click", () => {
    engine.seek(project, assets, 0);
    drawAllCanvases();
    setStatus("Playhead reset to Bar 1");
  });

  dom.btnLoop.addEventListener("click", () => {
    pushUndoState();
    project.loopEnabled = !project.loopEnabled;
    onProjectMutated(`Loop ${project.loopEnabled ? "enabled" : "disabled"}`);
  });

  dom.btnMetro.addEventListener("click", () => {
    pushUndoState();
    project.metronome = !project.metronome;
    onProjectMutated(`Metronome ${project.metronome ? "ON" : "OFF"}`);
  });

  dom.bpmDown.addEventListener("click", () => {
    pushUndoState();
    project.bpm = Math.max(40, project.bpm - 1);
    onProjectMutated(`Tempo set to ${project.bpm} BPM`);
  });
  dom.bpmUp.addEventListener("click", () => {
    pushUndoState();
    project.bpm = Math.min(260, project.bpm + 1);
    onProjectMutated(`Tempo set to ${project.bpm} BPM`);
  });
  dom.bpmInput.addEventListener("change", () => {
    // An empty, zero or non-numeric entry keeps the current tempo instead of jumping to a default.
    const typed = Number(dom.bpmInput.value);
    if (!dom.bpmInput.value.trim() || !Number.isFinite(typed) || typed <= 0) {
      dom.bpmInput.value = project.bpm;
      return;
    }
    pushUndoState();
    project.bpm = Math.max(40, Math.min(260, typed));
    onProjectMutated(`Tempo set to ${project.bpm} BPM`);
  });

  undoOnGesture(dom.masterVol);
  dom.masterVol.addEventListener("input", () => {
    project.masterVolumeDb = Number(dom.masterVol.value);
    engine.syncTrackNodes(project);
    savePrefs();
  });

  dom.projectName.addEventListener("input", syncProjectNameLabel);
  dom.projectName.addEventListener("change", () => {
    project.name = dom.projectName.value.trim() || "Audius Studio Session";
    syncProjectNameLabel();
  });

  // Tools
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTool(btn.dataset.tool));
  });

  dom.snapSelect.addEventListener("change", () => {
    ui.snapBeats = Number(dom.snapSelect.value);
    setStatus(`Snap set to ${dom.snapSelect.options[dom.snapSelect.selectedIndex].text}`);
    drawAllCanvases();
    savePrefs();
  });

  // Segment Operations
  dom.btnSplitPlayhead.addEventListener("click", splitAtPlayhead);
  dom.btnCutHalf.addEventListener("click", cutSelectedClipInHalf);
  dom.btnChopBeat.addEventListener("click", () => chopSelectedClipsEvery(1));
  dom.btnChopBar.addEventListener("click", () => chopSelectedClipsEvery(4));
  dom.btnChopTransients.addEventListener("click", chopSelectedClipsByTransients);
  dom.btnDuplicateClip.addEventListener("click", duplicateSelectedClips);
  dom.btnReverseClip.addEventListener("click", reverseSelectedClips);
  dom.btnDeleteClip.addEventListener("click", deleteSelectedClips);
  dom.btnClearPlaylist.addEventListener("click", clearPlaylistClips);
  dom.btnClearPool.addEventListener("click", clearAllStemsAndClips);

  // Quick Nudge & Trim Bar
  dom.btnNudgeLeft.addEventListener("click", () => nudgeSelectedClips(-(ui.snapBeats || 0.5)));
  dom.btnNudgeRight.addEventListener("click", () => nudgeSelectedClips(ui.snapBeats || 0.5));
  dom.btnTrackUp.addEventListener("click", () => moveSelectedClipsTrack(-1));
  dom.btnTrackDown.addEventListener("click", () => moveSelectedClipsTrack(1));
  dom.btnTrimShorter.addEventListener("click", () => trimSelectedClipsLength(-(ui.snapBeats || 0.5)));
  dom.btnTrimLonger.addEventListener("click", () => trimSelectedClipsLength(ui.snapBeats || 0.5));
  dom.btnFadeQuick.addEventListener("click", () => {
    const clip = getPrimarySelectedClip();
    if (!clip) {
      setStatus("Select a clip first to toggle fades");
      return;
    }
    pushUndoState();
    const hasFade = (clip.fadeInBeats || 0) > 0 || (clip.fadeOutBeats || 0) > 0;
    clip.fadeInBeats = hasFade ? 0 : Math.min(0.5, clip.durationBeats * 0.25);
    clip.fadeOutBeats = hasFade ? 0 : Math.min(0.5, clip.durationBeats * 0.25);
    onProjectMutated(hasFade ? "Removed clip fades" : "Added smooth Fade In/Out");
  });

  dom.btnAddMarker.addEventListener("click", () => {
    const beat = snapBeat(engine.getPlayheadBeat(project));
    const label = prompt("Section Marker Name (e.g., Verse, Chorus, Drop):", "Section");
    if (label && label.trim()) {
      pushUndoState();
      project.markers.push({
        id: nextId("m"),
        beat,
        name: label.trim(),
        color: PALETTE[project.markers.length % PALETTE.length],
      });
      onProjectMutated(`Added marker "${label.trim()}"`);
    }
  });

  dom.btnUndo.addEventListener("click", undo);
  dom.btnRedo.addEventListener("click", redo);

  dom.zoomSlider.addEventListener("input", () => {
    ui.pixelsPerBeat = Number(dom.zoomSlider.value);
    drawAllCanvases();
    savePrefs();
  });

  dom.hscrollSlider.addEventListener("input", () => {
    ui.scrollBeat = Number(dom.hscrollSlider.value);
    drawAllCanvases();
  });

  // Add Track
  dom.btnAddTrack.addEventListener("click", () => {
    pushUndoState();
    const idx = project.tracks.length + 1;
    const color = PALETTE[(idx - 1) % PALETTE.length];
    const trk = {
      id: nextId("trk"),
      name: `${idx} · Audio Track`,
      color,
      muted: false,
      solo: false,
      volumeDb: 0,
      pan: 0,
      eqLowDb: 0,
      eqMidDb: 0,
      eqHighDb: 0,
    };
    project.tracks.push(trk);
    ui.selectedTrackId = trk.id;
    onProjectMutated(`Added ${trk.name}`);
  });

  // Import / Export / Save / Load
  dom.btnImportAudio.addEventListener("click", () => dom.fileImportInput.click());
  dom.dropzoneBox.addEventListener("click", () => dom.fileImportInput.click());
  // the playhead reset and the drop zone are click targets that are not buttons: give them a keyboard path
  [dom.timeReadoutBox, dom.dropzoneBox].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.code === "Space") {
        e.preventDefault();
        el.click();
      }
    });
  });
  dom.fileImportInput.addEventListener("change", async (e) => {
    await handleAudioFilesImport(e.target.files);
    dom.fileImportInput.value = "";
  });

  const libUpload = document.getElementById("btn-lib-upload");
  if (libUpload) libUpload.addEventListener("click", () => dom.fileImportInput.click());

  // A narrow Library (tablet sidebar) stacks the action labels under their icons.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      const w = dom.leftPanel.clientWidth;
      dom.leftPanel.classList.toggle("lib-narrow", w > 0 && w < 240);
    }).observe(dom.leftPanel);
  }

  // The drop zone stays out of the way until files are dragged over the Library.
  let libDragDepth = 0;
  const draggingFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf("Files") !== -1;
  const endLibDrag = () => {
    libDragDepth = 0;
    dom.leftPanel.classList.remove("is-file-drag");
  };
  dom.leftPanel.addEventListener("dragenter", (e) => {
    if (!draggingFiles(e)) return;
    libDragDepth += 1;
    dom.leftPanel.classList.add("is-file-drag");
  });
  dom.leftPanel.addEventListener("dragleave", (e) => {
    if (!draggingFiles(e)) return;
    libDragDepth = Math.max(0, libDragDepth - 1);
    if (libDragDepth === 0) endLibDrag();
  });
  dom.leftPanel.addEventListener("drop", endLibDrag);
  window.addEventListener("dragend", endLibDrag);

  dom.dropzoneBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    dom.dropzoneBox.classList.add("dragover");
  });
  dom.dropzoneBox.addEventListener("dragleave", () => {
    dom.dropzoneBox.classList.remove("dragover");
  });
  dom.dropzoneBox.addEventListener("drop", async (e) => {
    e.preventDefault();
    dom.dropzoneBox.classList.remove("dragover");
    const dropped = Array.from(e.dataTransfer.files || []);
    const midi = dropped.filter(isMidiFile);
    const audio = dropped.filter((f) => !isMidiFile(f));
    if (midi.length > 0) await importMidiFiles(midi);
    if (audio.length > 0) await handleAudioFilesImport(audio);
  });

  dom.btnLoadDemo.addEventListener("click", () => {
    pushUndoState();
    loadBuiltInDemoArrangement();
    setStatus("Restored demo session: " + DEMO_SONG.title + " (" + DEMO_SONG.bpm + " BPM)");
  });

  dom.btnExportModal.addEventListener("click", () => {
    dom.exportStatus.textContent = "";
    dom.exportModal.hidden = false;
  });
  dom.btnCloseExport.addEventListener("click", () => (dom.exportModal.hidden = true));
  dom.btnCancelExport.addEventListener("click", () => (dom.exportModal.hidden = true));
  dom.btnRunExport.addEventListener("click", executeExport);

  if (dom.btnImportMidi && dom.midiImportInput) {
    dom.btnImportMidi.addEventListener("click", () => dom.midiImportInput.click());
    dom.midiImportInput.addEventListener("change", async (e) => {
      await importMidiFiles(e.target.files);
      dom.midiImportInput.value = "";
    });
  }
  if (dom.btnExportMidi) {
    dom.btnExportMidi.addEventListener("click", () => exportMidiFile());
  }

  dom.btnSaveProj.addEventListener("click", saveProject);
  dom.btnLoadProj.addEventListener("click", openProjectsModal);
  dom.btnCloseProjects.addEventListener("click", () => (dom.projectsModal.hidden = true));
  dom.btnCancelProjects.addEventListener("click", () => (dom.projectsModal.hidden = true));
  dom.btnBrowseProjFile.addEventListener("click", () => dom.projectImportInput.click());
  dom.projectImportInput.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      loadProjectObject(JSON.parse(txt));
      dom.projectsModal.hidden = true;
    } catch (err) {
      setStatus(`Could not open project: ${err.message}`, { kind: "error" });
    }
    dom.projectImportInput.value = "";
  });

  // Clip Inspector Bindings
  const mutateSelectedClip = (fn, pushHist = false) => {
    const clip = getPrimarySelectedClip();
    if (!clip) return;
    if (pushHist) pushUndoState();
    fn(clip);
    updateClipInspector();
    if (engine.isPlaying) {
      engine.play(project, assets, engine.getPlayheadBeat(project));
    }
    drawAllCanvases();
  };

  dom.inspName.addEventListener("change", () =>
    mutateSelectedClip((c) => (c.name = dom.inspName.value), true)
  );
  dom.inspStart.addEventListener("change", () =>
    mutateSelectedClip((c) => (c.startBeat = Math.max(0, Number(dom.inspStart.value) || 0)), true)
  );
  dom.inspDuration.addEventListener("change", () =>
    mutateSelectedClip(
      (c) => (c.durationBeats = Math.max(0.125, Number(dom.inspDuration.value) || 1)),
      true
    )
  );
  dom.inspOffset.addEventListener("change", () =>
    mutateSelectedClip(
      (c) => (c.sourceOffsetSec = Math.max(0, Number(dom.inspOffset.value) || 0)),
      true
    )
  );
  undoOnGesture(dom.inspColor);
  dom.inspColor.addEventListener("input", () =>
    mutateSelectedClip((c) => (c.color = dom.inspColor.value))
  );
  undoOnGesture(dom.inspGain);
  dom.inspGain.addEventListener("input", () =>
    mutateSelectedClip((c) => (c.gainDb = Number(dom.inspGain.value)))
  );
  undoOnGesture(dom.inspPitch);
  dom.inspPitch.addEventListener("input", () =>
    mutateSelectedClip((c) => (c.pitchSemitones = Number(dom.inspPitch.value)))
  );
  undoOnGesture(dom.inspPan);
  dom.inspPan.addEventListener("input", () =>
    mutateSelectedClip((c) => (c.pan = Number(dom.inspPan.value)))
  );
  dom.inspFadeIn.addEventListener("change", () =>
    mutateSelectedClip((c) => (c.fadeInBeats = Math.max(0, Number(dom.inspFadeIn.value) || 0)), true)
  );
  dom.inspFadeOut.addEventListener("change", () =>
    mutateSelectedClip(
      (c) => (c.fadeOutBeats = Math.max(0, Number(dom.inspFadeOut.value) || 0)),
      true
    )
  );
  dom.inspReverse.addEventListener("change", () =>
    mutateSelectedClip((c) => (c.reverse = dom.inspReverse.checked), true)
  );
  dom.inspMuted.addEventListener("change", () =>
    mutateSelectedClip((c) => (c.muted = dom.inspMuted.checked), true)
  );

  dom.inspChop1Bar.addEventListener("click", () => chopSelectedClipsEvery(4));
  dom.inspChop2Beat.addEventListener("click", () => chopSelectedClipsEvery(2));
  dom.inspChop1Beat.addEventListener("click", () => chopSelectedClipsEvery(1));
  dom.inspChopHalfBeat.addEventListener("click", () => chopSelectedClipsEvery(0.5));
  dom.inspChopTrans.addEventListener("click", chopSelectedClipsByTransients);
  dom.inspResetTrim.addEventListener("click", () => {
    mutateSelectedClip((c) => {
      const asset = assets.get(c.assetId);
      if (asset) {
        c.sourceOffsetSec = 0;
        c.durationBeats = Number((asset.durationSec * (project.bpm / 60)).toFixed(3));
      }
    }, true);
  });

  // Track EQ Bindings
  const mutateTrackEq = () => {
    const trk = project.tracks.find((t) => t.id === ui.selectedTrackId);
    if (!trk) return;
    trk.eqLowDb = Number(dom.trkEqLow.value);
    trk.eqMidDb = Number(dom.trkEqMid.value);
    trk.eqHighDb = Number(dom.trkEqHigh.value);
    updateTrackInspector();
    engine.syncTrackNodes(project);
  };
  dom.trkEqLow.addEventListener("input", mutateTrackEq);
  dom.trkEqMid.addEventListener("input", mutateTrackEq);
  dom.trkEqHigh.addEventListener("input", mutateTrackEq);

  if (dom.btnTypingPiano) {
    dom.btnTypingPiano.addEventListener("click", () => {
      ui.typingPiano = !ui.typingPiano;
      setLit(dom.btnTypingPiano, ui.typingPiano);
      savePrefs();
      setStatus(
        ui.typingPiano
          ? "Typing keyboard: on (Z–M and Q–P play the active stem chromatically)"
          : "Typing keyboard: off (P/B/C/D/T/S/E switch Playlist tools)"
      );
    });
  }

  if (dom.btnFlShortcuts && dom.shortcutsModal) {
    dom.btnFlShortcuts.addEventListener("click", () => (dom.shortcutsModal.hidden = false));
  }
  if (dom.btnCloseShortcuts) {
    dom.btnCloseShortcuts.addEventListener("click", () => (dom.shortcutsModal.hidden = true));
  }
  if (dom.btnOkShortcuts) {
    dom.btnOkShortcuts.addEventListener("click", () => (dom.shortcutsModal.hidden = true));
  }

  // Global Audius Studio Keyboard Shortcuts & Typing-to-Piano Controller
  window.addEventListener("keydown", (e) => {
    // Focus decides who owns the key: text fields keep typing, Enter commits and Escape reverts;
    // dropdowns and sliders keep their navigation keys; a control reached with the keyboard keeps
    // Space and Enter. Everything else runs the shortcut, whatever has focus.
    const focused = document.activeElement;
    const tag = focused ? focused.tagName : "";
    if (isTextEntry(focused)) {
      if (e.key === "Enter" && tag === "INPUT") {
        e.preventDefault();
        focused.blur();
        return;
      }
      if (e.key === "Escape") {
        if (focused.dataset.revertValue !== undefined && focused.value !== focused.dataset.revertValue) {
          focused.value = focused.dataset.revertValue;
          focused.dispatchEvent(new Event("input", { bubbles: true }));
          focused.dispatchEvent(new Event("change", { bubbles: true }));
        }
        focused.blur();
      } else if (!/^F\d{1,2}$/.test(e.key)) {
        return;
      }
    } else if (tag === "SELECT") {
      if (e.code === "Space" || SELECT_KEYS.has(e.key)) return;
    } else if (focused && focused.type === "range") {
      if (RANGE_KEYS.has(e.key)) {
        if (e.shiftKey && (e.key.startsWith("Arrow"))) {
          // Shift+Arrow moves a slider ten steps
          e.preventDefault();
          const up = e.key === "ArrowRight" || e.key === "ArrowUp";
          if (up) focused.stepUp(10);
          else focused.stepDown(10);
          fireRangeEvents(focused);
        }
        return;
      }
    } else if (isKeyboardActivatable(focused) && (e.code === "Space" || e.key === "Enter") && focusArrivedByKeyboard) {
      // Reached by keyboard: Space / Enter press the focused control. A mouse-clicked control
      // falls through, so Space still plays and stops.
      return;
    }
    // While a dialog is open the rest of the app stays on the keyboard:
    // Space must not start the transport behind the modal. Escape still
    // closes the dialog (handled below), everything else waits.
    if (
      (dom.shortcutsModal && !dom.shortcutsModal.hidden) ||
      (dom.exportModal && !dom.exportModal.hidden) ||
      (dom.projectsModal && !dom.projectsModal.hidden)
    ) {
      if (e.key !== "Escape") return;
    }
    if (e.key === "Escape") hideTooltipNow();
    if (e.repeat && !e.key.startsWith("Arrow")) return;

    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    // F1 or ? -> Open Audius Studio Shortcuts Reference
    if (e.key === "F1" || (e.shiftKey && e.key === "?")) {
      e.preventDefault();
      if (dom.shortcutsModal) dom.shortcutsModal.hidden = !dom.shortcutsModal.hidden;
      return;
    }

    // Escape -> Close any open modal or floating context menu
    if (e.key === "Escape") {
      if (dom.shortcutsModal) dom.shortcutsModal.hidden = true;
      if (dom.exportModal) dom.exportModal.hidden = true;
      if (dom.projectsModal) dom.projectsModal.hidden = true;
      if (dom.clipContextMenu) dom.clipContextMenu.hidden = true;
      return;
    }

    // Ctrl + S -> Save Project · Ctrl + O -> Open Project dialog
    if (ctrl && k === "s") {
      e.preventDefault();
      saveProject();
      return;
    }
    if (ctrl && k === "o") {
      e.preventDefault();
      openProjectsModal();
      return;
    }

    // Audius Ranked Window Function Keys: F5 (Playlist Layout), F6 (Step Rack), F7 (Piano Roll), F8 (Library), F9 (Mixer)
    if (e.key === "F5") {
      e.preventDefault();
      if (dom.btnLayoutPreset) dom.btnLayoutPreset.click();
      return;
    }
    if (e.key === "F6") {
      e.preventDefault();
      if (dom.btnToggleChannelRack) dom.btnToggleChannelRack.click();
      return;
    }
    if (e.key === "F7") {
      e.preventDefault();
      if (dom.btnTogglePianoRoll) dom.btnTogglePianoRoll.click();
      return;
    }
    if (e.key === "F8") {
      e.preventDefault();
      dom.btnTogglePool.click();
      return;
    }
    if (e.key === "F9") {
      e.preventDefault();
      if (dom.btnToggleMixer) dom.btnToggleMixer.click();
      return;
    }

    // Space -> Start / Stop Playback
    if (e.code === "Space") {
      e.preventDefault();
      dom.btnPlay.click();
      return;
    }

    // Home -> Return Playhead to Bar 1
    if (e.key === "Home") {
      e.preventDefault();
      engine.seek(project, assets, 0);
      ui.scrollBeat = 0;
      setRange(dom.hscrollSlider, 0);
      drawAllCanvases();
      setStatus("Playhead returned to Bar 1 (Home)");
      return;
    }

    // Ctrl + T -> Toggle Audius Typing Keyboard to Piano Keyboard
    if (ctrl && k === "t") {
      e.preventDefault();
      if (dom.btnTypingPiano) dom.btnTypingPiano.click();
      return;
    }

    // Alt + T -> Add Time Marker at Playhead (Audius Ranked shortcut)
    if (e.altKey && k === "t") {
      e.preventDefault();
      dom.btnAddMarker.click();
      return;
    }

    // Ctrl + Z / Ctrl + Alt + Z -> Undo; Ctrl + Y / Ctrl + Shift + Z -> Redo
    if (ctrl && k === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && k === "y") {
      e.preventDefault();
      redo();
      return;
    }

    // Ctrl + A -> Select All Clips
    if (ctrl && k === "a") {
      e.preventDefault();
      ui.selectedClipIds = new Set(project.clips.map((c) => c.id));
      updateClipInspector();
      drawAllCanvases();
      setStatus(`Selected all ${project.clips.length} clips (Ctrl+A)`);
      return;
    }

    // Ctrl + Shift + D -> Deselect All Clips
    if (ctrl && e.shiftKey && k === "d") {
      e.preventDefault();
      ui.selectedClipIds.clear();
      updateClipInspector();
      drawAllCanvases();
      setStatus("Deselected all clips");
      return;
    }

    // Ctrl + B or Ctrl + D -> Audius Ranked Latch-Duplicate Selected Clips
    if (ctrl && (k === "b" || k === "d")) {
      e.preventDefault();
      duplicateSelectedClips();
      return;
    }

    // Ctrl + C / Ctrl + X / Ctrl + V -> Copy / Cut / Paste Clips
    if (ctrl && k === "c") {
      const sel = getTargetClipsForOperation();
      if (sel.length > 0) {
        e.preventDefault();
        ui.clipboardClips = JSON.parse(JSON.stringify(sel));
        setStatus(`Copied ${sel.length} clip(s) (Ctrl+C)`);
      }
      return;
    }
    if (ctrl && k === "x") {
      const sel = getTargetClipsForOperation();
      if (sel.length > 0) {
        e.preventDefault();
        ui.clipboardClips = JSON.parse(JSON.stringify(sel));
        deleteSelectedClips();
        setStatus(`Cut ${sel.length} clip(s) (Ctrl+X)`);
      }
      return;
    }
    if (ctrl && k === "v") {
      if (ui.clipboardClips.length > 0) {
        e.preventDefault();
        pushUndoState();
        const minStart = Math.min(...ui.clipboardClips.map((c) => c.startBeat));
        const pasteBeat = snapBeat(engine.getPlayheadBeat(project));
        const newSel = new Set();
        for (const c of ui.clipboardClips) {
          const copy = {
            ...c,
            id: nextId("clip"),
            startBeat: Number(Math.max(0, pasteBeat + (c.startBeat - minStart)).toFixed(4)),
          };
          project.clips.push(copy);
          newSel.add(copy.id);
        }
        ui.selectedClipIds = newSel;
        onProjectMutated(`Pasted ${ui.clipboardClips.length} clip(s) at Playhead`);
      }
      return;
    }

    // Delete -> Delete Selected Clips; Backspace -> Delete Clips OR Toggle Grid Snap (Audius Ranked Backspace!)
    if (e.key === "Delete") {
      e.preventDefault();
      deleteSelectedClips();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (ui.selectedClipIds.size > 0 && !e.altKey) {
        deleteSelectedClips();
      } else {
        if (ui.snapBeats > 0) {
          ui.lastSnapBeats = ui.snapBeats;
          ui.snapBeats = 0;
          dom.snapSelect.value = "0";
          setStatus("Audius Snap Toggled: OFF (Free)");
        } else {
          ui.snapBeats = ui.lastSnapBeats || 0.5;
          dom.snapSelect.value = String(ui.snapBeats);
          setStatus(`Audius Snap Toggled: ON (${ui.snapBeats} Beat)`);
        }
        drawAllCanvases();
      }
      return;
    }

    // Insert -> Slice Clip at Playhead / Cursor (Audius Ranked Insert shortcut)
    if (e.key === "Insert") {
      e.preventDefault();
      splitAtPlayhead();
      return;
    }

    // Arrow Keys: Nudge Left/Right, Move Track Up/Down, or Pitch Shift (Shift/Ctrl + Up/Down)
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudgeSelectedClips(-(e.shiftKey ? (ui.snapBeats || 0.25) : (ui.snapBeats || 0.5)));
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      nudgeSelectedClips(e.shiftKey ? (ui.snapBeats || 0.25) : (ui.snapBeats || 0.5));
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      if (e.shiftKey || ctrl) {
        const stepSt = ctrl ? 12 * dir : 1 * dir;
        const targets = getTargetClipsForOperation();
        if (targets.length > 0) {
          pushUndoState();
          for (const c of targets) {
            c.pitchSemitones = Math.max(-24, Math.min(24, (c.pitchSemitones || 0) + stepSt));
          }
          onProjectMutated(`Transposed clip pitch ${stepSt > 0 ? "+" : ""}${stepSt} st`);
        }
      } else {
        moveSelectedClipsTrack(-dir);
      }
      return;
    }

    // PageUp / PageDown -> Timeline Zoom In / Out
    if (e.key === "PageUp") {
      e.preventDefault();
      ui.pixelsPerBeat = Math.min(160, Math.round(ui.pixelsPerBeat * 1.2));
      setRange(dom.zoomSlider, ui.pixelsPerBeat);
      drawAllCanvases();
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      ui.pixelsPerBeat = Math.max(18, Math.round(ui.pixelsPerBeat * 0.83));
      setRange(dom.zoomSlider, ui.pixelsPerBeat);
      drawAllCanvases();
      return;
    }

    // If Audius Typing Keyboard to Piano is active (Ctrl+T), play chromatic notes!
    if (ui.typingPiano && !ctrl && !e.altKey && FL_PIANO_MAP[k]) {
      e.preventDefault();
      const [stOffset, noteName] = FL_PIANO_MAP[k];
      const typingAsset = assets.get(ui.activeAssetId || assets.keys().next().value);
      if (typingAsset && typingAsset.instrumentId) {
        // Synth channels hold the note until the key comes back up (keyup below).
        instruments.typingNoteOn(typingAsset, stOffset, k);
        setStatus(`Typing keyboard: ${noteName} · ${typingAsset.name}`);
        return;
      }
      triggerTypingPianoNote(stOffset, noteName);
      return;
    }

    // Audius Ranked Single-Key Playlist Tools & Transport
    if (k === "p" || k === "1") setActiveTool("draw");
    else if (k === "b") setActiveTool("paint");
    else if (k === "c" || k === "2") setActiveTool("slice");
    else if (k === "s" || k === "3") setActiveTool("slip");
    else if (k === "t" || k === "4") setActiveTool("mute");
    else if (k === "e" || k === "5") setActiveTool("select");
    else if (k === "d" || k === "6") setActiveTool("delete");
    else if (k === "k") splitAtPlayhead();
    else if (k === "r") reverseSelectedClips();
    else if (k === "l") dom.btnLoop.click();
    else if (k === "m") dom.btnMetro.click();
  });

  // Synth notes started from the typing keyboard end on key-up (or when the window loses focus).
  window.addEventListener("keyup", (e) => {
    if (e.key) instruments.typingNoteOff(e.key.toLowerCase());
  });
  window.addEventListener("blur", () => instruments.releaseTyping());

  window.addEventListener("resize", () => {
    // A rotation or zoom can move a device across the touch pointer boundary,
    // which changes the ruler height the lanes are aligned to.
    const coarse = window.matchMedia("(pointer: coarse), (hover: none)").matches;
    const nextRuler = coarse ? 44 : 34;
    if (nextRuler !== ui.rulerHeight) {
      ui.rulerHeight = nextRuler;
      renderTrackHeaders();
    }
    drawAllCanvases();
  });
}

function setActiveTool(toolName) {
  ui.tool = toolName;
  document.querySelectorAll(".tool-btn").forEach((b) => {
    setLit(b, b.dataset.tool === toolName);
  });
  syncToolPicker();
  setStatus(`Active tool: ${toolName.toUpperCase()}`);
  drawAllCanvases();
  savePrefs();
}

/** Bottom-bar position read-out; a shorter form when the full one would be cut off. */
// Phones show the snap value in short form ("1/8") so the Snap button stays narrow.
function syncSnapLabels() {
  const short = compactLayoutQuery.matches;
  document.querySelectorAll("#snap-select option").forEach((opt) => {
    const label = short ? opt.dataset.short : opt.dataset.long;
    if (label && opt.textContent !== label) opt.textContent = label;
  });
}

let lastCursorInfo = [1, 1];
function setCursorInfo(barNum, beatInBar) {
  const el = dom.cursorInfo;
  if (!el) return;
  lastCursorInfo = [barNum, beatInBar];
  const snap = ui.snapBeats ? `${ui.snapBeats} Beat` : "Free";
  const full = `Bar ${barNum}, Beat ${beatInBar.toFixed(2)} · Snap: ${snap}`;
  el.textContent = full;
  el.title = full;
  if (el.scrollWidth > el.clientWidth + 1) {
    el.textContent = `Bar ${barNum} · Beat ${beatInBar.toFixed(2)}`;
  }
}

/**
 * Phones show one tool button (the current tool); tapping it opens the full tool strip as a
 * popover. Picking a tool, tapping outside or pressing Escape closes it.
 */
function syncToolPicker() {
  const picker = document.getElementById("tool-picker");
  const active = document.querySelector(`.tool-btn[data-tool="${ui.tool}"]`);
  if (!picker || !active) return;
  const use = active.querySelector("use");
  const pickerUse = picker.querySelector("use");
  if (use && pickerUse) pickerUse.setAttribute("href", use.getAttribute("href"));
  const name = (active.querySelector(".tool-label") || active).textContent.trim().split(/\s+/)[0];
  picker.setAttribute("aria-label", `Tools: ${name}`);
}

/**
 * PHONE "MORE" SHEET
 * Portrait phones keep one row on top (logo, play, stop, tempo, More) and the window
 * tabs at the bottom. The other controls move, as the same elements, into the More
 * sheet, grouped; a selected clip puts its actions first. Larger screens get them back.
 */
function setupMoreSheet() {
  const wrap = document.getElementById("more-sheet-wrap");
  const btn = document.getElementById("btn-more");
  const sheet = document.getElementById("more-sheet");
  if (!wrap || !btn || !sheet) return;
  const query = window.matchMedia("(max-width: 760px) and (min-height: 521px)");
  const slot = (name) => wrap.querySelector(`[data-slot="${name}"]`);
  const byId = (id) => document.getElementById(id);
  const clipSection = wrap.querySelector('[data-more="clip"]');
  const clipTitle = byId("more-clip-title");
  const moved = [];
  const move = (node, target) => {
    if (!node || !target) return;
    moved.push({ node, parent: node.parentNode, next: node.nextSibling });
    target.appendChild(node);
  };

  function close() {
    if (wrap.hidden) return;
    wrap.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function open() {
    const n = ui.selectedClipIds.size;
    clipSection.hidden = n === 0;
    if (clipTitle) clipTitle.textContent = n > 1 ? `${n} selected clips` : "Selected clip";
    wrap.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    sheet.scrollTop = 0;
    sheet.focus({ preventScroll: true });
  }

  function apply(on) {
    if (on && !moved.length) {
      move(byId("tool-strip"), slot("tools"));
      move(document.querySelector(".snap-cluster"), slot("edit"));
      ["btn-undo", "btn-redo", "btn-add-marker"].forEach((id) => move(byId(id), slot("edit")));
      move(document.querySelector(".pat-song-stack"), slot("playback"));
      ["btn-loop", "btn-metro", "btn-typing-piano"].forEach((id) => move(byId(id), slot("playback")));
      move(document.querySelector(".transport-readouts-content"), slot("readouts"));
      ["btn-split-playhead", "btn-cut-half", "btn-chop-beat", "btn-chop-bar", "btn-chop-transients", "btn-duplicate-clip", "btn-reverse-clip", "btn-delete-clip"].forEach((id) => move(byId(id), slot("clip")));
      move(byId("btn-clear-playlist"), slot("project"));
      move(byId("window-strip"), byId("app-shell"));
    } else if (!on && moved.length) {
      close();
      for (let i = moved.length - 1; i >= 0; i--) {
        const { node, parent, next } = moved[i];
        parent.insertBefore(node, next && next.parentNode === parent ? next : null);
      }
      moved.length = 0;
    }
    document.body.classList.toggle("phone-more", on);
  }

  btn.addEventListener("click", () => (wrap.hidden ? open() : close()));
  wrap.addEventListener("click", (e) => {
    if (e.target.closest("[data-more-close]")) return close();
    // Picking a tool or running a clip / project action closes the sheet; toggles stay open.
    if (e.target.closest(".tool-btn, [data-slot='clip'] button, [data-slot='project'] button")) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wrap.hidden) {
      close();
      btn.focus({ preventScroll: true });
    }
  });
  byId("more-settings")?.addEventListener("click", () => {
    const menu = byId("options-menu");
    if (menu) menu.open = true;
  });

  apply(query.matches);
  if (query.addEventListener) query.addEventListener("change", (e) => apply(e.matches));
}

function setupToolPicker() {
  const picker = document.getElementById("tool-picker");
  const strip = document.getElementById("tool-strip");
  if (!picker || !strip) return;
  const setOpen = (open) => {
    strip.classList.toggle("is-open", open);
    picker.setAttribute("aria-expanded", String(open));
    setLit(picker, open);
  };
  picker.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!strip.classList.contains("is-open"));
  });
  strip.addEventListener("click", (e) => {
    if (e.target.closest(".tool-btn")) setOpen(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (strip.classList.contains("is-open") && !strip.contains(e.target) && !picker.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && strip.classList.contains("is-open")) setOpen(false);
  });
  syncToolPicker();
}

function drawOscilloscope(isPlaying, leftLevel, rightLevel, beat) {
  const c = dom.oscCanvas;
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width;
  const h = c.height;
  const theme = getActiveTheme();
  ctx.fillStyle = theme.oscBg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = isPlaying ? theme.oscLine : hexToRgba(theme.oscLine, 0.45);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const amp = isPlaying ? Math.max(0.15, Math.min(0.95, (leftLevel + rightLevel) * 0.8)) : 0.04;
  // With reduced motion the trace holds still; its height still follows the level.
  const phase = reducedMotionQuery.matches ? 0 : performance.now() * 0.015;
  for (let x = 0; x < w; x++) {
    const t = (x / w) * Math.PI * 4;
    const y =
      h / 2 +
      (Math.sin(t + phase) * 0.65 + Math.sin(t * 2.7 - phase * 1.4) * 0.35) * (h * 0.42 * amp);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Animation loop for Playhead, Readout, Oscilloscope, Channel Rack Step Cursor & Peak Meters
 */
let lastLoopWrapCheck = 0;
let lastPulsedBeat = -1;
let gateUi = null; // Gate Shaper window controller (see gate-shaper-ui.js)
let fxUi = null; // WASM effect plugin UI (see wasm-fx-ui.js)
function animationTick() {
  const beat = engine.getPlayheadBeat(project);
  const sec = beat * (60 / project.bpm);
  dom.readoutBars.textContent = formatBeatBar(beat);
  dom.readoutTime.textContent = formatSeconds(sec);

  if (engine.isPlaying) {
    const beatIndex = Math.floor(beat);
    if (beatIndex !== lastPulsedBeat) {
      lastPulsedBeat = beatIndex;
      pulseBeat(beatIndex);
    }
    if (project.loopEnabled && beat < lastLoopWrapCheck - 0.5) {
      engine.play(project, assets, project.loopStartBeat);
    }
    lastLoopWrapCheck = beat;

    const { left, right } = engine.getMasterLevels();
    dom.meterL.style.width = `${Math.min(100, Math.round(left * 115))}%`;
    dom.meterR.style.width = `${Math.min(100, Math.round(right * 115))}%`;
    drawOscilloscope(true, left, right, beat);
    if (gateUi && gateUi.isOpen()) gateUi.drawFrame();

    // Highlight active 16th-note step in Channel Rack
    const activeStep = Math.floor((beat * 4) % 16);
    document.querySelectorAll(".cr-step").forEach((el) => {
      el.classList.toggle("playing-step", Number(el.dataset.stepIndex) === activeStep);
    });

    document.querySelectorAll("[data-track-meter]").forEach((el) => {
      const lvl = engine.getTrackLevel(el.dataset.trackMeter);
      el.style.width = `${Math.min(100, Math.round(lvl * 120))}%`;
    });

    document.querySelectorAll("[data-mixer-meter]").forEach((el) => {
      const id = el.dataset.mixerMeter;
      const lvl = id === "master" ? (left + right) * 0.55 : engine.getTrackLevel(id);
      el.style.height = `${Math.max(6, Math.min(100, Math.round(lvl * 125)))}%`;
    });

    drawAllCanvases();
  } else {
    lastLoopWrapCheck = beat;
    lastPulsedBeat = -1;
    dom.meterL.style.width = "2%";
    dom.meterR.style.width = "2%";
    drawOscilloscope(false, 0, 0, beat);
    if (gateUi && gateUi.isOpen()) gateUi.drawFrame();
  }

  // Read-only diagnostics for the verification harnesses and for support reports.
// It returns plain data and exposes no setters: every change still goes through
// the UI, the keyboard or the API bridge.
window.audiusStudioInfo = () => ({
  version: "1.0.0",
  build: "2026-10-21",
  tracks: project.tracks.length,
  patterns: ui.patterns.length,
  selectedTrackId: ui.selectedTrackId,
  liveVoices: engine.liveVoices.size,
  playing: engine.isPlaying,
  levels: engine.getMasterLevels(),
  fxRebuilds: engine.fxRebuildCount || 0,
  fxChains: Array.from(engine.fxChains.entries()).map(([key, chain]) => ({
    key,
    signature: chain.signature,
    slots: chain.slots.map((item) => ({ id: item.slot.id, type: item.slot.type })),
  })),
  plugins: {
    insert: (project.tracks.find((t) => t.id === ui.selectedTrackId) || {}).fxPlugins || [],
    master: project.masterFxPlugins || [],
  },
});

requestAnimationFrame(animationTick);
}

/**
 * DAW API — operation handlers executed inside the live page.
 *
 * The local server (app/server.mjs) exposes these as api-anything style
 * operations: POST /api/call {"op":"chopClips","args":{"preset":"1bar"}}.
 * The catalog with every param spec lives in app/api/operations.json;
 * handler names must match it. Each handler reuses the exact code paths the
 * UI uses (undo snapshots, inspector clamps, engine sync), so an API call and
 * a click leave the session in the same state.
 */
function buildApiBridgeHandlers() {
  const CLIP_FIELDS = ["gainDb", "pitchSemitones", "pan", "fadeInBeats", "fadeOutBeats", "reverse", "muted", "color", "name", "playbackRate"];
  const CHOP_PRESETS = { "1beat": 1, "1bar": 4, halfbar: 2, eighth: 0.5 };

  const clipInfo = (c) => ({ ...c, endBeat: Number((c.startBeat + c.durationBeats).toFixed(4)) });
  const trackInfo = (t) => ({
    ...t,
    index: project.tracks.indexOf(t),
    clipCount: project.clips.filter((c) => c.trackId === t.id).length,
  });
  const assetInfo = (a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    durationSec: Number(a.durationSec.toFixed(3)),
    sampleRate: a.sampleRate,
    channels: a.buffer ? a.buffer.numberOfChannels : 0,
    firstOnsetSec: Number((a.firstOnsetSec || 0).toFixed(3)),
  });
  const transportInfo = () => {
    const beat = engine.getPlayheadBeat(project);
    return {
      playing: engine.isPlaying,
      beat: Number(beat.toFixed(3)),
      bar: beat / 4,
      seconds: Number((beat * (60 / project.bpm)).toFixed(3)),
      position: formatBeatBar(beat),
      bpm: project.bpm,
      loopEnabled: !!project.loopEnabled,
      loopStartBeat: project.loopStartBeat,
      loopEndBeat: project.loopEndBeat,
      metronome: !!project.metronome,
      transportMode: ui.transportMode,
    };
  };

  const findTrack = (trackId) => {
    const t = project.tracks.find((x) => x.id === trackId);
    if (!t) throw apiError("input", `no track with id "${trackId}"`, "getTracks lists every track id");
    return t;
  };
  const findClip = (clipId) => {
    const c = project.clips.find((x) => x.id === clipId);
    if (!c) throw apiError("input", `no clip with id "${clipId}"`, "getClips lists every clip id");
    return c;
  };
  /** clipIds arg when given, else the live playlist selection. */
  const resolveClips = (args, opts) => {
    const o = opts || {};
    let clips;
    if (Array.isArray(args.clipIds)) clips = args.clipIds.map((id) => findClip(String(id)));
    else clips = project.clips.filter((c) => ui.selectedClipIds.has(c.id));
    if (o.all && clips.length === 0) clips = project.clips.slice();
    if (!o.optional && clips.length === 0) {
      throw apiError(
        "input",
        "no clips targeted: pass clipIds or select clips first",
        "selectClips sets the selection; getClips lists every clip id"
      );
    }
    return clips;
  };
  const setSelection = (clips) => {
    ui.selectedClipIds = new Set(clips.map((c) => c.id));
  };
  const stopTransportIfNeeded = () => {
    if (engine.isPlaying) {
      engine.stop(project);
      dom.btnPlay.classList.remove("playing");
      setPlayIcon(false);
    }
  };

  return {
    // ---------- session & project ----------
    getSession: async () => ({
      project: cloneProjectState(project),
      transport: transportInfo(),
      ui: {
        tool: ui.tool,
        snapBeats: ui.snapBeats,
        selectedTrackId: ui.selectedTrackId,
        selectedClipIds: Array.from(ui.selectedClipIds),
        activePatternIndex: ui.activePatternIndex,
        patterns: ui.patterns.map((p) => p.name),
      },
      assets: Array.from(assets.values()).map(assetInfo),
      counts: {
        tracks: project.tracks.length,
        clips: project.clips.length,
        markers: project.markers.length,
        assets: assets.size,
      },
      history: { undoDepth: undoStack.length, redoDepth: redoStack.length },
    }),
    getTransport: async () => transportInfo(),
    getTracks: async () => ({ tracks: project.tracks.map(trackInfo) }),
    getClips: async (args) => {
      let clips = project.clips;
      if (args.trackId != null) {
        findTrack(args.trackId);
        clips = clips.filter((c) => c.trackId === args.trackId);
      }
      if (Array.isArray(args.clipIds)) {
        const wanted = args.clipIds.map((id) => findClip(String(id)).id);
        clips = clips.filter((c) => wanted.includes(c.id));
      }
      return { clips: clips.map(clipInfo) };
    },
    getAssets: async () => ({ assets: Array.from(assets.values()).map(assetInfo) }),
    getMarkers: async () => ({ markers: project.markers.map((m) => ({ ...m })) }),
    getMeters: async () => ({
      playing: engine.isPlaying,
      master: engine.getMasterLevels(),
      tracks: project.tracks.map((t) => ({ trackId: t.id, name: t.name, level: engine.getTrackLevel(t.id) })),
    }),
    listProjects: async () => {
      const out = [];
      const local = getLocalSavedProjects();
      for (const key of Object.keys(local)) {
        out.push({ name: key, source: "browser", updatedAt: local[key].updatedAt || null });
      }
      try {
        const r = await fetch("/api/projects", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          for (const p of j.projects || []) {
            const existing = out.filter((o) => o.name === p.name)[0];
            if (existing) {
              existing.source = "both";
              existing.fileName = p.fileName;
              if (p.updatedAt) existing.updatedAt = p.updatedAt;
            } else {
              out.push({ name: p.name, source: "server", updatedAt: p.updatedAt, fileName: p.fileName });
            }
          }
        }
      } catch (_) {}
      out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      return { projects: out };
    },
    newSession: async (args) => {
      pushUndoState();
      stopTransportIfNeeded();
      assets.clear();
      const bpm = args.bpm != null ? Math.max(40, Math.min(260, Number(args.bpm) || 124)) : 124;
      const trkId = nextId("trk");
      project = {
        name: String(args.name || "Audius Studio Session").slice(0, 120) || "Audius Studio Session",
        bpm,
        masterVolumeDb: 0,
        loopEnabled: true,
        loopStartBeat: 0,
        loopEndBeat: 16,
        metronome: false,
        markers: [],
        tracks: [
          {
            id: trkId,
            name: "1 · Audio Track",
            color: PALETTE[0],
            muted: false,
            solo: false,
            volumeDb: 0,
            pan: 0,
            eqLowDb: 0,
            eqMidDb: 0,
            eqHighDb: 0,
          },
        ],
        clips: [],
      };
      ui.selectedClipIds.clear();
      ui.selectedTrackId = trkId;
      renderAssetPool();
      onProjectMutated(`New session "${project.name}" created via API`);
      return { name: project.name, bpm, tracks: 1, clips: 0 };
    },
    loadDemo: async () => {
      pushUndoState();
      stopTransportIfNeeded();
      loadBuiltInDemoArrangement();
      onProjectMutated("Demo session restored via API");
      return {
        name: project.name,
        bpm: project.bpm,
        tracks: project.tracks.length,
        clips: project.clips.length,
        assets: assets.size,
      };
    },
    saveProject: async (args) => {
      if (args.name != null && String(args.name).trim()) {
        project.name = String(args.name).trim().slice(0, 120);
      }
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        ...project,
        patterns: cloneProjectState(ui.patterns),
        activePatternIndex: ui.activePatternIndex,
      };
      const stored = saveLocalProjectEntry(project.name, payload);
      let server = false;
      try {
        const r = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        server = !!r.ok;
      } catch (_) {}
      dom.projectName.value = project.name;
      syncProjectNameLabel();
      setStatus(`Saved project "${project.name}" via API`);
      if (!stored && !server) {
        throw apiError(
          "error",
          "could not save: browser storage refused the write and the local server did not answer",
          "run npm start so /api/projects exists, or keep the project payload from getSession"
        );
      }
      return {
        name: project.name,
        fileName: `${safeFileName(project.name)}.dawproj.json`,
        saved: { browser: stored, server },
      };
    },
    loadProject: async (args) => {
      let payload = null;
      if (args.project && typeof args.project === "object") {
        payload = args.project;
      } else if (args.name) {
        const local = getLocalSavedProjects();
        if (local[args.name] && local[args.name].payload) {
          payload = local[args.name].payload;
        } else {
          try {
            const r = await fetch(`/api/projects/${encodeURIComponent(args.name)}`, { cache: "no-store" });
            if (r.ok) payload = await r.json();
          } catch (_) {}
        }
        if (!payload) {
          throw apiError(
            "input",
            `no saved project named "${args.name}"`,
            "listProjects shows browser and server saves; putProjectFile writes one to server disk"
          );
        }
      } else {
        throw apiError("input", 'pass name (a saved project) or project (a payload object)', "getSession returns the payload shape");
      }
      if (!payload || !Array.isArray(payload.tracks) || !Array.isArray(payload.clips)) {
        throw apiError("input", "the project payload needs tracks[] and clips[]", "getSession returns the payload shape");
      }
      loadProjectObject(payload);
      return { name: project.name, bpm: project.bpm, tracks: project.tracks.length, clips: project.clips.length };
    },
    setProjectInfo: async (args) => {
      const fields = ["name", "bpm", "masterVolumeDb", "metronome", "loopEnabled", "loopStartBeat", "loopEndBeat"];
      if (!fields.some((f) => args[f] != null)) {
        throw apiError("input", "pass at least one field to change", fields.join(", "));
      }
      pushUndoState();
      if (args.name != null) project.name = String(args.name).slice(0, 120) || project.name;
      if (args.bpm != null) project.bpm = Math.max(40, Math.min(260, Number(args.bpm) || project.bpm));
      if (args.masterVolumeDb != null) project.masterVolumeDb = clampNum(args.masterVolumeDb, -36, 6, project.masterVolumeDb ?? 0);
      if (args.metronome != null) project.metronome = !!args.metronome;
      if (args.loopEnabled != null) project.loopEnabled = !!args.loopEnabled;
      if (args.loopStartBeat != null) project.loopStartBeat = Math.max(0, Number(args.loopStartBeat) || 0);
      if (args.loopEndBeat != null) project.loopEndBeat = Math.max(0, Number(args.loopEndBeat) || 0);
      onProjectMutated("Session settings updated via API");
      return {
        name: project.name,
        bpm: project.bpm,
        masterVolumeDb: project.masterVolumeDb,
        metronome: !!project.metronome,
        loopEnabled: !!project.loopEnabled,
        loopStartBeat: project.loopStartBeat,
        loopEndBeat: project.loopEndBeat,
      };
    },
    undo: async () => {
      const before = undoStack.length;
      undo();
      return { changed: undoStack.length !== before, undoDepth: undoStack.length, redoDepth: redoStack.length };
    },
    redo: async () => {
      const before = redoStack.length;
      redo();
      return { changed: redoStack.length !== before, undoDepth: undoStack.length, redoDepth: redoStack.length };
    },

    // ---------- transport ----------
    play: async (args) => {
      const from = args.fromBeat != null ? Math.max(0, Number(args.fromBeat) || 0) : null;
      if (from != null) engine.play(project, assets, from);
      else if (!engine.isPlaying) engine.play(project, assets);
      dom.btnPlay.classList.add("playing");
      setPlayIcon(true);
      setStatus("Playing arrangement…");
      return transportInfo();
    },
    pause: async () => {
      if (engine.isPlaying) {
        engine.pause(project);
        dom.btnPlay.classList.remove("playing");
        setPlayIcon(false);
        setStatus("Paused");
      }
      return transportInfo();
    },
    stop: async () => {
      engine.stop(project);
      dom.btnPlay.classList.remove("playing");
      setPlayIcon(false);
      drawAllCanvases();
      setStatus("Stopped");
      return transportInfo();
    },
    seek: async (args) => {
      let beat = null;
      if (args.beat != null) beat = Number(args.beat);
      else if (args.bar != null) beat = (Number(args.bar) - 1) * 4;
      else if (args.seconds != null) beat = (Number(args.seconds) * project.bpm) / 60;
      if (beat == null || !Number.isFinite(beat) || beat < 0) {
        throw apiError("input", "pass one of beat >= 0, bar >= 1 (1 bar = 4 beats) or seconds >= 0");
      }
      engine.seek(project, assets, beat);
      drawAllCanvases();
      return transportInfo();
    },
    setTempo: async (args) => {
      pushUndoState();
      project.bpm = Math.max(40, Math.min(260, Number(args.bpm) || 124));
      onProjectMutated(`Tempo set to ${project.bpm} BPM`);
      return { bpm: project.bpm };
    },
    setLoop: async (args) => {
      const enabled = args.enabled != null ? !!args.enabled : project.loopEnabled;
      const start = args.startBeat != null ? Math.max(0, Number(args.startBeat) || 0) : project.loopStartBeat;
      const end = args.endBeat != null ? Math.max(0, Number(args.endBeat) || 0) : project.loopEndBeat;
      if (enabled && !(end > start + 0.25)) {
        throw apiError("input", `loop end beat ${end} must be at least 0.25 beats after start ${start}`);
      }
      pushUndoState();
      project.loopEnabled = enabled;
      project.loopStartBeat = start;
      project.loopEndBeat = end;
      onProjectMutated(`Loop ${enabled ? `${formatBeatBar(start)} → ${formatBeatBar(end)}` : "off"}`);
      return { loopEnabled: enabled, loopStartBeat: start, loopEndBeat: end };
    },
    setMetronome: async (args) => {
      project.metronome = !!args.on;
      onProjectMutated(`Metronome ${project.metronome ? "on" : "off"}`);
      return { metronome: project.metronome };
    },

    // ---------- tracks ----------
    addTrack: async (args) => {
      pushUndoState();
      const idx = project.tracks.length + 1;
      const trk = {
        id: nextId("trk"),
        name: args.name ? String(args.name).slice(0, 80) : `${idx} · Audio Track`,
        color: args.color || PALETTE[(idx - 1) % PALETTE.length],
        muted: false,
        solo: false,
        volumeDb: 0,
        pan: 0,
        eqLowDb: 0,
        eqMidDb: 0,
        eqHighDb: 0,
      };
      project.tracks.push(trk);
      ui.selectedTrackId = trk.id;
      onProjectMutated(`Added ${trk.name}`);
      return trackInfo(trk);
    },
    removeTrack: async (args) => {
      const idx = project.tracks.findIndex((t) => t.id === args.trackId);
      if (idx === -1) throw apiError("input", `no track with id "${args.trackId}"`, "getTracks lists every track id");
      pushUndoState();
      const track = project.tracks[idx];
      const removedClips = project.clips.filter((c) => c.trackId === track.id).length;
      project.clips = project.clips.filter((c) => c.trackId !== track.id);
      let removed = false;
      if (project.tracks.length > 1) {
        project.tracks.splice(idx, 1);
        removed = true;
        if (ui.selectedTrackId === track.id) ui.selectedTrackId = project.tracks[0].id;
        onProjectMutated(`Deleted track "${track.name}"`);
      } else {
        onProjectMutated(`Cleared all clips on "${track.name}"`);
      }
      return { trackId: track.id, name: track.name, removed, removedClips, tracks: project.tracks.length };
    },
    renameTrack: async (args) => {
      const t = findTrack(args.trackId);
      pushUndoState();
      t.name = String(args.name).slice(0, 120) || t.name;
      onProjectMutated(`Renamed track to "${t.name}"`);
      return trackInfo(t);
    },
    setTrackMix: async (args) => {
      const t = findTrack(args.trackId);
      const fields = ["volumeDb", "pan", "muted", "solo", "eqLowDb", "eqMidDb", "eqHighDb"];
      if (!fields.some((f) => args[f] != null)) {
        throw apiError("input", "pass at least one mixer field to change", fields.join(", "));
      }
      pushUndoState();
      if (args.volumeDb != null) t.volumeDb = clampNum(args.volumeDb, -36, 6, t.volumeDb);
      if (args.pan != null) t.pan = clampNum(args.pan, -1, 1, t.pan);
      if (args.muted != null) t.muted = !!args.muted;
      if (args.solo != null) t.solo = !!args.solo;
      if (args.eqLowDb != null) t.eqLowDb = clampNum(args.eqLowDb, -15, 15, t.eqLowDb);
      if (args.eqMidDb != null) t.eqMidDb = clampNum(args.eqMidDb, -15, 15, t.eqMidDb);
      if (args.eqHighDb != null) t.eqHighDb = clampNum(args.eqHighDb, -15, 15, t.eqHighDb);
      onProjectMutated(`${t.name} mix updated via API`);
      return trackInfo(t);
    },
    selectTrack: async (args) => {
      const t = findTrack(args.trackId);
      ui.selectedTrackId = t.id;
      updateTrackInspector();
      renderTrackHeaders();
      drawAllCanvases();
      return { selectedTrackId: t.id, name: t.name };
    },

    // ---------- stems / assets ----------
    importAudio: async (args) => {
      if (args.trackId != null && !project.tracks.some((t) => t.id === args.trackId)) {
        throw apiError("input", `no track with id "${args.trackId}"`, "getTracks lists every track id");
      }
      let bytes;
      if (args.base64) {
        const b64 = String(args.base64).replace(/^data:[^;,]*;base64,/, "").replace(/[^A-Za-z0-9+/=]/g, "");
        if (!b64) throw apiError("input", "the base64 payload is empty");
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else if (args.url) {
        let r;
        try {
          r = await fetch(args.url, { cache: "no-store" });
        } catch (err) {
          throw apiError("input", `could not fetch the url: ${err.message}`, "same-origin urls like /api/imports/<file> work best");
        }
        if (!r.ok) {
          throw apiError(
            "input",
            `could not fetch the url (HTTP ${r.status})`,
            "upload the file first: POST /api/imports/upload?name=<file>, then pass url=/api/imports/<file>"
          );
        }
        bytes = new Uint8Array(await r.arrayBuffer());
      } else {
        throw apiError("input", "pass base64 audio bytes or a url", "for big files use POST /api/imports/upload then url=/api/imports/<name>");
      }
      if (!bytes.length) throw apiError("input", "the audio payload is empty");
      const name =
        String(
          args.name ||
            (args.url ? decodeURIComponent(String(args.url).split("?")[0].split("/").pop() || "") : "") ||
            "imported-audio"
        ).slice(0, 120) || "imported-audio";
      let audioBuf;
      try {
        audioBuf = await engine.decodeAudioFile(bytes.buffer);
      } catch (err) {
        throw apiError("input", `the browser could not decode this audio: ${err.message}`, "send WAV/MP3/FLAC/OGG/M4A bytes");
      }
      const id = nextId("asset");
      const color = PALETTE[assets.size % PALETTE.length];
      registerAsset(id, name, color, audioBuf);
      let trackId = args.trackId || null;
      let clip = null;
      if (args.addClip !== false) {
        if (!trackId) {
          trackId = nextId("trk");
          project.tracks.push({
            id: trackId,
            name: `${project.tracks.length + 1} · ${name.replace(/\.[^.]+$/, "").slice(0, 24)}`,
            color,
            muted: false,
            solo: false,
            volumeDb: 0,
            pan: 0,
            eqLowDb: 0,
            eqMidDb: 0,
            eqHighDb: 0,
          });
          ui.selectedTrackId = trackId;
        }
        const beatCursor = args.startBeat != null ? Math.max(0, Number(args.startBeat) || 0) : engine.getPlayheadBeat(project);
        addAssetClipToPlaylist(id, trackId, beatCursor);
        clip = project.clips[project.clips.length - 1] || null;
      } else {
        pushUndoState();
        renderAssetPool();
        onProjectMutated(`Imported "${name}" via API`);
      }
      setStatus(`Imported "${name}" via API`);
      return { asset: assetInfo(assets.get(id)), trackId, clip: clip ? clipInfo(clip) : null };
    },
    removeAsset: async (args) => {
      const a = assets.get(args.assetId);
      if (!a) throw apiError("input", `no asset with id "${args.assetId}"`, "getAssets lists the stem pool");
      pushUndoState();
      assets.delete(a.id);
      const removedClips = project.clips.filter((c) => c.assetId === a.id).length;
      project.clips = project.clips.filter((c) => c.assetId !== a.id);
      ui.selectedClipIds.clear();
      renderAssetPool();
      onProjectMutated(`Removed stem "${a.name}"`);
      return { removed: a.id, name: a.name, removedClips };
    },

    // ---------- clips ----------
    addClip: async (args) => {
      const asset = assets.get(args.assetId);
      if (!asset) {
        throw apiError("input", `no asset with id "${args.assetId}" in the stem pool`, "getAssets lists the pool; importAudio adds to it");
      }
      const track = args.trackId != null ? findTrack(args.trackId) : project.tracks.find((t) => t.id === ui.selectedTrackId) || project.tracks[0];
      if (!track) throw apiError("input", "the playlist has no track to put the clip on", "addTrack first");
      const startBeat = args.startBeat != null ? Math.max(0, Number(args.startBeat) || 0) : engine.getPlayheadBeat(project);
      addAssetClipToPlaylist(asset.id, track.id, startBeat);
      const clip = project.clips[project.clips.length - 1];
      if (clip && args.durationBeats != null) {
        clip.durationBeats = Math.max(0.125, Number(args.durationBeats) || 0.125);
        updateClipInspector();
        drawAllCanvases();
      }
      return { clip: clip ? clipInfo(clip) : null };
    },
    selectClips: async (args) => {
      let ids;
      if (args.all) {
        ids = project.clips.map((c) => c.id);
      } else if (Array.isArray(args.clipIds)) {
        ids = args.clipIds.map((id) => findClip(String(id)).id);
      } else if (args.trackId != null) {
        findTrack(args.trackId);
        ids = project.clips.filter((c) => c.trackId === args.trackId).map((c) => c.id);
      } else {
        throw apiError("input", "pass clipIds, trackId, or all:true");
      }
      ui.selectedClipIds = new Set(ids);
      updateClipInspector();
      renderTrackHeaders();
      drawAllCanvases();
      return { selected: ids };
    },
    moveClips: async (args) => {
      const targets = resolveClips(args);
      const hasDelta = args.deltaBeats != null || args.deltaTracks != null;
      const hasAbs = args.startBeat != null || args.trackId != null;
      if (hasDelta && hasAbs) {
        throw apiError("input", "use either deltaBeats/deltaTracks or startBeat/trackId in one call, not both");
      }
      if (!hasDelta && !hasAbs) {
        throw apiError("input", "pass deltaBeats, deltaTracks, startBeat or trackId");
      }
      pushUndoState();
      if (args.deltaBeats != null) {
        for (const c of targets) c.startBeat = Math.max(0, Number((c.startBeat + Number(args.deltaBeats)).toFixed(4)));
      }
      if (args.deltaTracks != null) {
        for (const c of targets) {
          const idx = project.tracks.findIndex((t) => t.id === c.trackId);
          const nextIdx = Math.max(0, Math.min(project.tracks.length - 1, idx + Math.round(Number(args.deltaTracks))));
          c.trackId = project.tracks[nextIdx].id;
        }
      }
      if (args.trackId != null) {
        const t = findTrack(args.trackId);
        for (const c of targets) c.trackId = t.id;
        ui.selectedTrackId = t.id;
      }
      if (args.startBeat != null) {
        const target = Math.max(0, Number(args.startBeat) || 0);
        if (targets.length === 1) {
          targets[0].startBeat = Number(target.toFixed(4));
        } else {
          let minStart = Infinity;
          for (const c of targets) minStart = Math.min(minStart, c.startBeat);
          const delta = target - minStart;
          for (const c of targets) c.startBeat = Math.max(0, Number((c.startBeat + delta).toFixed(4)));
        }
      }
      onProjectMutated(`Moved ${targets.length} clip(s) via API`);
      return { moved: targets.map(clipInfo) };
    },
    trimClips: async (args) => {
      const targets = resolveClips(args);
      if (args.startBeat == null && args.endBeat == null && args.durationBeats == null) {
        throw apiError("input", "pass startBeat, endBeat or durationBeats");
      }
      const secPerBeat = 60 / project.bpm;
      pushUndoState();
      for (const c of targets) {
        const rate = Math.pow(2, (c.pitchSemitones || 0) / 12) * (c.playbackRate || 1);
        const end = c.startBeat + c.durationBeats;
        let newStart = c.startBeat;
        let newEnd = end;
        if (args.startBeat != null) newStart = clampNum(args.startBeat, 0, Math.max(0, end - 0.125), c.startBeat);
        if (args.endBeat != null) newEnd = Number(args.endBeat);
        else if (args.durationBeats != null) newEnd = newStart + Math.max(0.125, Number(args.durationBeats) || 0.125);
        const asset = assets.get(c.assetId);
        const maxDurBeats = asset ? Math.max(0.125, (asset.durationSec - (c.sourceOffsetSec || 0)) / (secPerBeat * rate)) : 1e6;
        newEnd = Math.min(newEnd, newStart + maxDurBeats);
        if (newEnd < newStart + 0.125) newEnd = newStart + 0.125;
        const advance = (newStart - c.startBeat) * secPerBeat * rate;
        c.sourceOffsetSec = Number(Math.max(0, (c.sourceOffsetSec || 0) + advance).toFixed(4));
        c.startBeat = Number(newStart.toFixed(4));
        c.durationBeats = Number((newEnd - newStart).toFixed(4));
        c.fadeInBeats = Math.min(c.fadeInBeats || 0, c.durationBeats * 0.4);
        c.fadeOutBeats = Math.min(c.fadeOutBeats || 0, c.durationBeats * 0.4);
      }
      onProjectMutated(`Trimmed ${targets.length} segment(s) via API`);
      return { trimmed: targets.map(clipInfo) };
    },
    splitClips: async (args) => {
      const beat = Number(args.atBeat);
      if (!Number.isFinite(beat) || beat < 0) throw apiError("input", "atBeat must be a number >= 0");
      const crosses = (c) => beat > c.startBeat + 0.0625 && beat < c.startBeat + c.durationBeats - 0.0625;
      const scope = Array.isArray(args.clipIds) ? args.clipIds.map((id) => findClip(String(id))) : project.clips;
      const splittable = scope.filter(crosses);
      if (splittable.length === 0) {
        throw apiError(
          "input",
          `no target clip crosses beat ${beat} far enough from its edges (1/16 beat margin)`,
          "getClips shows clip start/end beats; try another atBeat"
        );
      }
      pushUndoState();
      const newSel = new Set();
      const nextClips = [];
      for (const c of project.clips) {
        if (!splittable.includes(c)) {
          nextClips.push(c);
          continue;
        }
        const pair = splitClipAtBeat(c, beat);
        if (pair) {
          nextClips.push(pair[0], pair[1]);
          newSel.add(pair[1].id);
        } else {
          nextClips.push(c);
        }
      }
      project.clips = nextClips;
      ui.selectedClipIds = newSel;
      onProjectMutated(`Split ${splittable.length} clip(s) at beat ${beat} via API`);
      return { split: splittable.length, clips: project.clips.length, rightHalves: Array.from(newSel) };
    },
    splitAtPlayhead: async (args) => {
      if (Array.isArray(args.clipIds)) setSelection(args.clipIds.map((id) => findClip(String(id))));
      const before = project.clips.length;
      splitAtPlayhead();
      const split = project.clips.length - before;
      if (split === 0) {
        throw apiError(
          "input",
          "the playhead is not inside any target clip",
          "seek first, or use splitClips with an explicit atBeat"
        );
      }
      return { split, clips: project.clips.length, selected: Array.from(ui.selectedClipIds) };
    },
    chopClips: async (args) => {
      const targets = resolveClips(args);
      setSelection(targets);
      const before = project.clips.length;
      if (args.transients) {
        chopSelectedClipsByTransients();
      } else {
        let every = args.everyBeats != null ? Number(args.everyBeats) : CHOP_PRESETS[args.preset || "1bar"];
        if (!(every > 0.0625)) {
          throw apiError("input", "everyBeats must be greater than 1/16 beat (0.0625)", "e.g. everyBeats=0.5, or preset=1beat|1bar|halfbar|eighth");
        }
        chopSelectedClipsEvery(every);
      }
      return {
        newSegments: project.clips.length - before,
        clips: project.clips.length,
        selected: Array.from(ui.selectedClipIds),
      };
    },
    duplicateClips: async (args) => {
      const targets = resolveClips(args);
      setSelection(targets);
      const before = project.clips.length;
      duplicateSelectedClips();
      return { duplicated: project.clips.length - before, selected: Array.from(ui.selectedClipIds) };
    },
    reverseClips: async (args) => {
      const targets = resolveClips(args);
      setSelection(targets);
      reverseSelectedClips();
      return { reversed: targets.map(clipInfo) };
    },
    muteClips: async (args) => {
      const targets = resolveClips(args);
      pushUndoState();
      for (const c of targets) c.muted = args.muted != null ? !!args.muted : !c.muted;
      onProjectMutated(`Toggled mute on ${targets.length} segment(s) via API`);
      return { clips: targets.map(clipInfo) };
    },
    deleteClips: async (args) => {
      const targets = resolveClips(args);
      setSelection(targets);
      deleteSelectedClips();
      return { deleted: targets.length, clips: project.clips.length };
    },
    slipClips: async (args) => {
      const targets = resolveClips(args);
      if (args.deltaSec == null && args.deltaBeats == null) {
        throw apiError("input", "pass deltaSec or deltaBeats");
      }
      const secPerBeat = 60 / project.bpm;
      const deltaSec = args.deltaSec != null ? Number(args.deltaSec) : Number(args.deltaBeats) * secPerBeat;
      if (!Number.isFinite(deltaSec)) throw apiError("input", "deltaSec/deltaBeats must be finite numbers");
      pushUndoState();
      for (const c of targets) {
        const asset = assets.get(c.assetId);
        const maxOffset = asset ? Math.max(0, asset.durationSec - 0.05) : 60;
        c.sourceOffsetSec = Number(Math.max(0, Math.min(maxOffset, (c.sourceOffsetSec || 0) + deltaSec)).toFixed(4));
      }
      onProjectMutated(`Slipped ${targets.length} segment(s) by ${deltaSec.toFixed(3)}s via API`);
      return { slipped: targets.map(clipInfo) };
    },
    setClipParams: async (args) => {
      const targets = resolveClips(args);
      if (!CLIP_FIELDS.some((f) => args[f] != null)) {
        throw apiError("input", "pass at least one clip field to change", CLIP_FIELDS.join(", "));
      }
      pushUndoState();
      for (const c of targets) {
        if (args.gainDb != null) c.gainDb = clampNum(args.gainDb, -24, 12, c.gainDb || 0);
        if (args.pitchSemitones != null) c.pitchSemitones = clampNum(args.pitchSemitones, -12, 12, c.pitchSemitones || 0);
        if (args.pan != null) c.pan = clampNum(args.pan, -1, 1, c.pan || 0);
        if (args.fadeInBeats != null) c.fadeInBeats = Math.max(0, Number(args.fadeInBeats) || 0);
        if (args.fadeOutBeats != null) c.fadeOutBeats = Math.max(0, Number(args.fadeOutBeats) || 0);
        if (args.reverse != null) c.reverse = !!args.reverse;
        if (args.muted != null) c.muted = !!args.muted;
        if (args.color != null) c.color = String(args.color);
        if (args.name != null) c.name = String(args.name).slice(0, 120) || c.name;
        if (args.playbackRate != null) c.playbackRate = clampNum(args.playbackRate, 0.25, 4, c.playbackRate || 1);
      }
      onProjectMutated(`Updated ${targets.length} segment(s) via API`);
      return { clips: targets.map(clipInfo) };
    },
    clearPlaylist: async () => {
      const before = project.clips.length;
      clearPlaylistClips();
      return { cleared: before - project.clips.length, clips: project.clips.length };
    },

    // ---------- markers ----------
    addMarker: async (args) => {
      const beat = Math.max(0, Number(args.beat) || 0);
      pushUndoState();
      const pal = getActiveTheme().palette;
      const marker = {
        id: nextId("m"),
        beat: Number(beat.toFixed(4)),
        name: String(args.name || "Marker").slice(0, 60) || "Marker",
        color: args.color || pal[project.markers.length % pal.length],
      };
      project.markers.push(marker);
      onProjectMutated(`Marker "${marker.name}" added at ${formatBeatBar(marker.beat)}`);
      return { marker };
    },
    removeMarker: async (args) => {
      const idx = project.markers.findIndex((m) => m.id === args.markerId);
      if (idx === -1) throw apiError("input", `no marker with id "${args.markerId}"`, "getMarkers lists every marker id");
      pushUndoState();
      const removed = project.markers.splice(idx, 1)[0];
      onProjectMutated(`Marker "${removed.name}" removed`);
      return { removed };
    },

    // ---------- export ----------
    exportWav: async (args) => {
      const mode = args.mode || "master";
      const bitDepth = [16, 24, 32].includes(Number(args.bitDepth)) ? Number(args.bitDepth) : 24;
      const sampleRate = [44100, 48000].includes(Number(args.sampleRate)) ? Number(args.sampleRate) : 44100;
      let range = args.range || "song";
      if (range === "loop" && !(project.loopEndBeat > project.loopStartBeat + 0.25)) range = "song";
      if (project.clips.length === 0) {
        throw apiError("input", "the playlist is empty: nothing to render", "loadDemo or importAudio + addClip first");
      }
      const startBeat = range === "loop" ? project.loopStartBeat : 0;
      const maxEnd = project.clips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 4);
      const endBeat = range === "loop" ? project.loopEndBeat : maxEnd;
      const prefix = safeFileName(args.filename || project.name || "audius-studio-mix");
      const files = [];
      const renderOne = async (label, onlyTrackId) => {
        const rendered = await engine.renderProjectOffline(project, assets, {
          sampleRate,
          startBeat,
          endBeat,
          rangeMode: range,
          ...(onlyTrackId ? { onlyTrackId } : {}),
        });
        const blob = encodeWavFromAudioBuffer(rendered, bitDepth);
        const name = `${prefix}${label ? `-${safeFileName(label)}` : ""}-${bitDepth}bit.wav`;
        const up = await fetch(`/api/exports/upload?name=${encodeURIComponent(name)}`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: blob,
        });
        if (!up.ok) {
          throw apiError("error", `the server refused the export upload (HTTP ${up.status})`, "is app/server.mjs running? on static hosting exportWav cannot store files");
        }
        const meta = await up.json();
        files.push({
          name: meta.name,
          url: meta.url,
          bytes: meta.bytes,
          durationSec: Number(rendered.duration.toFixed(3)),
          sampleRate,
          bitDepth,
          ...(onlyTrackId ? { trackId: onlyTrackId } : {}),
        });
      };
      if (mode === "master") {
        await renderOne("", null);
      } else {
        const tracksWithClips = project.tracks.filter((t) => project.clips.some((c) => c.trackId === t.id && !c.muted));
        if (tracksWithClips.length === 0) {
          throw apiError("input", "no unmuted clips to export as stems", "unmute clips or export mode=master");
        }
        for (const t of tracksWithClips) {
          await renderOne(t.name, t.id);
        }
      }
      setStatus(`Exported ${files.length} WAV file(s) via API`);
      return { files, mode, range, startBeat, endBeat };
    },

    // ---------- ui ----------
    setTool: async (args) => {
      setActiveTool(args.tool);
      return { tool: ui.tool };
    },
  };
}

// Initialize Application
setupPlaylistInteractions();
setupPianoRollInteractions();
setupMidiInput();
bindControls();
setupAudiusBrowser();
setupToolPicker();
setupMoreSheet();
syncSnapLabels();
if (compactLayoutQuery.addEventListener) compactLayoutQuery.addEventListener("change", syncSnapLabels);
else if (compactLayoutQuery.addListener) compactLayoutQuery.addListener(syncSnapLabels);
setCursorInfo(1, 1);
window.addEventListener("resize", () => setCursorInfo(lastCursorInfo[0], lastCursorInfo[1]));
gateUi = initGateShaper({
  getProject: () => project,
  getSelectedTrackId: () => ui.selectedTrackId,
  beginEdit: () => pushUndoState(),
  commit: (statusText) => onProjectMutated(statusText),
  refreshAudio: () => {
    engine.syncTrackNodes(project);
    if (engine.isPlaying) engine.play(project, assets, engine.getPlayheadBeat(project));
  },
  setRange,
  getPlayback: () => ({
    beat: engine.getPlayheadBeat(project),
    passStart: engine.startBeatOffset,
    playing: engine.isPlaying,
  }),
});

fxUi = initWasmFxUi({
  getProject: () => project,
  getSelectedTrackId: () => ui.selectedTrackId,
  beginEdit: () => pushUndoState(),
  commit: (statusText) => onProjectMutated(statusText),
  setStatus: (text, opts) => setStatus(text, opts),
  engine,
  host: fxHost,
});

// Workspace preferences (theme, wallpaper, snap, tool, zoom, track height
// and transport flags) survive a reload; the arrangement itself does not —
// the first load is always the demo session, as the owner specified.
const restoredPrefs = loadPrefs();
applyPrefs(restoredPrefs);
loadBuiltInDemoArrangement();
// The demo session owns the arrangement, so re-apply the transport
// preferences it overwrote.
if (restoredPrefs) {
  if (typeof restoredPrefs.loopEnabled === "boolean") project.loopEnabled = restoredPrefs.loopEnabled;
  if (typeof restoredPrefs.metronome === "boolean") project.metronome = restoredPrefs.metronome;
  if (Number.isFinite(restoredPrefs.masterVolumeDb)) {
    project.masterVolumeDb = restoredPrefs.masterVolumeDb;
  }
}
setupVerticalScroll();
setLit(dom.btnLoop, !!project.loopEnabled);
setLit(dom.btnMetro, !!project.metronome);
setLit(dom.btnTypingPiano, ui.typingPiano);
setRange(dom.masterVol, project.masterVolumeDb);
setRange(dom.zoomSlider, ui.pixelsPerBeat);
if (dom.snapSelect) dom.snapSelect.value = String(ui.snapBeats);
if (dom.wallpaperSelect && dom.wallpaperSelect.querySelector(`option[value="${ui.wallpaper}"]`)) {
  dom.wallpaperSelect.value = ui.wallpaper;
}
// Restore the tool without announcing it on first load.
document.querySelectorAll(".tool-btn").forEach((b) => {
  setLit(b, b.dataset.tool === ui.tool);
});
onProjectMutated();

// DAW API bridge: makes this live session fully functional over the local
// server's HTTP API (app/api/README.md), in the style of api-anything.
// On static hosting (Cloudflare Pages) there is no /api, the probe fails and
// the bridge stays dormant — the DAW itself never depends on it.
initApiBridge(buildApiBridgeHandlers(), {
  version: "39",
  onLog: (msg) => console.info("[api-bridge]", msg),
});

// Coming back to the tab may find the AudioContext suspended
// (browser power saving): resume it so playback continues.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) engine.ensureContext();
});

// Read-only synth-channel diagnostics for the verification harnesses (plain data, no setters).
window.audiusStudioSynths = () => ({
  instruments: (project.instruments || []).map((i) => ({
    id: i.id,
    name: i.name,
    assetId: i.assetId,
    root: i.root,
    preset: i.patch.name,
    mods: i.patch.mods.length,
  })),
  renders: (project.synthRenders || []).map((r) => ({ assetId: r.assetId, notes: r.notes.length, seconds: r.seconds })),
  clips: project.clips
    .filter((c) => assets.has(c.assetId) && assets.get(c.assetId).renderOf)
    .map((c) => ({ assetId: c.assetId, trackId: c.trackId, startBeat: c.startBeat, durationBeats: c.durationBeats })),
  renderAssets: Array.from(assets.values()).filter((a) => a.renderOf).map((a) => ({ id: a.id, durationSec: a.durationSec })),
  totalClips: project.clips.length,
});

// Read-only diagnostics for the verification harnesses and for support reports.
// It returns plain data and exposes no setters: every change still goes through
// the UI, the keyboard or the API bridge.
window.audiusStudioInfo = () => ({
  version: "1.0.0",
  build: "2026-10-21",
  tracks: project.tracks.length,
  patterns: ui.patterns.length,
  selectedTrackId: ui.selectedTrackId,
  liveVoices: engine.liveVoices.size,
  playing: engine.isPlaying,
  levels: engine.getMasterLevels(),
  fxRebuilds: engine.fxRebuildCount || 0,
  fxChains: Array.from(engine.fxChains.entries()).map(([key, chain]) => ({
    key,
    signature: chain.signature,
    slots: chain.slots.map((item) => ({ id: item.slot.id, type: item.slot.type })),
  })),
  plugins: {
    insert: (project.tracks.find((t) => t.id === ui.selectedTrackId) || {}).fxPlugins || [],
    master: project.masterFxPlugins || [],
  },
});

requestAnimationFrame(animationTick);
