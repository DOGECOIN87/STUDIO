/**
 * Audius Studio — LMN-3 controller support.
 *
 * The LMN-3 (https://github.com/FundamentalFrequency/LMN-3-DAW) is a MIDI
 * controller with four endless encoders (each with a push button), transport
 * and edit buttons and an octave knob. midi-input.js delivers its Control
 * Change messages as `cc` events; this module turns them into named actions.
 * Only the controller's message numbers come from LMN-3; this is Audius
 * Studio's own code (LMN-3 DAW itself is GPLv3 and none of it is used here).
 */

// LMN-3 controller numbers.
const ENCODERS = { 3: 1, 9: 2, 14: 3, 15: 4 }; // relative: 1 = clockwise, 127 = counter-clockwise
const ENCODER_BUTTONS = { 20: 1, 21: 2, 22: 3, 23: 4 };
const BUTTONS = {
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
};
const OCTAVE = 117; // 0..8, 4 is the home octave

/**
 * handlers: onButton(name, { control }), onEncoder(index 1..4, delta ±1, { control }),
 * onEncoderPress(index 1..4, { control }), onOctave(shift -4..4), onDetected().
 * handleCc(controller, value) returns true when the message belonged to the LMN-3.
 */
export function createLmn3Controller(handlers) {
  let controlDown = false;
  let detected = false;
  let octaveShift = 0;

  const call = (name, ...args) => {
    if (typeof handlers[name] === "function") handlers[name](...args);
  };
  const seen = () => {
    if (!detected) {
      detected = true;
      call("onDetected");
    }
  };

  function handleCc(cc, value) {
    if (cc in ENCODERS) {
      if (value !== 1 && value !== 127) return true;
      seen();
      call("onEncoder", ENCODERS[cc], value === 1 ? 1 : -1, { control: controlDown });
      return true;
    }
    if (cc in ENCODER_BUTTONS) {
      seen();
      if (value === 0) call("onEncoderPress", ENCODER_BUTTONS[cc], { control: controlDown });
      return true;
    }
    if (cc === OCTAVE) {
      seen();
      octaveShift = Math.max(-4, Math.min(4, value - 4));
      call("onOctave", octaveShift);
      return true;
    }
    const name = BUTTONS[cc];
    if (!name) return false;
    seen();
    if (name === "control") {
      controlDown = value === 127;
      return true;
    }
    // Like the LMN-3 software, a button acts when it is released.
    if (value === 0) call("onButton", name, { control: controlDown });
    return true;
  }

  return {
    handleCc,
    get detected() {
      return detected;
    },
    get octaveShift() {
      return octaveShift;
    },
  };
}
