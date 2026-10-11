#!/usr/bin/env node
/**
 * Build a release-optimized Spiral binary with debug symbols for local
 * sampling (samply / Instruments). Profiles stay on-device — see
 * docs/contributing/profiling.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = {
  ...process.env,
  CARGO_PROFILE_RELEASE_DEBUG: "true",
  CARGO_PROFILE_RELEASE_STRIP: "false",
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npx", ["tauri", "build", "--no-bundle"]);

const candidates = [
  path.join(root, "src-tauri/target/release/Spiral"),
  path.join(root, "src-tauri/target/release/Spiral.exe"),
];
const binary = candidates.find((candidate) => existsSync(candidate));

console.log("\nProfiling binary (keep traces on this machine):");
console.log(
  `  ${binary ?? path.join(root, "src-tauri/target/release/Spiral")}`,
);
console.log("\nExample:");
console.log(`  samply record ${binary ?? "src-tauri/target/release/Spiral"}`);
console.log("\nPlaybook: docs/contributing/profiling.md");
