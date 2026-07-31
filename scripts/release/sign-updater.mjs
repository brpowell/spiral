#!/usr/bin/env node
/**
 * Sign a file with the Tauri updater key (same as CI / tauri build).
 *
 * Usage:
 *   npm run release:sign -- <file>
 *   npm run release:sign -- <file> --key-path ~/.tauri/spiral-updater.key
 *
 * Auth (first match wins):
 *   TAURI_SIGNING_PRIVATE_KEY       — key contents (CI)
 *   TAURI_SIGNING_PRIVATE_KEY_PATH  — path to key file
 *   --key-path / -f                 — path to key file
 *
 * Password: TAURI_SIGNING_PRIVATE_KEY_PASSWORD or --password (empty for --ci keys).
 * Writes <file>.sig (base64 minisign signature, updater-compatible).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function usage(exitCode = 0) {
  console.log(`Sign a file for tauri-plugin-updater.

Usage:
  npm run release:sign -- <file> [--key-path <path>] [--password <pw>]

Environment (same names as .github/workflows/release.yml):
  TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY_PATH
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  let file;
  let keyPath;
  let password;
  let passwordSet = false;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage(0);
    if (a === "--key-path" || a === "-f") {
      keyPath = argv[++i];
      continue;
    }
    if (a === "--password" || a === "-p") {
      password = argv[++i] ?? "";
      passwordSet = true;
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown arg: ${a}`);
      usage(1);
    }
    positional.push(a);
  }

  if (positional.length !== 1) {
    console.error("Expected exactly one file to sign");
    usage(1);
  }
  file = positional[0];
  return { file, keyPath, password, passwordSet };
}

const { file, keyPath, password, passwordSet } = parseArgs(
  process.argv.slice(2),
);

if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const env = { ...process.env, CI: "1" };
const args = ["run", "tauri", "--", "signer", "sign"];

if (keyPath) {
  if (!existsSync(keyPath)) {
    console.error(`Key file not found: ${keyPath}`);
    process.exit(1);
  }
  args.push("-f", keyPath);
} else if (!env.TAURI_SIGNING_PRIVATE_KEY && !env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  console.error(
    "No private key: set TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PATH, or --key-path",
  );
  process.exit(1);
}

// --ci keys need an explicit empty password or the CLI tries a TTY prompt.
if (passwordSet) {
  args.push("-p", password);
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password;
} else if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
  args.push("-p", "");
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
}

args.push(file);

console.log(`$ npm run tauri -- signer sign … ${file}`);
const result = spawnSync("npm", args, {
  cwd: root,
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
