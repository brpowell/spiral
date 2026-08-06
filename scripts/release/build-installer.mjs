#!/usr/bin/env node
/**
 * Build a platform installer locally (same bundle flags as CI).
 *
 * Usage:
 *   npm run release -- installer              # native for this machine
 *   npm run release -- installer dmg
 *   npm run release -- installer nsis
 *   npm run release -- installer linux        # AppImage + deb
 *   npm run release -- installer deb          # deb only (smoke)
 *   npm run release -- installer dmg -- --target aarch64-apple-darwin
 *
 * Extra args after `--` are passed to `tauri build`.
 * Apple/Windows code signing is optional. Updater signing env vars
 * (`TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD`, same as CI) are required
 * because `bundle.createUpdaterArtifacts` is enabled — without them the
 * build fails when producing updater sidecars (.app.tar.gz / AppImage .sig).
 *
 * See docs/release.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const BUNDLES = {
  dmg: {
    host: "darwin",
    hostLabel: "macOS",
    // Keep `app` so createUpdaterArtifacts can emit .app.tar.gz + .sig
    // (same as CI — `--bundles dmg` alone cleans Spiral.app afterward).
    args: ["--bundles", "app,dmg"],
    outHint: "src-tauri/target/**/bundle/{dmg,macos}/",
    needle: join("bundle", "dmg"),
    matchName: (name) => name.endsWith(".dmg"),
  },
  nsis: {
    host: "win32",
    hostLabel: "Windows",
    args: ["--bundles", "nsis"],
    outHint: "src-tauri/target/**/bundle/nsis/",
    needle: join("bundle", "nsis"),
    matchName: (name) => name.endsWith("-setup.exe"),
  },
  linux: {
    host: "linux",
    hostLabel: "Linux",
    args: ["--bundles", "appimage,deb"],
    outHint: "src-tauri/target/**/bundle/{appimage,deb}/",
    needle: join("bundle"),
    matchName: (name) =>
      name.endsWith(".AppImage") || name.endsWith(".deb"),
  },
  // Deb-only smoke (skips linuxdeploy / AppImage). Same TMPDIR handling.
  deb: {
    host: "linux",
    hostLabel: "Linux",
    args: ["--bundles", "deb"],
    outHint: "src-tauri/target/**/bundle/deb/",
    needle: join("bundle", "deb"),
    matchName: (name) => name.endsWith(".deb"),
  },
};

function usage(exitCode = 0) {
  console.log(`Build a Spiral installer for the current OS.

Usage:
  npm run release -- installer [dmg|nsis|linux|deb] [-- <tauri build args>]

Defaults to the native installer for this machine (${process.platform}).
Cross-OS builds are not supported (need a Mac for DMG, Windows for NSIS,
Linux for AppImage/deb).
`);
  process.exit(exitCode);
}

function nativeKind() {
  if (process.platform === "darwin") return "dmg";
  if (process.platform === "win32") return "nsis";
  if (process.platform === "linux") return "linux";
  console.error(`Unsupported host platform: ${process.platform}`);
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
    console.error(
      `Unknown installer kind: ${kind} (expected dmg, nsis, linux, or deb)`,
    );
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
  const spec = BUNDLES[kind];
  const bundleRoot = join(root, "src-tauri", "target");
  const installers = listNewestUnder(bundleRoot, spec.matchName).filter((f) =>
    f.includes(spec.needle),
  );

  if (installers.length === 0) {
    console.log(`\nLook for output under ${spec.outHint}`);
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
    `Cannot build ${kind} on ${process.platform} — need ${spec.hostLabel}.`,
  );
  process.exit(1);
}

const tauriArgs = ["run", "tauri", "--", "build", ...spec.args, ...passthrough];
console.log(`$ npm ${tauriArgs.join(" ")}`);

const env = { ...process.env };
if (spec.host === "linux") {
  // linuxdeploy is an AppImage; force extract-and-run when FUSE is missing.
  if (kind !== "deb" && !env.APPIMAGE_EXTRACT_AND_RUN) {
    env.APPIMAGE_EXTRACT_AND_RUN = "1";
  }
  // Prefer disk-backed temp: /tmp may be tmpfs with usrquota (EDQUOT while df shows free).
  if (!env.TMPDIR) {
    const tmp = join(root, "src-tauri", "target", "tmp");
    mkdirSync(tmp, { recursive: true });
    env.TMPDIR = tmp;
    env.TMP = tmp;
    env.TEMP = tmp;
    console.log(`TMPDIR=${tmp}`);
  }
}

const result = spawnSync("npm", tauriArgs, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

printArtifacts(kind);
