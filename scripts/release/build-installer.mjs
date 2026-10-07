#!/usr/bin/env node
/**
 * Build a platform installer locally (same bundle flags as CI).
 *
 * Usage:
 *   npm run release -- installer              # native for this machine
 *   npm run release -- installer --dev-license  # release profile, development license pubkey
 *   npm run release:dev                       # same as installer --dev-license
 *   npm run release -- installer dmg
 *   npm run release -- installer nsis
 *   npm run release -- installer linux        # AppImage (v1 Direct)
 *   npm run release -- installer deb          # deb only (optional later, #333)
 *   npm run release -- installer dmg -- --target aarch64-apple-darwin
 *
 * Extra args after `--` are passed to `tauri build`.
 * Fetches pinned libmp3lame (`npm run bootstrap`; needs `gh` + lockfile).
 * Apple/Windows code signing is optional. Updater signing env vars
 * (`TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD`, same as CI) are required
 * because `bundle.createUpdaterArtifacts` is enabled — without them the
 * build fails when producing updater sidecars (.app.tar.gz / AppImage .sig).
 *
 * See docs/release.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
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
    args: ["--bundles", "appimage"],
    outHint: "src-tauri/target/**/bundle/appimage/",
    needle: join("bundle", "appimage"),
    matchName: (name) => name.endsWith(".AppImage"),
  },
  // Optional .deb smoke (#333). Same TMPDIR handling; skips linuxdeploy.
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
  npm run release -- installer [dmg|nsis|linux|deb] [--dev-license] [-- <tauri build args>]
  npm run release:dev [-- dmg|nsis|linux|deb] [-- <tauri build args>]

Defaults to the native installer for this machine (${process.platform}).
--dev-license embeds the development Spiral Card public key (Cargo feature
license-dev-key) so a packaged build accepts sandbox-issued cards.
Cross-OS builds are not supported (need a Mac for DMG, Windows for NSIS,
Linux for AppImage).
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

function targetFromPassthrough(passthrough) {
  const eq = passthrough.find((a) => a.startsWith("--target="));
  if (eq) return eq.slice("--target=".length);
  const i = passthrough.indexOf("--target");
  if (i >= 0) {
    const value = passthrough[i + 1];
    if (!value || value.startsWith("-")) {
      console.error("--target requires a rustc triple");
      process.exit(1);
    }
    return value;
  }
  return null;
}

function parseArgs(argv) {
  const dash = argv.indexOf("--");
  const before = dash === -1 ? argv : argv.slice(0, dash);
  const passthrough = dash === -1 ? [] : argv.slice(dash + 1);

  if (before.includes("-h") || before.includes("--help")) usage(0);

  const unknownFlags = before.filter(
    (a) => a.startsWith("-") && a !== "--dev-license",
  );
  if (unknownFlags.length > 0) {
    console.error(`Unknown flag: ${unknownFlags[0]}`);
    usage(1);
  }

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
  return { kind, passthrough, devLicense: before.includes("--dev-license") };
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

const { kind, passthrough, devLicense } = parseArgs(process.argv.slice(2));
const spec = BUNDLES[kind];

if (process.platform !== spec.host) {
  console.error(
    `Cannot build ${kind} on ${process.platform} — need ${spec.hostLabel}.`,
  );
  process.exit(1);
}

const lameTarget = targetFromPassthrough(passthrough);
const bootstrapArgs = ["run", "bootstrap"];
if (lameTarget) {
  bootstrapArgs.push("--", "--target", lameTarget);
}
console.log(`$ npm ${bootstrapArgs.join(" ")}`);
const boot = spawnSync("npm", bootstrapArgs, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (boot.error) {
  console.error(boot.error.message);
  process.exit(1);
}
if (boot.status !== 0) {
  process.exit(boot.status ?? 1);
}

const tauriPassthrough = [...passthrough];
const usesDevLicenseKey =
  devLicense || tauriPassthrough.some((a) => a.includes("license-dev-key"));
if (devLicense && !tauriPassthrough.some((a) => a.includes("license-dev-key"))) {
  tauriPassthrough.unshift("--features", "license-dev-key");
}

const tauriArgs = [
  "run",
  "tauri",
  "--",
  "build",
  ...spec.args,
  ...tauriPassthrough,
];
console.log(`$ npm ${tauriArgs.join(" ")}`);

const env = { ...process.env };
// --ci keys need an explicit empty password or tauri-bundler prompts on a TTY
// and hangs (same as sign-updater.mjs). createUpdaterArtifacts is always on.
if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
}
// Harden the shipped binary against trivial reverse engineering. `strip = true`
// in [profile.release] drops the symbol table; these release-only rustc flags
// remove the remaining low-effort intelligence:
//   --remap-path-prefix        rewrites build-machine paths (home, cargo
//                              registry) still embedded by panic messages and
//                              some crates. Done here rather than via the
//                              `trim-paths` profile option, which is not
//                              stabilized in the pinned Cargo.
//   -Zlocation-detail=none     drops file!/line!/column! from panic Location
//                              metadata, which otherwise leaks the crate's own
//                              module tree (e.g. src/license/*.rs).
// -Zlocation-detail is nightly-gated; RUSTC_BOOTSTRAP=1 unlocks it on the pinned
// stable toolchain. It applies only to release bundling, never to `cargo test`.
// (-Zfmt-debug=none was evaluated for broader string stripping but breaks
// generated-code deps such as web_atoms; targeted obfuscation is used instead.)
// Prepended so an explicit RUSTFLAGS from the environment still wins.
{
  const home = homedir();
  const flags = [`--remap-path-prefix=${home}=~`];
  if (env.CARGO_HOME) {
    flags.unshift(`--remap-path-prefix=${env.CARGO_HOME}=/cargo`);
  }
  flags.push("-Zlocation-detail=none");
  env.RUSTC_BOOTSTRAP = env.RUSTC_BOOTSTRAP ?? "1";
  env.RUSTFLAGS = [...flags, env.RUSTFLAGS].filter(Boolean).join(" ");
}
if (usesDevLicenseKey) {
  env.SPIRAL_LICENSE_DEV_KEY = "1";
}
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
  const lameRuntime = join(root, "src-tauri", "native", "lame", "runtime");
  env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
    ? `${lameRuntime}:${env.LD_LIBRARY_PATH}`
    : lameRuntime;
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

const check = spawnSync(
  process.execPath,
  [join(root, "scripts", "release", "check-bundle.mjs")],
  { cwd: root, stdio: "inherit", env },
);
if (check.status !== 0) {
  process.exit(check.status ?? 1);
}
