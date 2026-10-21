// Test fixture: a plugin that tries to pull code from the network (must be refused).
import { thing } from "https://example.com/not-allowed.js";
export const PLUGIN = { name: "Imports Remote", params: [], process() {} };
