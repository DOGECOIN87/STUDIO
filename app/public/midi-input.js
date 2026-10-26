/**
 * Audius Studio — MIDI input (Web MIDI API)
 *
 * Plays notes from any MIDI keyboard and understands the LMN-3 controller
 * (https://github.com/FundamentalFrequency/LMN-3-DAW): four endless encoders
 * with push buttons, transport and edit buttons, and an octave knob. Only the
 * controller's message numbers are taken from LMN-3; this file is Audius
 * Studio's own code.
 */

// LMN-3 controller numbers (Control Change messages).
export const LMN3_CC = {
  encoders: { 3: 1, 9: 2, 14: 3, 15: 4 }, // relative: value 1 = clockwise, 127 = counter-clockwise
  encoderButtons: { 20: 1, 21: 2, 22: 3, 23: 4 },
  buttons: {
    24: "undo",
    25: "tempo",
    26: "save",
    85: "settings",
    86: "tracks",
    88: "mixer",
    89: "plugins",
    90: "modifiers",
    102: "sequencers",
    103: "loopIn",
    104: "loopOut",
    105: "loop",
    106: "cut",
    107: "paste",
    108: "slice",
    109: "record",
    110: "play",
    111: "stop",
    112: "control",
    118: "plus",
    119: "minus",
  },
  octave: 117, // value 0..8, 4 is the home octave
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function midiNoteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

/**
 * handlers: {
 *   onNoteOn(note, velocity 0..1), onNoteOff(note),
 *   onButton(name, { control }), onEncoder(index 1..4, delta ±1, { control }),
 *   onEncoderPress(index 1..4, { control }), onOctave(shift -4..4),
 *   onDevices(names[]), onLmn3(detected)
 * }
 */
export function createMidiInput(handlers) {
  const supported = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  let access = null;
  let controlDown = false;
  let lmn3Seen = false;

  const call = (name, ...args) => {
    if (typeof handlers[name] === "function") handlers[name](...args);
  };

  function markLmn3() {
    if (!lmn3Seen) {
      lmn3Seen = true;
      call("onLmn3", true);
    }
  }

  function handleControlChange(cc, value) {
    if (cc in LMN3_CC.encoders) {
      if (value !== 1 && value !== 127) return;
      markLmn3();
      call("onEncoder", LMN3_CC.encoders[cc], value === 1 ? 1 : -1, { control: controlDown });
      return;
    }
    if (cc in LMN3_CC.encoderButtons) {
      markLmn3();
      if (value === 0) call("onEncoderPress", LMN3_CC.encoderButtons[cc], { control: controlDown });
      return;
    }
    if (cc === LMN3_CC.octave) {
      markLmn3();
      call("onOctave", Math.max(-4, Math.min(4, value - 4)));
      return;
    }
    const name = LMN3_CC.buttons[cc];
    if (!name) return;
    markLmn3();
    if (name === "control") {
      controlDown = value === 127;
      return;
    }
    // Like the LMN-3 software, a button acts when it is released.
    if (value === 0) call("onButton", name, { control: controlDown });
  }

  function onMessage(event) {
    const data = event.data;
    if (!data || data.length < 2) return;
    const type = data[0] & 0xf0;
    const a = data[1];
    const b = data.length > 2 ? data[2] : 0;
    if (type === 0x90 && b > 0) call("onNoteOn", a, b / 127);
    else if (type === 0x80 || (type === 0x90 && b === 0)) call("onNoteOff", a);
    else if (type === 0xb0) handleControlChange(a, b);
  }

  function attachInputs() {
    const names = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      if (input.state !== "disconnected") names.push(input.name || "MIDI input");
    });
    call("onDevices", names);
  }

  async function enable() {
    if (!supported) throw new Error("This browser has no Web MIDI support (use Chrome, Edge or Opera).");
    if (!access) {
      access = await navigator.requestMIDIAccess({ sysex: false });
      access.onstatechange = attachInputs;
    }
    attachInputs();
    return access;
  }

  return {
    supported,
    enable,
    get enabled() {
      return !!access;
    },
    get controlDown() {
      return controlDown;
    },
  };
}
