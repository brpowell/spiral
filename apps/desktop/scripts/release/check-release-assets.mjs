#!/usr/bin/env node
/**
 * Verify a draft GitHub Release has every Direct-channel installer + updater
 * artifact. Shared by CI (`platforms-green`, Publish Release) and local publish.
 *
 * Usage:
 *   npm run release -- check <tag>
 *   node scripts/release/check-release-assets.mjs <tag>
 */
import { spawnSync } from "node:child_process";
import { checkReleaseAssets } from "./required-release-assets.mjs";

function usage(exitCode = 0) {
  console.log(`Check Spiral draft-release assets.

Usage:
  npm run release -- check <tag>

Example:
  npm run release -- check v0.2.0
`);
  process.exit(exitCode);
}

const tag = process.argv[2];
if (!tag || tag === "-h" || tag === "--help") usage(tag ? 0 : 1);

const repo = process.env.GITHUB_REPOSITORY;
const viewArgs = ["release", "view", tag, "--json", "assets,url,isDraft"];
if (repo) {
  viewArgs.push("--repo", repo);
}

const result = spawnSync("gh", viewArgs, { encoding: "utf8" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error((result.stderr || result.stdout || "").trim());
  process.exit(result.status ?? 1);
}

const release = JSON.parse(result.stdout);
const assetNames = (release.assets ?? []).map((a) => a.name);

console.log(`Assets on ${tag}:`);
for (const name of assetNames) console.log(`  ${name}`);

const check = checkReleaseAssets(assetNames);
if (!check.ok) {
  for (const { pattern, label } of check.missing) {
    console.error(`Missing ${label} (expected /${pattern}/)`);
  }
  console.error(
    "Draft is missing one or more platform artifacts — not release-ready.",
  );
  process.exit(1);
}

console.log("Draft has installers and updater artifacts for every platform.");
