#!/usr/bin/env node
/**
 * Publish a draft GitHub Release (flip draft → published).
 *
 * Same checks as the CI publish job: require installers (DMG / NSIS / AppImage)
 * and updater artifacts (.app.tar.gz + .sig / NSIS .sig / AppImage .sig)
 * before undrafting. This is the go-live moment for Direct-channel installs
 * once the marketing-site update route reads published releases.
 *
 * Usage:
 *   npm run release -- publish desktop-v0.2.0
 *   GH_TOKEN=… node scripts/release/publish-release.mjs desktop-v0.2.0
 *
 * Requires `gh` authenticated with contents:write on the repo.
 */
import { spawnSync } from "node:child_process";
import { checkReleaseAssets } from "./required-release-assets.mjs";

function usage(exitCode = 0) {
  console.log(`Publish a draft Spiral GitHub Release.

Usage:
  npm run release -- publish <tag>

Example:
  npm run release -- publish desktop-v0.2.0
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
if (!/^desktop-v\d+\.\d+\.\d+/.test(tag)) {
  console.error(
    `Expected a desktop release tag like desktop-v0.2.0, got: ${tag}`,
  );
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

const check = checkReleaseAssets(assetNames);
if (!check.ok) {
  for (const { pattern, label } of check.missing) {
    console.error(`Missing ${label} (expected /${pattern}/)`);
  }
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
