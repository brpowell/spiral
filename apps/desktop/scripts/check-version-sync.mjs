#!/usr/bin/env node
/**
 * Fails if package.json and src-tauri/tauri.conf.json disagree on version.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function versionOf(relativePath) {
  const data = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
  if (typeof data.version !== "string" || data.version.length === 0) {
    throw new Error(`Missing version string in ${relativePath}`);
  }
  return data.version;
}

try {
  const packageVersion = versionOf("package.json");
  const tauriVersion = versionOf("src-tauri/tauri.conf.json");
  if (packageVersion !== tauriVersion) {
    console.error(
      `Version mismatch: package.json is ${packageVersion}, ` +
        `src-tauri/tauri.conf.json is ${tauriVersion}`,
    );
    process.exit(1);
  }
  console.log(`Versions in sync: ${packageVersion}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
