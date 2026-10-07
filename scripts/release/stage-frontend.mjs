#!/usr/bin/env node
/**
 * Stage the frontend for an integrity-keyed build (anti-tamper).
 *
 * Runs in `beforeBuildCommand`, AFTER `npm run build` has produced `dist/` and
 * BEFORE the Rust compile embeds `frontendDist`. When encryption is enabled it
 * moves the real built bundle aside to `dist-plain/` (which `before-bundle.mjs`
 * then encrypts into the resource) and leaves a minimal stub in `dist/` for
 * Tauri to embed — so NO plaintext frontend ships inside the binary. The real
 * UI is served only from the decrypted resource over the `spiralfe://` scheme.
 *
 * No-op unless SPIRAL_ENCRYPT_FRONTEND=1 and macOS (matching the encryptor), so
 * a normal build embeds the real frontend exactly as before.
 */
import { existsSync, rmSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENCRYPT = process.env.SPIRAL_ENCRYPT_FRONTEND === "1" && process.platform === "darwin";
if (!ENCRYPT) process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const distPlain = join(root, "dist-plain");

if (!existsSync(dist)) {
  console.error("stage-frontend: dist/ missing — did `npm run build` run first?");
  process.exit(1);
}

// Replace any stale staged bundle with this build's fresh output.
if (existsSync(distPlain)) rmSync(distPlain, { recursive: true, force: true });
renameSync(dist, distPlain);

// Minimal stub for Tauri to embed; never displayed (windows load spiralfe://).
mkdirSync(dist, { recursive: true });
writeFileSync(
  join(dist, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>Spiral</title></head><body></body></html>\n',
);

console.log("stage-frontend: real bundle → dist-plain/, stub written to dist/ (no plaintext embedded)");
