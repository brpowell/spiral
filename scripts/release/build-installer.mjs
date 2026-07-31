#!/usr/bin/env node
/**
 * Build a platform installer locally (same bundle flags as CI).
 *
 * Usage:
 *   npm run release:installer          # native for this machine
 *   npm run release:dmg                # macOS DMG (macOS host only)
 *   npm run release:nsis               # Windows NSIS (Windows host only)
 *   node scripts/release/build-installer.mjs dmg -- --target aarch64-apple-darwin
 *
 * Extra args after `--` are passed to `tauri build`.
 * Unsigned unless Apple/Windows / updater signing env vars are set
 * (same secret names as `.github/workflows/release.yml`).
 *
 * See docs/release.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const BUNDLES = {
  dmg: {
    host: "darwin",
    args: ["--bundles", "dmg"],
    outHint: "src-tauri/target/**/bundle/dmg/",
  },
  nsis: {
    host: "win32",
    args: ["--bundles", "nsis"],
    outHint: "src-tauri/target/**/bundle/nsis/",
  },
};

function usage(exitCode = 0) {
  console.log(`Build a Spiral installer for the current OS.

Usage:
  npm run release:installer [dmg|nsis] [-- <tauri build args>]
  npm run release:dmg
  npm run release:nsis

Defaults to the native installer for this machine (${process.platform}).
Cross-OS builds are not supported (need a Mac for DMG, Windows for NSIS).
`);
  process.exit(exitCode);
}

function nativeKind() {
  if (process.platform === "darwin") return "dmg";
  if (process.platform === "win32") return "nsis";
  console.error(
    `No Direct-channel installer for ${process.platform} yet (release matrix is macOS DMG + Windows NSIS).`,
  );
  process.exit(1);
}

function parseArgs(argv) {
  const dash = argv.indexOf("--");
  const before = dash === -1 ? argv : argv.slice(0, dash);
  const passthrough = dash === -1 ? [] : argv.slice(dash + 1);

  if (before.includes("-h") || before.includes("--help")) usage(0);

  const positional = before.filter((a) => !a.startsWith("-"));
  if (positional.length > 1) {
    console.error(`Unexpected args: ${positional.slice(1).join(" ")}`);
    usage(1);
  }

  const kind = positional[0] ?? nativeKind();
  if (!(kind in BUNDLES)) {
    console.error(`Unknown installer kind: ${kind} (expected dmg or nsis)`);
    usage(1);
  }
  return { kind, passthrough };
}

function listNewestUnder(dir, predicate) {
  if (!existsSync(dir)) return [];
  const hits = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) {
      hits.push(...listNewestUnder(path, predicate));
    } else if (predicate(name.name)) {
      hits.push(path);
    }
  }
  return hits;
}

function printArtifacts(kind) {
  const bundleRoot = join(root, "src-tauri", "target");
  const needle = kind === "dmg" ? join("bundle", "dmg") : join("bundle", "nsis");
  const match =
    kind === "dmg"
      ? (name) => name.endsWith(".dmg")
      : (name) => name.endsWith("-setup.exe");
  const installers = listNewestUnder(bundleRoot, match).filter((f) =>
    f.includes(needle),
  );

  if (installers.length === 0) {
    console.log(`\nLook for output under ${BUNDLES[kind].outHint}`);
    return;
  }
  console.log("\nInstaller(s):");
  for (const f of installers.sort()) {
    console.log(`  ${f}`);
  }
}

const { kind, passthrough } = parseArgs(process.argv.slice(2));
const spec = BUNDLES[kind];

if (process.platform !== spec.host) {
  console.error(
    `Cannot build ${kind} on ${process.platform} — need ${spec.host === "darwin" ? "macOS" : "Windows"}.`,
  );
  process.exit(1);
}

const tauriArgs = ["run", "tauri", "--", "build", ...spec.args, ...passthrough];
console.log(`$ npm ${tauriArgs.join(" ")}`);

const result = spawnSync("npm", tauriArgs, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

printArtifacts(kind);
