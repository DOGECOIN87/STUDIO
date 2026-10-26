// Test fixture for tools/browser/plugin-audit.mjs: loads, then throws on every block.
export const PLUGIN = {
  name: "Broken Test Effect",
  version: "0.0.1",
  params: [{ id: "amount", name: "Amount", min: 0, max: 1, default: 0.5, unit: "%", format: "percent" }],
  init() {},
  process() {
    throw new Error("boom (test fixture)");
  },
};
