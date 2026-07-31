#!/usr/bin/env node
/**
 * Publish a draft GitHub Release (flip draft → published).
 *
 * Same checks as the CI publish job: require aarch64 DMG, x64 DMG, and NSIS
 * assets before undrafting. This is the go-live moment for Direct-channel
 * installs once the marketing-site update route reads published releases.
 *
 * Usage:
 *   npm run release:publish -- v0.2.0
 *   GH_TOKEN=… node scripts/release/publish-release.mjs v0.2.0
 *
 * Requires `gh` authenticated with contents:write on the repo.
 */
import { spawnSync } from "node:child_process";

function usage(exitCode = 0) {
  console.log(`Publish a draft Spiral GitHub Release.

Usage:
  npm run release:publish -- <tag>

Example:
  npm run release:publish -- v0.2.0
`);
  process.exit(exitCode);
}

function ghJson(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim());
  }
  return JSON.parse(result.stdout);
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const tag = process.argv[2];
if (!tag || tag === "-h" || tag === "--help") usage(tag ? 0 : 1);
if (!/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error(`Expected a version tag like v0.2.0, got: ${tag}`);
  process.exit(1);
}

let release;
try {
  release = ghJson([
    "release",
    "view",
    tag,
    "--json",
    "isDraft,isPrerelease,assets,url",
  ]);
} catch (err) {
  console.error(`Could not load release ${tag}: ${err.message}`);
  process.exit(1);
}

if (!release.isDraft) {
  console.error(`${tag} is not a draft (already published?).`);
  console.error(release.url);
  process.exit(1);
}

const assetNames = (release.assets ?? []).map((a) => a.name);
console.log(`Assets on ${tag}:`);
for (const name of assetNames) console.log(`  ${name}`);

let missing = 0;
function requireAsset(pattern, label) {
  if (!assetNames.some((n) => pattern.test(n))) {
    console.error(`Missing ${label} (expected /${pattern.source}/)`);
    missing++;
  }
}

requireAsset(/_aarch64\.dmg$/, "macOS aarch64 DMG");
requireAsset(/_(x64|x86_64)\.dmg$/, "macOS x64 DMG");
requireAsset(/-setup\.exe$/, "Windows NSIS installer");

if (missing !== 0) {
  console.error(
    "Draft is missing one or more platform artifacts — not publishing.",
  );
  process.exit(1);
}

console.log(`\nPublishing ${tag}…`);
gh(["release", "edit", tag, "--draft=false"]);
console.log(`Published: ${release.url}`);
console.log(
  "This is the go-live moment for Direct-channel auto-update once the site update route is live.",
);
