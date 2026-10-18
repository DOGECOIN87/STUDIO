/**
 * PulseForge DAW — Main Playlist, Arrangement, Slicing, Multi-Touch & Inspector Controller
 */
import {
  encodeWavFromAudioBuffer,
  computeWaveformPeaks,
  detectTransients,
  generateDemoStems,
} from "./wav-codec.js";
import { AudioEngine } from "./audio-engine.js";

const engine = new AudioEngine();

// Map of assetId -> { id, name, color, buffer, peaks, durationSec, sampleRate }
const assets = new Map();

// Undo / Redo stacks of serialized project states
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 60;

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
  amoled: {
    name: "Audius Neue Dark (#0F0F0F & #806AD8 / #C67CFF)",
    canvasBg: "#0A0A0E",
    laneEven: "#12121A",
    laneOdd: "#0D0D13",
    laneSelected: "#221B3A",
    laneBorder: "#26233A",
    rulerBg: "#14141D",
    rulerBorder: "#2E2B44",
    playhead: "#C67CFF",
    loopColor: "#806AD8",
    palette: ["#806AD8", "#C67CFF", "#A74CFF", "#1BA1F1", "#84DF64", "#EFB360", "#F94D62"],
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
    name: "Audius Trending Blue & Magenta",
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
    name: "Audius Royal Amethyst & Gold",
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
    name: "Audius Synthwave",
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
  "fl-slate": {
    name: "FL Studio Olive Slate",
    canvasBg: "#1b2024",
    laneEven: "#20262b",
    laneOdd: "#1c2126",
    laneSelected: "#283138",
    laneBorder: "#2e373f",
    rulerBg: "#232a30",
    rulerBorder: "#39444d",
    playhead: "#ffb703",
    loopColor: "#52b788",
    palette: ["#52b788", "#4ea8de", "#ffb703", "#f28482", "#9b5de5", "#00bbf9", "#f15bb5"],
  },
  nordic: {
    name: "Nordic Ice & Aurora",
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

// Current UI state
const ui = {
  theme: "audius-dark",
  tool: "draw", // 'draw' | 'paint' | 'slice' | 'slip' | 'mute' | 'select' | 'delete' | 'pan'
  snapBeats: 0.5, // default 1/8 note (0.5 beat)
  lastSnapBeats: 0.5,
  typingPiano: false, // FL Studio Ctrl+T Typing Keyboard to Piano Keyboard
  transportMode: "song", // 'pat' | 'song'
  activePatternIndex: 0,
  patterns: [
    {
      name: "Pattern 1 — Main Beat",
      steps: {
        "stem-drums":  [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1],
        "stem-bass":   [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
        "stem-chords": [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        "stem-arp":    [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0],
      },
      notes: [
        { id: "n1", row: 4,  startStep: 0,  lenSteps: 2, vel: 0.88, label: "C5" },
        { id: "n2", row: 7,  startStep: 2,  lenSteps: 2, vel: 0.78, label: "A4" },
        { id: "n3", row: 9,  startStep: 4,  lenSteps: 2, vel: 0.84, label: "G4" },
        { id: "n4", row: 12, startStep: 6,  lenSteps: 2, vel: 0.75, label: "E4" },
        { id: "n5", row: 5,  startStep: 8,  lenSteps: 3, vel: 0.92, label: "B4" },
        { id: "n6", row: 7,  startStep: 11, lenSteps: 2, vel: 0.80, label: "A4" },
        { id: "n7", row: 9,  startStep: 13, lenSteps: 3, vel: 0.86, label: "G4" },
      ],
    },
    {
      name: "Pattern 2 — Lead & Arp",
      steps: {
        "stem-drums":  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1],
        "stem-bass":   [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0],
        "stem-chords": [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        "stem-arp":    [1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0],
      },
      notes: [
        { id: "n21", row: 2,  startStep: 0,  lenSteps: 2, vel: 0.90, label: "D5" },
        { id: "n22", row: 4,  startStep: 2,  lenSteps: 2, vel: 0.82, label: "C5" },
        { id: "n23", row: 7,  startStep: 4,  lenSteps: 4, vel: 0.88, label: "A4" },
        { id: "n24", row: 9,  startStep: 8,  lenSteps: 2, vel: 0.78, label: "G4" },
        { id: "n25", row: 4,  startStep: 10, lenSteps: 3, vel: 0.92, label: "C5" },
        { id: "n26", row: 2,  startStep: 13, lenSteps: 3, vel: 0.86, label: "D5" },
      ],
    },
    {
      name: "Pattern 3 — Bassline",
      steps: {
        "stem-drums":  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        "stem-bass":   [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0],
        "stem-chords": [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        "stem-arp":    [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      },
      notes: [
        { id: "n31", row: 12, startStep: 0,  lenSteps: 4, vel: 0.94, label: "E4" },
        { id: "n32", row: 14, startStep: 4,  lenSteps: 4, vel: 0.86, label: "D4" },
        { id: "n33", row: 16, startStep: 8,  lenSteps: 4, vel: 0.92, label: "C4" },
        { id: "n34", row: 14, startStep: 12, lenSteps: 4, vel: 0.88, label: "D4" },
      ],
    },
  ],
  prDrag: null,
  clipboardClips: [],
  pixelsPerBeat: 48,
  scrollBeat: 0,
  scrollY: 0,
  trackHeight: 78,
  rulerHeight: 34,
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
};

// Initial Project State
let project = {
  name: "Ubuntu Arrangement Session",
  bpm: 124,
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
  statusPill: document.getElementById("status-pill"),
  themeSelect: document.getElementById("theme-select"),
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
  btnCrStamp: document.getElementById("btn-cr-stamp"),
  btnCrClear: document.getElementById("btn-cr-clear"),
  btnCloseChannelRack: document.getElementById("btn-close-channel-rack"),
  prChannelLabel: document.getElementById("pr-channel-label"),
  btnPrPlay: document.getElementById("btn-pr-play"),
  btnPrStamp: document.getElementById("btn-pr-stamp"),
  btnPrClear: document.getElementById("btn-pr-clear"),
  btnClosePianoRoll: document.getElementById("btn-close-piano-roll"),
  pianoRollCanvas: document.getElementById("piano-roll-canvas"),
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
  dropzoneBox: document.getElementById("dropzone-box"),
  assetList: document.getElementById("asset-list"),
  btnAddTrack: document.getElementById("btn-add-track"),
  trackHeadersList: document.getElementById("track-headers-list"),
  timelineViewport: document.getElementById("timeline-viewport"),
  playlistCanvas: document.getElementById("playlist-canvas"),
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

let uidCounter = 100;
function nextId(prefix = "id") {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`;
}

function setStatus(msg) {
  if (dom.statusPill) dom.statusPill.textContent = msg;
}

function cloneProjectState(proj) {
  return JSON.parse(JSON.stringify(proj));
}

function pushUndoState() {
  undoStack.push(cloneProjectState(project));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  if (undoStack.length === 0) {
    setStatus("Nothing to undo");
    return;
  }
  redoStack.push(cloneProjectState(project));
  project = undoStack.pop();
  ui.selectedClipIds.clear();
  onProjectMutated("Undo applied");
}

function redo() {
  if (redoStack.length === 0) {
    setStatus("Nothing to redo");
    return;
  }
  undoStack.push(cloneProjectState(project));
  project = redoStack.pop();
  ui.selectedClipIds.clear();
  onProjectMutated("Redo applied");
}

function snapBeat(beat, altKey = false) {
  const step = altKey ? 0 : ui.snapBeats;
  if (!step || step <= 0) return Math.max(0, Number(beat.toFixed(4)));
  return Math.max(0, Math.round(beat / step) * step);
}

function registerAsset(id, name, color, audioBuffer) {
  const peaks = computeWaveformPeaks(audioBuffer, 220);
  const asset = {
    id,
    name,
    color,
    buffer: audioBuffer,
    peaks,
    durationSec: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
  };
  assets.set(id, asset);
  return asset;
}

function getActiveTheme() {
  return THEMES[ui.theme] || THEMES.amoled;
}

function applyTheme(themeId, announce = true) {
  if (!THEMES[themeId]) themeId = "amoled";
  ui.theme = themeId;
  document.body.dataset.theme = themeId;
  document.body.removeAttribute("style");

  if (dom.themeSelect && dom.themeSelect.value !== themeId) {
    dom.themeSelect.value = themeId;
  }
  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeSwatch === themeId);
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
  if (announce) {
    setStatus(`Palette changed to ${themeObj.name}`);
  }
}

/**
 * Loads the built-in 4-stem demo song and demonstrates pre-sliced/rearranged segments on the Playlist.
 */
function loadBuiltInDemoArrangement() {
  const pal = getActiveTheme().palette;
  const stems = generateDemoStems(project.bpm, 44100);
  stems.forEach((s, idx) => {
    registerAsset(s.id, s.name, pal[idx % pal.length], s.buffer);
  });

  project.clips = [
    {
      id: nextId("clip"),
      assetId: "stem-drums",
      trackId: "trk-1",
      name: "Breakbeat Drums (Bars 1-2)",
      color: "#ff7a45",
      startBeat: 0,
      durationBeats: 8,
      sourceOffsetSec: 0,
      gainDb: 0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 0,
      fadeOutBeats: 0,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-drums",
      trackId: "trk-1",
      name: "Drums Slice A (Kick)",
      color: "#ff7a45",
      startBeat: 8,
      durationBeats: 2,
      sourceOffsetSec: 0,
      gainDb: 0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 0,
      fadeOutBeats: 0,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-drums",
      trackId: "trk-1",
      name: "Drums Slice B (Repeat Kick/Snare)",
      color: "#ff7a45",
      startBeat: 10,
      durationBeats: 2,
      sourceOffsetSec: (60 / project.bpm) * 2,
      gainDb: 0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 0,
      fadeOutBeats: 0,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-drums",
      trackId: "trk-1",
      name: "Drums Slice C (Stutter Cut)",
      color: "#ff9c6e",
      startBeat: 12,
      durationBeats: 1,
      sourceOffsetSec: 0,
      gainDb: 1.0,
      pan: -0.2,
      pitchSemitones: 0,
      fadeInBeats: 0,
      fadeOutBeats: 0,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-drums",
      trackId: "trk-1",
      name: "Drums Slice D (Reversed Fill)",
      color: "#ffa940",
      startBeat: 13,
      durationBeats: 1,
      sourceOffsetSec: (60 / project.bpm) * 1,
      gainDb: 0,
      pan: 0.2,
      pitchSemitones: 0,
      fadeInBeats: 0.125,
      fadeOutBeats: 0.125,
      reverse: true,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-drums",
      trackId: "trk-1",
      name: "Drums Slice E (End Groove)",
      color: "#ff7a45",
      startBeat: 14,
      durationBeats: 2,
      sourceOffsetSec: (60 / project.bpm) * 6,
      gainDb: 0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 0,
      fadeOutBeats: 0.25,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-bass",
      trackId: "trk-2",
      name: "Reese Sub Bass (Bars 1-4)",
      color: "#36cfc9",
      startBeat: 0,
      durationBeats: 16,
      sourceOffsetSec: 0,
      gainDb: 0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 0.25,
      fadeOutBeats: 0.5,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-chords",
      trackId: "trk-3",
      name: "Warm Chords A",
      color: "#9254de",
      startBeat: 0,
      durationBeats: 8,
      sourceOffsetSec: 0,
      gainDb: 0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 0.5,
      fadeOutBeats: 0.25,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-chords",
      trackId: "trk-3",
      name: "Warm Chords B",
      color: "#9254de",
      startBeat: 8,
      durationBeats: 8,
      sourceOffsetSec: (60 / project.bpm) * 8,
      gainDb: 0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 0.25,
      fadeOutBeats: 1.0,
      reverse: false,
      muted: false,
    },
    {
      id: nextId("clip"),
      assetId: "stem-arp",
      trackId: "trk-4",
      name: "Pluck Lead Arp (Entry)",
      color: "#fadb14",
      startBeat: 4,
      durationBeats: 12,
      sourceOffsetSec: 0,
      gainDb: -1.0,
      pan: 0,
      pitchSemitones: 0,
      fadeInBeats: 1.0,
      fadeOutBeats: 1.0,
      reverse: false,
      muted: false,
    },
  ];

  ui.selectedClipIds.clear();
  if (project.clips.length > 0) {
    ui.selectedClipIds.add(project.clips[0].id);
  }
  applyTheme(ui.theme, false);
  updateTrackInspector();
}

function onProjectMutated(statusText = null) {
  if (statusText) setStatus(statusText);
  dom.projectName.value = project.name;
  dom.bpmInput.value = project.bpm;
  dom.masterVol.value = project.masterVolumeDb ?? 0;
  dom.btnLoop.classList.toggle("active", !!project.loopEnabled);
  dom.btnMetro.classList.toggle("active", !!project.metronome);

  engine.syncTrackNodes(project);
  if (engine.isPlaying) {
    engine.play(project, assets, engine.getPlayheadBeat(project));
  }
  renderTrackHeaders();
  renderChannelRack();
  renderMixerStrips();
  renderTrellisPads();
  updateClipInspector();
  updateTrackInspector();
  drawAllCanvases();
}

/**
 * Renders the 8-pad Multi-Touch Trellis Slice Launcher in the bottom dock
 */
function renderTrellisPads() {
  if (!dom.trellisPadMatrix) return;
  dom.trellisPadMatrix.innerHTML = "";

  const padDefs = [
    { label: "Kick Hit", assetId: "stem-drums", offsetBeat: 0, dur: 1, color: "#ff7a45", rev: false },
    { label: "Snare Hit", assetId: "stem-drums", offsetBeat: 1, dur: 1, color: "#ff7a45", rev: false },
    { label: "Break 2b", assetId: "stem-drums", offsetBeat: 2, dur: 2, color: "#ffa940", rev: false },
    { label: "Rev Fill", assetId: "stem-drums", offsetBeat: 1, dur: 1, color: "#fa541c", rev: true },
    { label: "Reese Sub", assetId: "stem-bass", offsetBeat: 0, dur: 2, color: "#36cfc9", rev: false },
    { label: "Chord Stab", assetId: "stem-chords", offsetBeat: 0, dur: 2, color: "#9254de", rev: false },
    { label: "Lead Motif", assetId: "stem-arp", offsetBeat: 0, dur: 2, color: "#fadb14", rev: false },
    { label: "Arp High", assetId: "stem-arp", offsetBeat: 2, dur: 2, color: "#52c41a", rev: false, pitch: 5 },
  ];

  const secPerBeat = 60 / project.bpm;
  padDefs.forEach((def, idx) => {
    const pad = document.createElement("button");
    pad.className = "matrix-pad";
    pad.style.borderColor = def.color;
    pad.innerHTML = `
      <div class="matrix-pad-name" style="color:${def.color}">${idx + 1} · ${def.label}</div>
      <div class="matrix-pad-meta">${def.dur} beat${def.dur > 1 ? "s" : ""}${def.rev ? " · REV" : ""}</div>
    `;

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

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = 0.85;
  src.connect(g);
  g.connect(engine.masterGain);

  const offsetSec = Math.min(Math.max(0, buf.duration - 0.05), (def.offsetBeat || 0) * secPerBeat);
  const durSec = Math.min(buf.duration, def.dur * secPerBeat);
  src.start(0, offsetSec, durSec);

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
  if (assets.size === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:12px 6px;color:#93a1b0;font-size:11.5px;text-align:center;";
    empty.textContent = "No stems in pool. Tap '+ Import Audio' or '↺ Demo' above.";
    dom.assetList.appendChild(empty);
    return;
  }

  if (!ui.activeAssetId || !assets.has(ui.activeAssetId)) {
    ui.activeAssetId = assets.keys().next().value || null;
  }

  for (const asset of assets.values()) {
    const card = document.createElement("div");
    card.className = "asset-card" + (asset.id === ui.activeAssetId ? " selected-stem" : "");
    card.style.borderLeftColor = asset.color || "#ff7a45";
    card.draggable = true;

    card.addEventListener("click", () => {
      ui.activeAssetId = asset.id;
      renderAssetPool();
      renderChannelRack();
      drawPianoRollCanvas();
      setStatus(`Active Channel/Stem: "${asset.name}" (Click steps in Channel Rack, notes in Piano Roll, or double-click Playlist)`);
    });

    card.addEventListener("dragstart", (ev) => {
      ui.activeAssetId = asset.id;
      ev.dataTransfer.setData("text/plain", asset.id);
    });

    const top = document.createElement("div");
    top.className = "asset-card-top";

    const nameEl = document.createElement("div");
    nameEl.className = "asset-name";
    nameEl.title = asset.name;
    nameEl.textContent = asset.name;

    const actions = document.createElement("div");
    actions.className = "asset-actions";

    const btnPrev = document.createElement("button");
    btnPrev.textContent = "▶";
    btnPrev.title = "Audition / Preview stem";
    btnPrev.addEventListener("click", (e) => {
      e.stopPropagation();
      auditionAsset(asset);
    });

    const btnAdd = document.createElement("button");
    btnAdd.textContent = "＋ Track";
    btnAdd.title = "Add stem clip to selected track at Playhead";
    btnAdd.addEventListener("click", (e) => {
      e.stopPropagation();
      addAssetClipToPlaylist(
        asset.id,
        ui.selectedTrackId || project.tracks[0]?.id,
        engine.getPlayheadBeat(project)
      );
    });

    const btnDel = document.createElement("button");
    btnDel.className = "del-asset-btn";
    btnDel.textContent = "🗑";
    btnDel.title = "Delete / Remove this stem and its clips";
    btnDel.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      assets.delete(asset.id);
      project.clips = project.clips.filter((c) => c.assetId !== asset.id);
      ui.selectedClipIds.clear();
      renderAssetPool();
      onProjectMutated(`Removed stem "${asset.name}"`);
    });

    actions.append(btnPrev, btnAdd, btnDel);
    top.append(nameEl, actions);

    const meta = document.createElement("div");
    meta.className = "asset-meta";
    const beats = (asset.durationSec * (project.bpm / 60)).toFixed(1);
    meta.innerHTML = `<span>${asset.durationSec.toFixed(2)}s (${beats} beats)</span><span>${(asset.sampleRate / 1000).toFixed(1)}kHz</span>`;

    card.append(top, meta);
    dom.assetList.appendChild(card);
  }
}

function auditionAsset(asset) {
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
    });

    const strip = document.createElement("div");
    strip.className = "track-color-strip";
    strip.style.background = track.color || "#ff7a45";

    const topRow = document.createElement("div");
    topRow.className = "track-row-top";

    const title = document.createElement("div");
    title.className = "track-title";
    title.textContent = track.name;
    title.title = "Double-click to rename track";
    title.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const next = prompt("Rename Track:", track.name);
      if (next && next.trim()) {
        pushUndoState();
        track.name = next.trim();
        onProjectMutated(`Renamed track to ${track.name}`);
      }
    });

    const btns = document.createElement("div");
    btns.className = "track-btns";

    const btnMute = document.createElement("button");
    btnMute.className = "trk-btn mute" + (track.muted ? " on" : "");
    btnMute.textContent = "M";
    btnMute.title = "Mute Track";
    btnMute.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      track.muted = !track.muted;
      onProjectMutated(`${track.name} ${track.muted ? "muted" : "unmuted"}`);
    });

    const btnSolo = document.createElement("button");
    btnSolo.className = "trk-btn solo" + (track.solo ? " on" : "");
    btnSolo.textContent = "S";
    btnSolo.title = "Solo Track";
    btnSolo.addEventListener("click", (e) => {
      e.stopPropagation();
      pushUndoState();
      track.solo = !track.solo;
      onProjectMutated(`${track.name} ${track.solo ? "soloed" : "unsoloed"}`);
    });

    const btnDel = document.createElement("button");
    btnDel.className = "trk-btn del-trk";
    btnDel.textContent = "×";
    btnDel.title = "Delete Track & its clips";
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
    volSlider.value = track.volumeDb ?? 0;
    volSlider.title = `Track Volume: ${track.volumeDb ?? 0} dB`;
    volSlider.addEventListener("input", (e) => {
      track.volumeDb = Number(e.target.value);
      volSlider.title = `Track Volume: ${track.volumeDb} dB`;
      engine.syncTrackNodes(project);
    });

    const panLbl = document.createElement("span");
    panLbl.textContent = "Pan";
    const panSlider = document.createElement("input");
    panSlider.type = "range";
    panSlider.min = "-1";
    panSlider.max = "1";
    panSlider.step = "0.05";
    panSlider.value = track.pan ?? 0;
    panSlider.title = `Track Pan: ${track.pan ?? 0}`;
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
  onProjectMutated(`Moved clip ${deltaBeats > 0 ? "Right ▶" : "◀ Left"}`);
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
    dom.playIcon.textContent = "▶";
  }
  assets.clear();
  project.clips = [];
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
  dom.inspGain.value = clip.gainDb || 0;
  dom.inspGainVal.textContent = `${(clip.gainDb || 0) >= 0 ? "+" : ""}${(clip.gainDb || 0).toFixed(1)} dB`;
  dom.inspPitch.value = clip.pitchSemitones || 0;
  dom.inspPitchVal.textContent = `${(clip.pitchSemitones || 0) >= 0 ? "+" : ""}${clip.pitchSemitones || 0} st`;
  dom.inspPan.value = clip.pan || 0;
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
  dom.trkEqLow.value = track.eqLowDb ?? 0;
  dom.trkEqLowVal.textContent = `${(track.eqLowDb ?? 0).toFixed(1)} dB`;
  dom.trkEqMid.value = track.eqMidDb ?? 0;
  dom.trkEqMidVal.textContent = `${(track.eqMidDb ?? 0).toFixed(1)} dB`;
  dom.trkEqHigh.value = track.eqHighDb ?? 0;
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

function drawAllCanvases() {
  drawPlaylistCanvas();
  drawMinimapCanvas();
  drawPianoRollCanvas();
}

function drawPlaylistCanvas() {
  const canvas = dom.playlistCanvas;
  if (!canvas || canvas.clientWidth === 0) return;
  const { width, height, dpr } = resizeCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  const rulerH = ui.rulerHeight;
  const trackH = ui.trackHeight;
  const ppb = ui.pixelsPerBeat;
  const startBeat = ui.scrollBeat;
  const endBeat = startBeat + width / ppb;
  const theme = getActiveTheme();

  // 1. Track Lane Backgrounds
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, width, height);

  project.tracks.forEach((trk, idx) => {
    const y = rulerH + idx * trackH - ui.scrollY;
    if (y + trackH < rulerH || y > height) return;
    ctx.fillStyle = idx % 2 === 0 ? theme.laneEven : theme.laneOdd;
    if (trk.id === ui.selectedTrackId) {
      ctx.fillStyle = theme.laneSelected;
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
    ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
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
    ctx.strokeStyle = isBar ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.07)";
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
      ctx.fillStyle = "rgba(54, 207, 201, 0.04)";
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

    // Clip header bar
    const headH = 22;
    ctx.fillStyle = clip.muted ? "#454e59" : hexToRgba(baseColor, 0.88);
    ctx.fillRect(x, y, w, headH);

    // Clip label (Manus AI typography scale)
    ctx.fillStyle = "#0e1116";
    ctx.font = '600 13px "DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
    const flags = [];
    if (clip.reverse) flags.push("REV");
    if (clip.pitchSemitones) flags.push(`${clip.pitchSemitones > 0 ? "+" : ""}${clip.pitchSemitones}st`);
    const labelText = flags.length > 0 ? `${clip.name} [${flags.join(" · ")}]` : clip.name;
    ctx.fillText(labelText, x + 7, y + 15.5);

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

    // Direct 1-tap "⋯" Menu & "×" Delete Clip buttons on top-right of clip header
    if (w >= 46) {
      const mxBtn = x + w - 33;
      const by = y + 2;
      ctx.fillStyle = "rgba(18, 21, 25, 0.72)";
      ctx.beginPath();
      ctx.roundRect(mxBtn, by, 14, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#e6edf3";
      ctx.font = "800 10px sans-serif";
      ctx.fillText("⋯", mxBtn + 2, by + 10.5);
    }
    if (w >= 28) {
      const bx = x + w - 17;
      const by = y + 2;
      ctx.fillStyle = "rgba(18, 21, 25, 0.72)";
      ctx.beginPath();
      ctx.roundRect(bx, by, 14, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#ffa39e";
      ctx.font = "800 11px sans-serif";
      ctx.fillText("×", bx + 3.5, by + 11);
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
      ctx.fillRect(cutX - 24, y + 2, 48, 15);
      ctx.fillStyle = "#fff";
      ctx.font = "700 10px monospace";
      ctx.fillText(`CUT ${formatBeatBar(ui.hoverBeat)}`, cutX - 21, y + 13);
    }
  }

  // 6. Box Selection Marquee
  if (ui.dragState && ui.dragState.mode === "marquee") {
    const { x0, y0, x1, y1 } = ui.dragState;
    const rx = Math.min(x0, x1);
    const ry = Math.min(y0, y1);
    const rw = Math.abs(x1 - x0);
    const rh = Math.abs(y1 - y0);
    ctx.fillStyle = "rgba(54, 207, 201, 0.15)";
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = "#36cfc9";
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

  ctx.fillStyle = "#93a1b0";
  ctx.font = '600 12px "JetBrains Mono", "Geist Mono", monospace';
  for (let b = firstBeatInt; b <= lastBeatInt; b++) {
    const x = Math.round(beatToX(b)) + 0.5;
    if (x < 0 || x > width) continue;
    const isBar = b % 4 === 0;
    ctx.strokeStyle = isBar ? "#6b7988" : "#3a4350";
    ctx.beginPath();
    ctx.moveTo(x, isBar ? 14 : 23);
    ctx.lineTo(x, rulerH);
    ctx.stroke();

    if (isBar) {
      const barNum = Math.floor(b / 4) + 1;
      ctx.fillText(`${barNum}`, x + 4, 27);
    } else if (ppb >= 65) {
      const beatInBar = (b % 4) + 1;
      ctx.fillStyle = "#627080";
      ctx.fillText(`${Math.floor(b / 4) + 1}.${beatInBar}`, x + 3, 28);
      ctx.fillStyle = "#93a1b0";
    }
  }

  // Section Markers (with "×" to delete)
  for (const m of project.markers || []) {
    const mx = beatToX(m.beat);
    if (mx < -60 || mx > width + 60) continue;
    ctx.fillStyle = m.color || "#36cfc9";
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx + 66, 0);
    ctx.lineTo(mx + 60, 15);
    ctx.lineTo(mx, 15);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#0d1117";
    ctx.font = '600 11px "DM Sans", "Inter", -apple-system, sans-serif';
    ctx.fillText(m.name.slice(0, 8), mx + 4, 11.5);
    ctx.fillText("×", mx + 52, 11.5);

    ctx.strokeStyle = hexToRgba(m.color || "#36cfc9", 0.45);
    ctx.beginPath();
    ctx.moveTo(mx + 0.5, 13);
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
 * FL STUDIO CHANNEL RACK & 16-STEP SEQUENCER (F6)
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

function renderChannelRack() {
  if (!dom.channelRackRows) return;
  dom.channelRackRows.innerHTML = "";
  const pat = getActivePattern();
  if (dom.crPatternLabel) {
    dom.crPatternLabel.textContent = pat.name.split("—")[0].trim();
  }

  let idx = 1;
  for (const asset of assets.values()) {
    const steps = ensurePatternStepsForAsset(pat, asset.id);
    const row = document.createElement("div");
    row.className = "cr-row" + (asset.id === ui.activeAssetId ? " active-channel" : "");

    const led = document.createElement("div");
    led.className = "cr-led" + (asset.muted ? "" : " on");
    led.title = "Channel Mute / Active Switch";
    led.addEventListener("click", (e) => {
      e.stopPropagation();
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
        steps[s] = steps[s] ? 0 : 1;
        stepBtn.classList.toggle("active", !!steps[s]);
        if (steps[s]) {
          previewAssetOneShot(asset, 0, 0.25);
        }
      });
      stepBtn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        steps[s] = 0;
        stepBtn.classList.remove("active");
      });
      stepsGrid.appendChild(stepBtn);
    }

    row.append(led, insertBox, chBtn, stepsGrid);
    dom.channelRackRows.appendChild(row);
    idx++;
  }
}

function previewAssetOneShot(asset, pitchSt = 0, maxSec = 0.45, gainVal = 0.85) {
  if (!asset || !asset.buffer) return;
  const ctx = engine.ensureContext();
  const src = ctx.createBufferSource();
  src.buffer = asset.buffer;
  src.playbackRate.value = Math.pow(2, pitchSt / 12);
  const g = ctx.createGain();
  g.gain.value = gainVal;
  src.connect(g);
  g.connect(engine.masterGain);
  src.start(0, 0, Math.min(maxSec, asset.durationSec));
}

function playChannelRackPatternPreview() {
  const pat = getActivePattern();
  const stepDurSec = 60 / project.bpm / 4; // 16th note
  let step = 0;
  setStatus(`▶ Auditioning ${pat.name} (16 steps)`);
  const timer = setInterval(() => {
    document.querySelectorAll(".cr-step").forEach((el) => {
      el.classList.toggle("playing-step", Number(el.dataset.stepIndex) === step);
    });
    for (const asset of assets.values()) {
      if (asset.muted) continue;
      const arr = pat.steps[asset.id];
      if (arr && arr[step]) {
        previewAssetOneShot(asset, 0, stepDurSec * 1.8, 0.75);
      }
    }
    step++;
    if (step >= 16) {
      clearInterval(timer);
      setTimeout(() => {
        document.querySelectorAll(".cr-step.playing-step").forEach((el) => el.classList.remove("playing-step"));
      }, 120);
    }
  }, stepDurSec * 1000);
}

function stampChannelRackPatternToPlaylist() {
  const pat = getActivePattern();
  pushUndoState();
  const baseBeat = snapBeat(engine.getPlayheadBeat(project));
  let added = 0;
  let assetIndex = 0;
  for (const asset of assets.values()) {
    const steps = pat.steps[asset.id];
    if (!steps) {
      assetIndex++;
      continue;
    }
    const track = project.tracks[assetIndex % project.tracks.length];
    for (let s = 0; s < 16; s++) {
      if (!steps[s]) continue;
      const clip = {
        id: nextId("clip"),
        assetId: asset.id,
        trackId: track.id,
        name: `${asset.name.split(" ")[0]} [S${s + 1}]`,
        color: asset.color || track.color,
        startBeat: Number((baseBeat + s * 0.25).toFixed(4)),
        durationBeats: 0.25,
        sourceOffsetSec: 0,
        gainDb: 0,
        pan: 0,
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
  onProjectMutated(`Stamped ${pat.name} (${added} step slices) at ${formatBeatBar(baseBeat)}`);
}

/**
 * FL STUDIO PIANO ROLL & VELOCITY EDITOR (F7)
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
      ctx.font = '700 10.5px "DM Sans", "Inter", sans-serif';
      ctx.fillText(info.note, 13, y + rowH - 1.5);
    } else if (!info.black && rowH >= 8.5) {
      ctx.fillStyle = "#64748b";
      ctx.font = '600 9.5px "DM Sans", "Inter", sans-serif';
      ctx.fillText(info.note, 20, y + rowH - 1);
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
    ctx.fillStyle = "#191026";
    ctx.font = '700 10.5px "Avenir Next LT Pro", "DM Sans", "Inter", sans-serif';
    ctx.fillText(rowInfo.note, nx + 3, ny + nh - 1);
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
  ctx.font = '700 9.5px "Avenir Next LT Pro", sans-serif';
  ctx.fillText("VEL", 6, gridH + 12);

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

  ctx.restore();
}

function setupPianoRollInteractions() {
  const canvas = dom.pianoRollCanvas;
  if (!canvas) return;

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
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
      setStatus(`🎹 Piano Roll Key: ${info.note}`);
      return;
    }

    // Click/Drag in Bottom Velocity Lane -> Adjust Velocity Stalk
    if (y > gridH && x > keyW) {
      const step = (x - keyW) / stepW;
      const target = pat.notes.find((n) => Math.abs(n.startStep - step) < 1.2);
      if (target) {
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

function playPianoRollPreview() {
  const pat = getActivePattern();
  const activeAsset = assets.get(ui.activeAssetId) || Array.from(assets.values())[0];
  if (!activeAsset) return;
  const stepSec = 60 / project.bpm / 4;
  for (const n of pat.notes) {
    const info = PR_ROWS[n.row] || PR_ROWS[4];
    setTimeout(() => {
      previewAssetOneShot(activeAsset, info.semi, n.lenSteps * stepSec, n.vel ?? 0.85);
    }, n.startStep * stepSec * 1000);
  }
  setStatus(`▶ Playing Piano Roll pattern (${pat.notes.length} notes) on "${activeAsset.name}"`);
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
  const newSel = new Set();
  for (const n of pat.notes) {
    const info = PR_ROWS[n.row] || PR_ROWS[4];
    const clip = {
      id: nextId("clip"),
      assetId: activeAsset.id,
      trackId: targetTrack.id,
      name: `${info.note} · ${activeAsset.name.split(" ")[0]}`,
      color: "#4ade80",
      startBeat: Number((baseBeat + n.startStep * 0.25).toFixed(4)),
      durationBeats: Number((n.lenSteps * 0.25).toFixed(4)),
      sourceOffsetSec: 0,
      gainDb: Number(((n.vel - 0.85) * 18).toFixed(1)),
      pan: 0,
      pitchSemitones: info.semi,
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
 * FL STUDIO MULTI-INSERT MIXER & FX SLOTS WINDOW (F9)
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
    <div class="mixer-strip-name">Master</div>
    <div class="cr-led on" title="Master Active"></div>
    <div class="mixer-fader-row">
      <input type="range" class="mixer-v-fader" min="-36" max="6" step="0.5" value="${project.masterVolumeDb ?? 0}" title="Master Fader" />
      <div class="mixer-v-meter"><div class="mixer-v-meter-fill" data-mixer-meter="master"></div></div>
    </div>
    <div class="mixer-db-lbl" id="mixer-master-db">${(project.masterVolumeDb ?? 0).toFixed(1)}dB</div>
  `;
  const mFader = masterStrip.querySelector(".mixer-v-fader");
  const mLbl = masterStrip.querySelector("#mixer-master-db");
  mFader.addEventListener("input", () => {
    project.masterVolumeDb = Number(mFader.value);
    dom.masterVol.value = project.masterVolumeDb;
    mLbl.textContent = `${project.masterVolumeDb.toFixed(1)}dB`;
    engine.syncTrackNodes(project);
  });
  dom.mixerStripsContainer.appendChild(masterStrip);

  // 2. Insert Strips 1..N (Linked 1:1 with Playlist Tracks + extra FL Inserts up to 10)
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
      <div class="mixer-strip-topbar" style="background:${color}"></div>
      <div class="mixer-strip-num">${i + 1}</div>
      <div class="mixer-strip-name">${name}</div>
      <div class="cr-led ${muted ? "" : "on"}" title="Mute / Unmute Insert ${i + 1}"></div>
      <div class="mixer-fader-row">
        <input type="range" class="mixer-v-fader" min="-36" max="6" step="0.5" value="${vol}" ${trk ? "" : "disabled"} />
        <div class="mixer-v-meter"><div class="mixer-v-meter-fill" data-mixer-meter="${trk ? trk.id : ""}"></div></div>
      </div>
      <div class="mixer-db-lbl">${vol.toFixed(1)}dB</div>
    `;

    if (trk) {
      strip.addEventListener("click", () => {
        ui.selectedTrackId = trk.id;
        if (dom.fxTrackName) dom.fxTrackName.textContent = trk.name;
        if (dom.mixerSelectedLabel) dom.mixerSelectedLabel.textContent = `Insert ${i + 1} — ${trk.name}`;
        renderTrackHeaders();
        renderMixerStrips();
        updateTrackInspector();
      });

      const led = strip.querySelector(".cr-led");
      led.addEventListener("click", (e) => {
        e.stopPropagation();
        trk.muted = !trk.muted;
        onProjectMutated(`${trk.name} ${trk.muted ? "muted" : "unmuted"}`);
      });

      const fader = strip.querySelector(".mixer-v-fader");
      const dbLbl = strip.querySelector(".mixer-db-lbl");
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
  const clean = (hex || "#ff7a45").replace("#", "");
  const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatBeatBar(beat) {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / 4) + 1;
  const beatInBar = Math.floor(b % 4) + 1;
  const step = Math.floor((b % 1) * 4 + 1);
  return `${String(bar).padStart(3, "0")} : ${String(beatInBar).padStart(2, "0")} : ${String(step).padStart(2, "0")}`;
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
      // Top-right "×" delete button & "⋯" menu button on clip header
      if (w >= 28 && relY <= 18 && relX >= w - 18) zone = "delete-btn";
      else if (w >= 46 && relY <= 18 && relX >= w - 34 && relX < w - 18) zone = "menu-btn";
      else if (relY <= 16 && relX <= 12) zone = "fade-in";
      else if (relY <= 16 && relX >= w - 12 && w < 28) zone = "fade-out";
      else if (relX <= edgeZone && w > edgeZone * 2.5) zone = "trim-left";
      else if (relX >= w - edgeZone && w > edgeZone * 2.5) zone = "trim-right";
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
    const hit = hitTestClip(x, y);
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

    // Middle-mouse button drag -> FL Studio Pan Timeline
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
      if (y <= 14 && Array.isArray(project.markers)) {
        for (let i = project.markers.length - 1; i >= 0; i--) {
          const m = project.markers[i];
          const mx = beatToX(m.beat);
          if (x >= mx + 44 && x <= mx + 62) {
            pushUndoState();
            project.markers.splice(i, 1);
            onProjectMutated(`Removed marker "${m.name}"`);
            return;
          }
        }
      }
      const lx0 = beatToX(project.loopStartBeat);
      const lx1 = beatToX(project.loopEndBeat);
      if (y <= 15 && Math.abs(x - lx0) <= 10) {
        ui.dragState = { mode: "loop-start" };
      } else if (y <= 15 && Math.abs(x - lx1) <= 10) {
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
      openClipContextMenu(hit.clip, x, y);
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

    // 3. Active Tool: DELETE (Erase — click or drag across clips like FL Studio)
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

    // 3b. Active Tool: PAINT BRUSH (FL Studio "B" Tool — drag horizontally to paint repeating clips)
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

    // 7. Active Tool: DRAW / MOVE / TRIM / FADE (with FL Studio Shift+Drag to Clone!)
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
        // FL Studio Shift + Drag on clip body -> Clone selected clip(s) and drag the clones!
        if (e.shiftKey) {
          const clones = movingClips.map((c) => ({
            ...c,
            id: nextId("clip"),
          }));
          project.clips.push(...clones);
          ui.selectedClipIds = new Set(clones.map((c) => c.id));
          movingClips = clones;
          setStatus(`Cloned ${clones.length} clip(s) (FL Shift+Drag)`);
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
      dom.zoomSlider.value = ui.pixelsPerBeat;
      ui.scrollBeat = Math.max(0, ui.pinchState.anchorBeat - midX / ui.pixelsPerBeat);
      dom.hscrollSlider.value = ui.scrollBeat;

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
    dom.cursorInfo.textContent = `Bar ${barNum}, Beat ${beatInBar.toFixed(2)} · Snap: ${
      ui.snapBeats ? ui.snapBeats + " Beat" : "Free"
    }`;

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
        dom.hscrollSlider.value = ui.scrollBeat;
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
        setStatus(`Track Height: ${ui.trackHeight}px (FL Alt+Wheel)`);
      } else if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        ui.pixelsPerBeat = Math.max(18, Math.min(160, Math.round(ui.pixelsPerBeat * factor)));
        dom.zoomSlider.value = ui.pixelsPerBeat;
        drawAllCanvases();
      } else {
        const deltaBeats = (e.deltaX !== 0 ? e.deltaX : e.deltaY) / ui.pixelsPerBeat;
        ui.scrollBeat = Math.max(0, ui.scrollBeat + deltaBeats * 0.65);
        dom.hscrollSlider.value = ui.scrollBeat;
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
    dom.hscrollSlider.value = ui.scrollBeat;
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

function openClipContextMenu(clip, x, y) {
  if (!dom.clipContextMenu) return;
  dom.ctxClipTitle.textContent = clip.name;
  dom.clipContextMenu.hidden = false;
  const vw = dom.timelineViewport.clientWidth;
  const vh = dom.timelineViewport.clientHeight;
  const left = Math.max(8, Math.min(vw - 238, x - 110));
  const top = Math.max(8, Math.min(vh - 185, y + 14));
  dom.clipContextMenu.style.left = `${left}px`;
  dom.clipContextMenu.style.top = `${top}px`;
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

// FL Studio 2-Octave Typing Keyboard to Piano Map (key -> [semitoneOffset, noteName])
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
  const src = ctx.createBufferSource();
  src.buffer = asset.buffer;
  src.playbackRate.value = Math.pow(2, (semitoneOffset - 12) / 12);
  const g = ctx.createGain();
  g.gain.value = 0.85;
  src.connect(g);
  g.connect(engine.masterGain);
  src.start(0, 0, Math.min(2.5, asset.durationSec));
  setStatus(`🎹 Typing Piano: ${noteName} (${semitoneOffset - 12 >= 0 ? "+" : ""}${semitoneOffset - 12} st) · ${asset.name}`);
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
    n > 1 ? `MULTI-TOUCH (${n} FINGERS)` : "ARRANGEMENT MAP";
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
          name: `${project.tracks.length + 1} · ${file.name.replace(/\.[^.]+$/, "").slice(0, 14)}`,
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
 * EXPORT / BOUNCE ARRANGEMENT OR STEMS TO WAV
 */
async function executeExport() {
  const prefix = (dom.exportFilename.value || "pulseforge-mix").trim();
  const bitDepth = Number(dom.exportBitdepth.value || 24);
  const sampleRate = Number(dom.exportSamplerate.value || 44100);
  const rangeMode = dom.exportRange.value;
  const stemMode = dom.exportMode.value;

  const startBeat = rangeMode === "loop" ? project.loopStartBeat : 0;
  const maxEnd = project.clips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 4);
  const endBeat = rangeMode === "loop" ? project.loopEndBeat : maxEnd;

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
        const rendered = await engine.renderProjectOffline(project, assets, {
          sampleRate,
          startBeat,
          endBeat,
          onlyTrackId: trk.id,
        });
        const blob = encodeWavFromAudioBuffer(rendered, bitDepth);
        const safeTrk = trk.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        triggerDownload(blob, `${prefix}-${safeTrk}-${bitDepth}bit.wav`);
      }
      dom.exportStatus.textContent = `Exported ${tracksWithClips.length} track stems!`;
      setStatus(`Exported ${tracksWithClips.length} WAV stems`);
    }
  } catch (err) {
    dom.exportStatus.textContent = `Export error: ${err.message}`;
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
 * SAVE & LOAD PROJECT (.dawproj.json + Ubuntu server disk persistence)
 */
async function saveProject() {
  project.name = dom.projectName.value.trim() || "Ubuntu Session";
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...project,
  };

  try {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {}

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  triggerDownload(blob, `${safeName}.dawproj.json`);
  setStatus(`Saved project "${project.name}"`);
}

async function openProjectsModal() {
  dom.projectsModal.hidden = false;
  dom.savedProjectsList.innerHTML = "<div style='color:#93a1b0'>Loading saved projects…</div>";
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    dom.savedProjectsList.innerHTML = "";
    if (!data.projects || data.projects.length === 0) {
      dom.savedProjectsList.innerHTML =
        "<div style='color:#93a1b0'>No projects saved on server disk yet. Use Browse below to load a .dawproj.json file.</div>";
      return;
    }
    for (const p of data.projects) {
      const row = document.createElement("div");
      row.className = "saved-proj-row";
      row.innerHTML = `<strong>${p.name}</strong><span style="font-size:11px;color:#93a1b0">${new Date(
        p.updatedAt
      ).toLocaleString()}</span>`;
      row.addEventListener("click", async () => {
        const r = await fetch(`/api/projects/${encodeURIComponent(p.fileName)}`);
        const projData = await r.json();
        loadProjectObject(projData);
        dom.projectsModal.hidden = true;
      });
      dom.savedProjectsList.appendChild(row);
    }
  } catch (err) {
    dom.savedProjectsList.innerHTML = `<div style="color:#ff4d4f">${err.message}</div>`;
  }
}

function loadProjectObject(data) {
  if (!data || !Array.isArray(data.tracks) || !Array.isArray(data.clips)) {
    setStatus("Invalid project file");
    return;
  }
  pushUndoState();
  project = {
    name: data.name || "Imported Project",
    bpm: Number(data.bpm) || 124,
    masterVolumeDb: Number(data.masterVolumeDb ?? 0),
    loopEnabled: !!data.loopEnabled,
    loopStartBeat: Number(data.loopStartBeat ?? 0),
    loopEndBeat: Number(data.loopEndBeat ?? 16),
    metronome: !!data.metronome,
    markers: Array.isArray(data.markers) ? data.markers : [],
    tracks: data.tracks,
    clips: data.clips,
  };
  ui.selectedClipIds.clear();
  ui.selectedTrackId = project.tracks[0]?.id || null;
  onProjectMutated(`Loaded project "${project.name}"`);
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

  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeSwatch, true);
    });
  });

  if (dom.customAccentPicker) {
    dom.customAccentPicker.addEventListener("input", () => {
      const col = dom.customAccentPicker.value;
      document.body.style.setProperty("--accent-orange", col);
      document.body.style.setProperty("--accent-orange-bright", col);
      document.body.style.setProperty("--accent-amber", col);
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

    dom.btnTogglePool.classList.toggle("active", poolOpen);
    if (dom.btnToggleChannelRack) dom.btnToggleChannelRack.classList.toggle("active", crOpen);
    if (dom.btnTogglePianoRoll) dom.btnTogglePianoRoll.classList.toggle("active", prOpen);
    if (dom.btnToggleMixer) dom.btnToggleMixer.classList.toggle("active", mixOpen);
    dom.btnToggleTrellis.classList.toggle("active", !dom.trellisDock.classList.contains("collapsed"));
    dom.btnToggleInspector.classList.toggle("active", !dom.rightPanel.classList.contains("collapsed"));

    if (dom.flUpperDock) {
      dom.flUpperDock.classList.toggle("all-collapsed", !crOpen && !prOpen);
    }
    if (dom.btnLayoutPreset) {
      const anyRackOpen = crOpen || prOpen || mixOpen;
      dom.btnLayoutPreset.innerHTML = anyRackOpen
        ? '📐 Focus Playlist <kbd>F5</kbd>'
        : '📐 All 5 FL Windows <kbd>F5</kbd>';
    }
    if (dom.btnReopenPool) dom.btnReopenPool.hidden = poolOpen;
    setTimeout(drawAllCanvases, 25);
  };

  dom.btnTogglePool.addEventListener("click", () => {
    dom.leftPanel.classList.toggle("collapsed");
    syncWindowButtons();
  });
  dom.btnClosePool.addEventListener("click", () => {
    dom.leftPanel.classList.add("collapsed");
    syncWindowButtons();
  });
  if (dom.btnReopenPool) {
    dom.btnReopenPool.addEventListener("click", () => {
      dom.leftPanel.classList.remove("collapsed");
      syncWindowButtons();
    });
  }

  // Channel Rack (F6), Piano Roll (F7), Mixer (F9), and Layout Preset (F5)
  if (dom.btnToggleChannelRack && dom.channelRackWindow) {
    dom.btnToggleChannelRack.addEventListener("click", () => {
      dom.channelRackWindow.classList.toggle("collapsed");
      syncWindowButtons();
    });
  }
  if (dom.btnCloseChannelRack && dom.channelRackWindow) {
    dom.btnCloseChannelRack.addEventListener("click", () => {
      dom.channelRackWindow.classList.add("collapsed");
      syncWindowButtons();
    });
  }
  if (dom.btnTogglePianoRoll && dom.pianoRollWindow) {
    dom.btnTogglePianoRoll.addEventListener("click", () => {
      dom.pianoRollWindow.classList.toggle("collapsed");
      syncWindowButtons();
    });
  }
  if (dom.btnClosePianoRoll && dom.pianoRollWindow) {
    dom.btnClosePianoRoll.addEventListener("click", () => {
      dom.pianoRollWindow.classList.add("collapsed");
      syncWindowButtons();
    });
  }
  if (dom.btnToggleMixer && dom.mixerWindow) {
    dom.btnToggleMixer.addEventListener("click", () => {
      dom.mixerWindow.classList.toggle("collapsed");
      syncWindowButtons();
    });
  }
  if (dom.btnCloseMixer && dom.mixerWindow) {
    dom.btnCloseMixer.addEventListener("click", () => {
      dom.mixerWindow.classList.add("collapsed");
      syncWindowButtons();
    });
  }
  if (dom.btnMixerOpenInsp) {
    dom.btnMixerOpenInsp.addEventListener("click", () => {
      dom.rightPanel.classList.toggle("collapsed");
      syncWindowButtons();
    });
  }
  if (dom.btnLayoutPreset) {
    dom.btnLayoutPreset.addEventListener("click", () => {
      const anyRackOpen =
        !dom.channelRackWindow.classList.contains("collapsed") ||
        !dom.pianoRollWindow.classList.contains("collapsed") ||
        !dom.mixerWindow.classList.contains("collapsed");
      if (anyRackOpen) {
        dom.channelRackWindow.classList.add("collapsed");
        dom.pianoRollWindow.classList.add("collapsed");
        dom.mixerWindow.classList.add("collapsed");
        setStatus("F5 Layout: Focus Playlist + Browser");
      } else {
        dom.leftPanel.classList.remove("collapsed");
        dom.channelRackWindow.classList.remove("collapsed");
        dom.pianoRollWindow.classList.remove("collapsed");
        dom.mixerWindow.classList.remove("collapsed");
        setStatus("F5 Layout: All 5 FL Studio Windows Docked (Browser · Channel Rack · Piano Roll · Playlist · Mixer)");
      }
      syncWindowButtons();
    });
  }

  // PAT / SONG Mode Selector
  if (dom.btnModePat && dom.btnModeSong) {
    dom.btnModePat.addEventListener("click", () => {
      ui.transportMode = "pat";
      dom.btnModePat.classList.add("active");
      dom.btnModeSong.classList.remove("active");
      setStatus("FL Mode: PAT (Plays active 16-Step Channel Rack & Piano Roll pattern)");
    });
    dom.btnModeSong.addEventListener("click", () => {
      ui.transportMode = "song";
      dom.btnModeSong.classList.add("active");
      dom.btnModePat.classList.remove("active");
      setStatus("FL Mode: SONG (Plays full Playlist arrangement)");
    });
  }

  // Pattern Selector & Channel Rack / Piano Roll Controls
  if (dom.patternSelect) {
    dom.patternSelect.addEventListener("change", () => {
      ui.activePatternIndex = Number(dom.patternSelect.value) || 0;
      renderChannelRack();
      drawPianoRollCanvas();
      setStatus(`Selected ${getActivePattern().name}`);
    });
  }
  if (dom.btnStampPattern) {
    dom.btnStampPattern.addEventListener("click", stampChannelRackPatternToPlaylist);
  }
  if (dom.btnCrPlay) {
    dom.btnCrPlay.addEventListener("click", playChannelRackPatternPreview);
  }
  if (dom.btnCrStamp) {
    dom.btnCrStamp.addEventListener("click", stampChannelRackPatternToPlaylist);
  }
  if (dom.btnCrClear) {
    dom.btnCrClear.addEventListener("click", () => {
      const pat = getActivePattern();
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

  // Browser Folder Tabs
  document.querySelectorAll(".fl-folder-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".fl-folder-item").forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      setStatus(`Browser Folder: ${item.textContent.trim()}`);
    });
  });

  // FL Studio Top Menu Bar items + Live Hover Hint Panel
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

  document.addEventListener("mouseover", (e) => {
    const titled = e.target.closest("[title]");
    if (titled && titled.title) {
      dom.statusPill.textContent = titled.title;
    }
  });

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

  dom.btnToggleTrellis.addEventListener("click", () => {
    dom.trellisDock.classList.toggle("collapsed");
    syncWindowButtons();
  });
  dom.btnCloseTrellis.addEventListener("click", () => {
    dom.trellisDock.classList.add("collapsed");
    syncWindowButtons();
  });

  dom.btnToggleInspector.addEventListener("click", () => {
    dom.rightPanel.classList.toggle("collapsed");
    syncWindowButtons();
  });
  dom.btnCloseInspector.addEventListener("click", () => {
    dom.rightPanel.classList.add("collapsed");
    syncWindowButtons();
  });

  // Transport
  dom.btnPlay.addEventListener("click", () => {
    if (engine.isPlaying) {
      engine.pause(project);
      dom.btnPlay.classList.remove("playing");
      dom.playIcon.textContent = "▶";
      setStatus("Paused");
    } else {
      engine.play(project, assets);
      dom.btnPlay.classList.add("playing");
      dom.playIcon.textContent = "⏸";
      setStatus("Playing arrangement…");
    }
  });

  dom.btnStop.addEventListener("click", () => {
    engine.stop(project);
    dom.btnPlay.classList.remove("playing");
    dom.playIcon.textContent = "▶";
    drawAllCanvases();
    setStatus("Stopped");
  });

  dom.timeReadoutBox.addEventListener("click", () => {
    engine.seek(project, assets, 0);
    drawAllCanvases();
    setStatus("Playhead reset to Bar 1");
  });

  dom.btnLoop.addEventListener("click", () => {
    project.loopEnabled = !project.loopEnabled;
    onProjectMutated(`Loop ${project.loopEnabled ? "enabled" : "disabled"}`);
  });

  dom.btnMetro.addEventListener("click", () => {
    project.metronome = !project.metronome;
    onProjectMutated(`Metronome ${project.metronome ? "ON" : "OFF"}`);
  });

  dom.bpmDown.addEventListener("click", () => {
    project.bpm = Math.max(40, project.bpm - 1);
    onProjectMutated(`Tempo set to ${project.bpm} BPM`);
  });
  dom.bpmUp.addEventListener("click", () => {
    project.bpm = Math.min(260, project.bpm + 1);
    onProjectMutated(`Tempo set to ${project.bpm} BPM`);
  });
  dom.bpmInput.addEventListener("change", () => {
    project.bpm = Math.max(40, Math.min(260, Number(dom.bpmInput.value) || 124));
    onProjectMutated(`Tempo set to ${project.bpm} BPM`);
  });

  dom.masterVol.addEventListener("input", () => {
    project.masterVolumeDb = Number(dom.masterVol.value);
    engine.syncTrackNodes(project);
  });

  dom.projectName.addEventListener("change", () => {
    project.name = dom.projectName.value.trim() || "Ubuntu Session";
  });

  // Tools
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTool(btn.dataset.tool));
  });

  dom.snapSelect.addEventListener("change", () => {
    ui.snapBeats = Number(dom.snapSelect.value);
    setStatus(`Snap set to ${dom.snapSelect.options[dom.snapSelect.selectedIndex].text}`);
    drawAllCanvases();
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
      name: `${idx} · Audio Track ${idx}`,
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
  dom.fileImportInput.addEventListener("change", async (e) => {
    await handleAudioFilesImport(e.target.files);
    dom.fileImportInput.value = "";
  });

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
    await handleAudioFilesImport(e.dataTransfer.files);
  });

  dom.btnLoadDemo.addEventListener("click", () => {
    pushUndoState();
    loadBuiltInDemoArrangement();
    setStatus("Restored 4-stem demo arrangement");
  });

  dom.btnExportModal.addEventListener("click", () => {
    dom.exportStatus.textContent = "";
    dom.exportModal.hidden = false;
  });
  dom.btnCloseExport.addEventListener("click", () => (dom.exportModal.hidden = true));
  dom.btnCancelExport.addEventListener("click", () => (dom.exportModal.hidden = true));
  dom.btnRunExport.addEventListener("click", executeExport);

  dom.btnSaveProj.addEventListener("click", saveProject);
  dom.btnLoadProj.addEventListener("click", openProjectsModal);
  dom.btnCloseProjects.addEventListener("click", () => (dom.projectsModal.hidden = true));
  dom.btnCancelProjects.addEventListener("click", () => (dom.projectsModal.hidden = true));
  dom.btnBrowseProjFile.addEventListener("click", () => dom.projectImportInput.click());
  dom.projectImportInput.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    loadProjectObject(JSON.parse(txt));
    dom.projectsModal.hidden = true;
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
  dom.inspColor.addEventListener("input", () =>
    mutateSelectedClip((c) => (c.color = dom.inspColor.value))
  );
  dom.inspGain.addEventListener("input", () =>
    mutateSelectedClip((c) => (c.gainDb = Number(dom.inspGain.value)))
  );
  dom.inspPitch.addEventListener("input", () =>
    mutateSelectedClip((c) => (c.pitchSemitones = Number(dom.inspPitch.value)))
  );
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
      dom.btnTypingPiano.classList.toggle("active", ui.typingPiano);
      setStatus(
        ui.typingPiano
          ? "🎹 FL Typing Keyboard to Piano: ON (Press Z–M or Q–P to play active stem chromatically!)"
          : "🎹 FL Typing Keyboard to Piano: OFF (Keys P/B/C/D/T/S/E switch Playlist tools)"
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

  // Global FL Studio Keyboard Shortcuts & Typing-to-Piano Controller
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    if (e.repeat && !e.key.startsWith("Arrow")) return;

    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    // F1 or ? -> Open FL Studio Shortcuts Reference
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

    // FL Studio Window Function Keys: F5 (Playlist Layout), F6 (Channel Rack), F7 (Piano Roll), F8 (Browser), F9 (Mixer)
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
      dom.hscrollSlider.value = 0;
      drawAllCanvases();
      setStatus("Playhead returned to Bar 1 (Home)");
      return;
    }

    // Ctrl + T -> Toggle FL Studio Typing Keyboard to Piano Keyboard
    if (ctrl && k === "t") {
      e.preventDefault();
      if (dom.btnTypingPiano) dom.btnTypingPiano.click();
      return;
    }

    // Alt + T -> Add Time Marker at Playhead (FL Studio shortcut)
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

    // Ctrl + B or Ctrl + D -> FL Studio Latch-Duplicate Selected Clips
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

    // Delete -> Delete Selected Clips; Backspace -> Delete Clips OR Toggle Grid Snap (FL Studio Backspace!)
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
          setStatus("FL Snap Toggled: OFF (Free)");
        } else {
          ui.snapBeats = ui.lastSnapBeats || 0.5;
          dom.snapSelect.value = String(ui.snapBeats);
          setStatus(`FL Snap Toggled: ON (${ui.snapBeats} Beat)`);
        }
        drawAllCanvases();
      }
      return;
    }

    // Insert -> Slice Clip at Playhead / Cursor (FL Studio Insert shortcut)
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
      dom.zoomSlider.value = ui.pixelsPerBeat;
      drawAllCanvases();
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      ui.pixelsPerBeat = Math.max(18, Math.round(ui.pixelsPerBeat * 0.83));
      dom.zoomSlider.value = ui.pixelsPerBeat;
      drawAllCanvases();
      return;
    }

    // If FL Studio Typing Keyboard to Piano is active (Ctrl+T), play chromatic notes!
    if (ui.typingPiano && !ctrl && !e.altKey && FL_PIANO_MAP[k]) {
      e.preventDefault();
      const [stOffset, noteName] = FL_PIANO_MAP[k];
      triggerTypingPianoNote(stOffset, noteName);
      return;
    }

    // FL Studio Single-Key Playlist Tools & Transport
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

  window.addEventListener("resize", drawAllCanvases);
}

function setActiveTool(toolName) {
  ui.tool = toolName;
  document.querySelectorAll(".tool-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === toolName);
  });
  setStatus(`Active tool: ${toolName.toUpperCase()}`);
  drawAllCanvases();
}

function drawOscilloscope(isPlaying, leftLevel, rightLevel, beat) {
  const c = dom.oscCanvas;
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width;
  const h = c.height;
  ctx.fillStyle = "#171825";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = isPlaying ? "#CC0FE0" : "rgba(198, 124, 255, 0.45)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const amp = isPlaying ? Math.max(0.15, Math.min(0.95, (leftLevel + rightLevel) * 0.8)) : 0.04;
  const phase = performance.now() * 0.015;
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
function animationTick() {
  const beat = engine.getPlayheadBeat(project);
  const sec = beat * (60 / project.bpm);
  dom.readoutBars.textContent = formatBeatBar(beat);
  dom.readoutTime.textContent = formatSeconds(sec);

  if (engine.isPlaying) {
    if (project.loopEnabled && beat < lastLoopWrapCheck - 0.5) {
      engine.play(project, assets, project.loopStartBeat);
    }
    lastLoopWrapCheck = beat;

    const { left, right } = engine.getMasterLevels();
    dom.meterL.style.width = `${Math.min(100, Math.round(left * 115))}%`;
    dom.meterR.style.width = `${Math.min(100, Math.round(right * 115))}%`;
    drawOscilloscope(true, left, right, beat);

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
    dom.meterL.style.width = "2%";
    dom.meterR.style.width = "2%";
    drawOscilloscope(false, 0, 0, beat);
  }

  requestAnimationFrame(animationTick);
}

// Initialize Application
setupPlaylistInteractions();
setupPianoRollInteractions();
bindControls();
loadBuiltInDemoArrangement();
requestAnimationFrame(animationTick);
