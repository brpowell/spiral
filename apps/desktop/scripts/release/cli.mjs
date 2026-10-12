#!/usr/bin/env node
/**
 * Single entry for local release tooling.
 *
 *   npm run release -- installer [dmg|nsis|linux|deb|rpm] [-- <tauri args>]
 *   npm run release -- check <tag>
 *   npm run release -- sanitize-notes <tag>
 *   npm run release -- sanitize-notes <tag> --dry-run
 *   npm run release -- sign <file>
 *   npm run release -- verify <file>
 *   npm run release -- keys [-- --out <path>] [--force]
 *
 * See docs/contributing/release.md.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  installer: {
    script: "build-installer.mjs",
    summary: "Build native (or named) installer — same flags as CI",
  },
  check: {
    script: "check-release-assets.mjs",
    summary: "Verify draft has every required installer + updater artifact",
  },
  "sanitize-notes": {
    script: "sanitize-release-notes.mjs",
    summary: "Rewrite a GitHub Release body into user-facing notes",
  },
  sign: {
    script: "sign-updater.mjs",
    summary: "Sign an updater artifact with TAURI_SIGNING_PRIVATE_KEY",
  },
  verify: {
    script: "verify-updater-sig.mjs",
    summary: "Verify an artifact .sig against the bundled pubkey",
  },
  keys: {
    script: "generate-updater-keys.mjs",
    summary: "Generate updater signing keypair (tauri signer generate --ci)",
  },
};

function usage(exitCode = 0) {
  const lines = Object.entries(COMMANDS).map(
    ([name, { summary }]) => `  ${name.padEnd(16)} ${summary}`,
  );
  console.log(`Spiral release tooling.

Usage:
  npm run release -- <command> [args]

Commands:
${lines.join("\n")}

Examples:
  npm run release -- installer
  npm run release -- installer deb
  npm run release -- installer linux -- --verbose
  npm run release -- check desktop-v0.2.2
  npm run release -- sanitize-notes desktop-v0.2.2
  npm run release -- sanitize-notes desktop-v0.2.2 --dry-run
  npm run release -- sign path/to/artifact
  npm run release -- keys
`);
  process.exit(exitCode);
}

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "-h" || command === "--help") {
  usage(command ? 0 : 1);
}

const spec = COMMANDS[command];
if (!spec) {
  console.error(`Unknown command: ${command}`);
  usage(1);
}

const result = spawnSync(process.execPath, [join(here, spec.script), ...rest], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
