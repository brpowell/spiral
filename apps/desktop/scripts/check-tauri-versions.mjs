#!/usr/bin/env node
/**
 * Fails if a Tauri JS package and its Rust crate differ in major.minor.
 *
 * `tauri build` runs the same check and aborts the release build, so catching
 * it on a pull request is much cheaper. Compares the locked versions in
 * package-lock.json and the workspace Cargo.lock:
 *   @tauri-apps/api        <-> tauri
 *   @tauri-apps/plugin-<x> <-> tauri-plugin-<x>
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(root, "..", "..");

const npmLock = JSON.parse(
  readFileSync(join(root, "package-lock.json"), "utf8"),
).packages;
const cargoLock = readFileSync(join(workspaceRoot, "Cargo.lock"), "utf8");

function crateVersion(name) {
  const match = cargoLock.match(
    new RegExp(`^name = "${name}"\\r?\\nversion = "([^"]+)"`, "m"),
  );
  return match ? match[1] : undefined;
}

const minor = (version) => version.split(".").slice(0, 2).join(".");

const pairs = [["@tauri-apps/api", "tauri"]];
for (const key of Object.keys(npmLock)) {
  const match = key.match(/^node_modules\/@tauri-apps\/plugin-(.+)$/);
  if (match)
    pairs.push([`@tauri-apps/plugin-${match[1]}`, `tauri-plugin-${match[1]}`]);
}

const problems = [];
for (const [npmName, crateName] of pairs) {
  const npmVersion = npmLock[`node_modules/${npmName}`]?.version;
  const rustVersion = crateVersion(crateName);
  if (!npmVersion || !rustVersion) continue; // only one side uses it
  if (minor(npmVersion) !== minor(rustVersion)) {
    problems.push(
      `${crateName} (v${rustVersion}) : ${npmName} (v${npmVersion})`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    "Tauri JS packages and Rust crates must be on the same major.minor:",
  );
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`Tauri JS/Rust versions aligned (${pairs.length} pairs checked)`);
