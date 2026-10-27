/**
 * STUDIO — Web MIDI input, message parsing and device management.
 *
 * Zero dependencies. Two layers:
 *
 *  1. `MidiStreamParser` turns raw bytes into channel messages. Web MIDI
 *     (`MIDIMessageEvent.data`) normally hands over complete messages, but this
 *     parser also implements running status and splits messages across chunks,
 *     which is what the imported-file tests and any driver that batches bytes
 *     need. A Note On with velocity 0 becomes a Note Off (0x9n/0x8n rules).
 *
 *  2. `MidiInput` owns `navigator.requestMIDIAccess()`: permission handling,
 *     device enumeration, `statechange` (connect / disconnect), a channel
 *     filter, sustain (CC64) and panic (CC120/123). It reports plain events to
 *     the app; it never touches the audio graph or the DOM itself.
 *
 * Honesty: Web MIDI exists in Chromium/Edge. Firefox and Safari have no
 * Web MIDI API at all; `supported` is false there and the app falls back to
 * the pointer audition and the Ctrl+T typing keyboard.
 */

export const MIDI_NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/** MIDI note number -> scientific pitch name, e.g. 60 -> "C4". */
export function midiNoteName(note) {
  const n = Math.round(Number(note));
  if (!Number.isFinite(n) || n < 0 || n > 127) return "--";
  return `${MIDI_NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Equal-tempered frequency (A4 = note 69 = 440 Hz). */
export function midiNoteFrequency(note) {
  return 440 * Math.pow(2, (Number(note) - 69) / 12);
}

/** Bytes we still accept for one message (guards a pathological stream). */
const MAX_MESSAGE_BYTES = 3;

const isNoteOn = (status, data) => (status & 0xf0) === 0x90 && data[1] > 0;
const isNoteOff = (status, data) =>
  (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && data[1] === 0);

/**
 * Incremental MIDI byte-stream parser.
 * `push(bytes)` returns an array of event objects. Real-time bytes (clock,
 * start/stop) are handled immediately and do not disturb running status.
 */
export class MidiStreamParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.status = 0;
    this.data = [];
    this.expected = 0;
    this.sysex = false;
  }

  /** @param {ArrayLike<number>} bytes */
  push(bytes) {
    const out = [];
    if (!bytes) return out;
    for (const raw of bytes) {
      const byte = raw & 0xff;

      // System real-time may appear anywhere, even inside a SysEx.
      if (byte >= 0xf8) {
        if (byte === 0xfa) out.push({ type: "start", channel: null });
        else if (byte === 0xfb) out.push({ type: "continue", channel: null });
        else if (byte === 0xfc) out.push({ type: "stop", channel: null });
        else if (byte === 0xf8) out.push({ type: "clock", channel: null });
        continue;
      }

      if (byte === 0xf0) {
        this.sysex = true;
        this.status = 0;
        this.data = [];
        this.expected = 0;
        continue;
      }
      if (byte === 0xf7) {
        this.sysex = false;
        continue;
      }
      if (this.sysex) continue;

      if (byte >= 0x80) {
        // A new status byte aborts an unfinished message and sets running status.
        this.data = [];
        if (byte >= 0xf0) {
          // System common: we do not consume F1/F2/F3 payloads beyond dropping them.
          this.status = byte;
          this.expected = 0;
          continue;
        }
        this.status = byte;
        const hi = byte & 0xf0;
        this.expected = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
        continue;
      }

      if (!this.status) continue; // stray data byte with no running status
      this.data.push(byte);
      if (this.data.length < this.expected) continue;

      const status = this.status;
      const data = this.data;
      const channel = status & 0x0f;
      const hi = status & 0xf0;
      this.data = [];
      // Running status stays armed; the next data byte reuses this status.

      if (hi === 0x80 || hi === 0x90) {
        const note = data[0] & 0x7f;
        const velocity = data[1] & 0x7f;
        if (isNoteOff(status, [note, velocity])) {
          out.push({ type: "noteoff", channel, note, velocity });
        } else if (isNoteOn(status, [note, velocity])) {
          out.push({ type: "noteon", channel, note, velocity });
        }
      } else if (hi === 0xb0) {
        out.push({
          type: "cc",
          channel,
          controller: data[0] & 0x7f,
          value: data[1] & 0x7f,
        });
      } else if (hi === 0xc0) {
        out.push({ type: "program", channel, program: data[0] & 0x7f });
      } else if (hi === 0xa0) {
        out.push({ type: "polytouch", channel, note: data[0] & 0x7f, value: data[1] & 0x7f });
      } else if (hi === 0xe0) {
        const bend = ((data[1] & 0x7f) << 7) | (data[0] & 0x7f);
        out.push({ type: "pitchbend", channel, value: bend - 8192 });
      }
      if (this.data.length > MAX_MESSAGE_BYTES) this.data = [];
    }
    return out;
  }
}

/** One-shot parse helper (returns every message in `bytes`). */
export function parseMidiBytes(bytes) {
  return new MidiStreamParser().push(bytes);
}

const STATUS_COPY = {
  unsupported:
    "Web MIDI is not available in this browser — it exists in Chromium/Edge only. Use Play Notes or the Ctrl+T typing keyboard instead.",
  denied:
    "MIDI permission was denied. Allow MIDI in the browser's site settings, then reload this page.",
  error: "MIDI could not start. Check the browser's MIDI permission and try again.",
  noAccess: "MIDI access was not granted.",
  off: "MIDI off — click Enable MIDI to connect a keyboard.",
};

/**
 * Device manager. Callbacks:
 *  - onEvent(event)          parsed channel/transport event
 *  - onStatus(text, kind)    honest human-readable state ("off" | "ok" | "warn" | "error")
 *  - onDevices(devices, selectedId)
 */
export class MidiInput {
  constructor({ onEvent, onStatus, onDevices } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onDevices = onDevices || (() => {});

    this.access = null;
    this.enabled = false;
    this.enabling = false;
    this.selectedId = null;
    this.channelFilter = null; // null = all channels
    this.devices = [];
    this.held = new Set(); // "channel:note" currently sounding through us
    this.sustain = new Set(); // channels whose CC64 pedal is down
    this.pendingOff = new Map(); // channel -> Set(note) released while sustain was down
    this.parser = new MidiStreamParser();
    this._onStateChange = () => this.refreshDevices();
  }

  get supported() {
    return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  }

  /** Must be called from a user gesture (the Enable MIDI click). */
  async enable() {
    if (this.enabled) return { ok: true };
    if (this.enabling) return { ok: false, reason: "busy" };
    if (!this.supported) {
      this.onStatus(STATUS_COPY.unsupported, "warn");
      return { ok: false, reason: "unsupported" };
    }
    this.enabling = true;
    try {
      // sysex:false keeps the permission prompt as small as possible.
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.enabling = false;
      this.enabled = false;
      const denied = err && (err.name === "SecurityError" || err.name === "NotAllowedError");
      this.onStatus(denied ? STATUS_COPY.denied : `${STATUS_COPY.error} (${err?.name || "error"})`, "error");
      return { ok: false, reason: denied ? "denied" : "error", error: err };
    }

    this.access.addEventListener("statechange", this._onStateChange);
    this.enabled = true;
    this.enabling = false;
    this._bindInputs();
    this.refreshDevices({ announce: true });
    return { ok: true };
  }

  /** Turns listening off and releases every note so nothing hangs. */
  disable() {
    this.enabled = false;
    this._releaseAll();
    if (this.access) {
      try {
        this.access.removeEventListener("statechange", this._onStateChange);
      } catch (_) {}
      for (const input of this.access.inputs.values()) {
        try {
          input.onmidimessage = null;
        } catch (_) {}
      }
    }
    this.access = null;
    this.devices = [];
    this.selectedId = null;
    this.parser.reset();
    this.onDevices([], null);
    this.onStatus(STATUS_COPY.off, "off");
  }

  setChannelFilter(channel) {
    const n = Number(channel);
    this.channelFilter = Number.isFinite(n) && n >= 0 && n <= 15 ? n : null;
  }

  setSelected(id) {
    this._releaseAll();
    this.selectedId = id || null;
    this.parser.reset();
    const dev = this.devices.find((d) => d.id === this.selectedId);
    if (dev) this.onStatus(`Listening · ${dev.name}`, "ok");
    this.onDevices(this.devices, this.selectedId);
  }

  _inputList() {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values());
  }

  _bindInputs() {
    for (const input of this._inputList()) {
      input.onmidimessage = (event) => this._receive(event);
    }
  }

  refreshDevices({ announce = false } = {}) {
    if (!this.enabled || !this.access) return;
    const prevSelected = this.selectedId;
    this.devices = this._inputList().map((input) => ({
      id: input.id,
      name: input.name || "MIDI input",
      manufacturer: input.manufacturer || "",
      state: input.state || "connected",
    }));
    this._bindInputs();

    const stillThere = this.devices.some((d) => d.id === prevSelected);
    if (!stillThere) {
      this.selectedId = this.devices.length ? this.devices[0].id : null;
      if (prevSelected) this._releaseAll();
    } else {
      this.selectedId = prevSelected;
    }
    this.onDevices(this.devices, this.selectedId);

    if (this.devices.length === 0) {
      this.onStatus("MIDI on · no device connected. Plug in a keyboard — it is detected automatically.", "warn");
    } else if (announce || !stillThere) {
      const dev = this.devices.find((d) => d.id === this.selectedId);
      this.onStatus(
        prevSelected && !stillThere
          ? `Device disconnected · now listening to ${dev?.name || "no device"}`
          : `Listening · ${dev?.name || "MIDI input"}`,
        prevSelected && !stillThere ? "warn" : "ok"
      );
    }
  }

  _releaseAll() {
    for (const key of Array.from(this.held)) {
      const [ch, note] = key.split(":").map(Number);
      this.held.delete(key);
      this.onEvent({ type: "noteoff", channel: ch, note, velocity: 0, reason: "release" });
    }
    this.sustain.clear();
    this.pendingOff.clear();
  }

  _receive(event) {
    if (!this.enabled) return;
    const inputId = event.target && event.target.id;
    if (this.selectedId && inputId && inputId !== this.selectedId) return;

    for (const msg of this.parser.push(event.data)) {
      if (this.channelFilter !== null && msg.channel !== null && msg.channel !== this.channelFilter) {
        // A filtered channel must not leave a sustained note hanging either.
        if (msg.type === "cc" && (msg.controller === 120 || msg.controller === 123)) {
          this._panicChannel(msg.channel);
        }
        continue;
      }
      if (msg.channel === null) {
        // Transport real-time (clock / start / continue / stop) is passed through.
        this.onEvent(msg);
        continue;
      }

      if (msg.type === "noteon") {
        const key = `${msg.channel}:${msg.note}`;
        this.held.add(key);
        this.pendingOff.get(msg.channel)?.delete(msg.note);
        this.onEvent(msg);
      } else if (msg.type === "noteoff") {
        const key = `${msg.channel}:${msg.note}`;
        if (this.sustain.has(msg.channel)) {
          // The key is up but CC64 is still down: keep it sounding until the pedal lifts.
          if (!this.pendingOff.has(msg.channel)) this.pendingOff.set(msg.channel, new Set());
          this.pendingOff.get(msg.channel).add(msg.note);
          continue;
        }
        this.held.delete(key);
        this.onEvent(msg);
      } else if (msg.type === "cc") {
        if (msg.controller === 64) {
          if (msg.value >= 64) {
            this.sustain.add(msg.channel);
          } else {
            this.sustain.delete(msg.channel);
            const pending = this.pendingOff.get(msg.channel);
            if (pending) {
              for (const note of pending) {
                this.held.delete(`${msg.channel}:${note}`);
                this.onEvent({ type: "noteoff", channel: msg.channel, note, velocity: 0 });
              }
              this.pendingOff.delete(msg.channel);
            }
          }
        } else if (msg.controller === 120 || msg.controller === 123) {
          this._panicChannel(msg.channel);
        }
        this.onEvent(msg);
      } else {
        this.onEvent(msg);
      }
    }
  }

  _panicChannel(channel) {
    for (const key of Array.from(this.held)) {
      const [ch, note] = key.split(":").map(Number);
      if (ch !== channel) continue;
      this.held.delete(key);
      this.onEvent({ type: "noteoff", channel: ch, note, velocity: 0 });
    }
    this.sustain.delete(channel);
    this.pendingOff.delete(channel);
  }
}

export { STATUS_COPY as MIDI_STATUS_COPY };
