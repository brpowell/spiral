#!/usr/bin/env node
/**
 * Fails if the desktop app's version sources disagree:
 *   - package.json
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml ([package] version)
 *   - the "Spiral" entry in the workspace Cargo.lock
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(root, "..", "..");

function jsonVersion(relativePath) {
  const data = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
  if (typeof data.version !== "string" || data.version.length === 0) {
    throw new Error(`Missing version string in ${relativePath}`);
  }
  return data.version;
}

function cargoTomlVersion(relativePath) {
  const text = readFileSync(join(root, relativePath), "utf8");
  const pkg = text.match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms);
  if (!pkg) throw new Error(`Missing [package] version in ${relativePath}`);
  return pkg[1];
}

function cargoLockVersion(name) {
  const text = readFileSync(join(workspaceRoot, "Cargo.lock"), "utf8");
  const entry = text.match(
    new RegExp(`^name = "${name}"\\r?\\nversion = "([^"]+)"`, "m"),
  );
  if (!entry) throw new Error(`Missing "${name}" entry in Cargo.lock`);
  return entry[1];
}

try {
  const versions = {
    "package.json": jsonVersion("package.json"),
    "src-tauri/tauri.conf.json": jsonVersion("src-tauri/tauri.conf.json"),
    "src-tauri/Cargo.toml": cargoTomlVersion("src-tauri/Cargo.toml"),
    "Cargo.lock (Spiral)": cargoLockVersion("Spiral"),
  };
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1) {
    console.error("Version mismatch:");
    for (const [file, version] of Object.entries(versions)) {
      console.error(`  ${file}: ${version}`);
    }
    process.exit(1);
  }
  console.log(`Versions in sync: ${[...distinct][0]}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
