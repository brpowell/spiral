#!/usr/bin/env node
/**
 * Verify a draft GitHub Release has every Direct-channel installer + updater
 * artifact. This file is the single source of truth for the required assets and
 * the CLI behind CI's `platforms-green` job.
 *
 * Usage:
 *   npm run release -- check <tag>
 *   node scripts/release/check-release-assets.mjs <tag>
 *
 * macOS ships a single universal DMG and updater bundle (`_universal`).
 * Linux ships AppImage (download + Tauri updater payload), `.deb` and `.rpm`
 * for x64 and aarch64. Tauri names them `_amd64` / `_aarch64` (AppImage),
 * `_amd64` / `_arm64` (deb) and `.x86_64` / `.aarch64` (rpm). Windows NSIS
 * installers are `_x64-setup.exe` and `_arm64-setup.exe`.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REQUIRED_RELEASE_ASSETS = [
  // Installers (browser download)
  { pattern: /_universal\.dmg$/, label: "macOS universal DMG" },
  { pattern: /_x64-setup\.exe$/, label: "Windows x64 NSIS installer" },
  { pattern: /_arm64-setup\.exe$/, label: "Windows arm64 NSIS installer" },
  { pattern: /_amd64\.AppImage$/, label: "Linux x64 AppImage" },
  { pattern: /_aarch64\.AppImage$/, label: "Linux aarch64 AppImage" },
  { pattern: /_amd64\.deb$/, label: "Linux x64 .deb" },
  { pattern: /_arm64\.deb$/, label: "Linux aarch64 .deb" },
  { pattern: /\.x86_64\.rpm$/, label: "Linux x64 .rpm" },
  { pattern: /\.aarch64\.rpm$/, label: "Linux aarch64 .rpm" },

  // Updater payloads (in-app auto-update)
  {
    pattern: /_universal\.app\.tar\.gz$/,
    label: "macOS universal updater bundle",
  },
  {
    pattern: /_universal\.app\.tar\.gz\.sig$/,
    label: "macOS universal updater signature",
  },
  {
    pattern: /_x64-setup\.exe\.sig$/,
    label: "Windows x64 NSIS updater signature",
  },
  {
    pattern: /_arm64-setup\.exe\.sig$/,
    label: "Windows arm64 NSIS updater signature",
  },
  {
    pattern: /_amd64\.AppImage\.sig$/,
    label: "Linux x64 AppImage updater signature",
  },
  {
    pattern: /_aarch64\.AppImage\.sig$/,
    label: "Linux aarch64 AppImage updater signature",
  },
];

/**
 * @param {string[]} assetNames
 * @returns {{ ok: true } | { ok: false, missing: { pattern: string, label: string }[] }}
 */
export function checkReleaseAssets(assetNames) {
  const missing = [];
  for (const { pattern, label } of REQUIRED_RELEASE_ASSETS) {
    if (!assetNames.some((name) => pattern.test(name))) {
      missing.push({ pattern: pattern.source, label });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

function main() {
  function usage(exitCode = 0) {
    console.log(`Check Spiral draft-release assets.

Usage:
  npm run release -- check <tag>

Example:
  npm run release -- check desktop-v0.2.0
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
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
