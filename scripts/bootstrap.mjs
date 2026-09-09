#!/usr/bin/env node
/**
 * Idempotent clone-time prep. Run after `npm install`:
 *
 *   npm run bootstrap
 *   npm run tauri dev
 *
 * Add new steps in `STEPS` below. Each must skip-if-done and stay cheap on
 * repeat. Extra args (`--target`, …) are forwarded only to steps that take them.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/** @typedef {{ name: string, script: string, forwardTarget?: boolean }} BootstrapStep */

/** @type {BootstrapStep[]} */
const STEPS = [
  { name: "libmp3lame", script: "native-lame.mjs", forwardTarget: true },
];

function usage(code = 0) {
  console.log(`Prepare this checkout to build and run (idempotent).

Usage:
  npm install && npm run bootstrap
  npm run tauri dev

  npm run bootstrap -- --target <rustc-triple>   # native-lame only; CI / cross

Needs \`gh\` authenticated to spiral-powered/native-lame (contents: read).
`);
  process.exit(code);
}

function parseArgs(argv) {
  /** @type {{ target: string | null, help: boolean }} */
  const out = { target: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg === "--target") {
      out.target = argv[++i] ?? "";
      if (!out.target) {
        console.error("--target requires a rustc triple");
        process.exit(1);
      }
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(1);
    }
  }
  return out;
}

function runStep(step, extraArgs) {
  console.log(`bootstrap: ${step.name}`);
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", step.script), ...extraArgs],
    { stdio: "inherit", cwd: root },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) usage(0);

const targetArgs = args.target ? ["--target", args.target] : [];
for (const step of STEPS) {
  runStep(step, step.forwardTarget ? targetArgs : []);
}
