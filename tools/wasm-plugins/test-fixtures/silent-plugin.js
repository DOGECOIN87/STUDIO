// Test fixture: a plugin that outputs non-finite samples (must be bypassed).
export const PLUGIN = {
  name: "NaN Test Effect",
  params: [],
  init() {},
  process({ outL, outR, frames }) {
    outL.fill(NaN, 0, frames);
    outR.fill(NaN, 0, frames);
  },
};
