#!/usr/bin/env node
/**
 * Builds the two reference WASM effects into app/public/plugins/.
 *
 *   node tools/wasm-plugins/build.mjs           # build both
 *   node tools/wasm-plugins/build.mjs --check   # verify the .wasm files match the sources
 *
 * Zero runtime dependencies: `wabt` (a devDependency-friendly JS/WASM assembler)
 * is only needed when the .wat sources change, and is installed on demand under
 * node_modules. If wabt is not installed and the .wasm files already exist, the
 * build prints a notice and succeeds, so a plain checkout still works.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const SRC = path.join(here, "src");
const OUT = path.join(repo, "app/public/plugins");
const EXAMPLES = path.join(here, "examples");

// Reference effects that ship with the app.
const PLUGINS = ["aurora-reverb", "echo-line"];
// The worked example of the plugin ABI (not deployed; used by the docs and tests).
const EXAMPLES_ONLY = ["gain-trim"];

async function loadWabt() {
  try {
    const mod = await import("wabt");
    // wabt is an Emscripten factory: `default` resolves to the API once awaited.
    const factory = mod.default || mod;
    const api = typeof factory === "function" ? await factory() : factory;
    return api && typeof api.parseWat === "function" ? api : null;
  } catch (_) {
    return null;
  }
}

const check = process.argv.includes("--check");
const wabt = await loadWabt();
if (!wabt) {
  console.error("wabt is not installed: run `npm install` (it is a devDependency) before building the .wasm files.");
  process.exit(2);
}

let failures = 0;
const builds = [
  ...PLUGINS.map((name) => [name, OUT]),
  ...EXAMPLES_ONLY.map((name) => [name, EXAMPLES]),
];
for (const [name, outDir] of builds) {
  const wat = fs.readFileSync(path.join(SRC, `${name}.wat`), "utf8");
  const mod = await wabt.parseWat(`${name}.wat`, wat);
  mod.resolveNames();
  mod.validate();
  const { buffer } = mod.toBinary({ log: false, write_debug_names: false });
  mod.destroy();
  const bytes = Buffer.from(buffer);
  const target = path.join(outDir, `${name}.wasm`);
  const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
  if (check) {
    const same = previous && previous.equals(bytes);
    console.log(`${same ? "ok " : "DIFF"} ${name}.wasm (${bytes.length} bytes)`);
    if (!same) failures++;
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(target, bytes);
    console.log(`built ${path.relative(repo, target)} (${bytes.length} bytes)`);
  }
}
process.exit(failures ? 1 : 0);
