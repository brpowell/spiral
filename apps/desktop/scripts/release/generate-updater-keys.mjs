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
Next (rotation / first-time setup):
  1. Copy ${out}.pub → src-tauri/keys/updater/spiral-updater.pub
  2. Set plugins.updater.pubkey in src-tauri/tauri.conf.json to the same contents
  3. Set GitHub Environment secret production-release / TAURI_SIGNING_PRIVATE_KEY
     to the private key file contents (no password)
  4. Store the private key in the password-manager vault; discard the old key only
     after a build signed with the new key has been installed by users
  5. See docs/contributing/signing-and-keys.md
`);
