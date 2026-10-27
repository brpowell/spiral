#!/usr/bin/env node
/**
 * Generate a Tauri updater signing keypair (same tool CI uses via env vars).
 *
 * Usage:
 *   npm run release -- keys
 *   npm run release -- keys -- --out ~/.tauri/spiral-updater.key
 *   npm run release -- keys -- --force
 *
 * Writes private key + `.pub`. Does not touch git, GitHub secrets, or tauri.conf.json —
 * follow docs/contributing/signing-and-keys.md to rotate those.
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUT = join(homedir(), ".tauri", "spiral-updater.key");

function usage(exitCode = 0) {
  console.log(`Generate a Spiral updater signing keypair.

Usage:
  npm run release -- keys [-- --out <path>] [--force]

Defaults:
  --out  ${DEFAULT_OUT}

Always uses --ci (no password) so the private key matches CI's
TAURI_SIGNING_PRIVATE_KEY / empty TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  let out = DEFAULT_OUT;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage(0);
    if (a === "--force" || a === "-f") {
      force = true;
      continue;
    }
    if (a === "--out" || a === "-w") {
      out = argv[++i];
      if (!out) {
        console.error("Missing value for --out");
        usage(1);
      }
      continue;
    }
    console.error(`Unknown arg: ${a}`);
    usage(1);
  }
  return { out, force };
}

const { out, force } = parseArgs(process.argv.slice(2));
const args = ["run", "tauri", "--", "signer", "generate", "-w", out, "--ci"];
if (force) args.push("-f");

console.log(`$ npm ${args.join(" ")}`);
const result = spawnSync("npm", args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "1" },
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`
Wrote ${out} and ${out}.pub.
Install and rotate them as described in docs/contributing/signing-and-keys.md
(public key into the repo and tauri.conf.json, private key into the
TAURI_SIGNING_PRIVATE_KEY secret, and keep the old key until a build signed
with the new one has shipped).
`);
