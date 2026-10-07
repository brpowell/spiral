#!/usr/bin/env node
/**
 * Tauri `beforeBundleCommand` hook.
 *
 * Runs after the binary is compiled but BEFORE it is wrapped into .app/.dmg, so
 * the self-hash guards are patched into the binary that every bundled artifact
 * (and the .dmg's copy) carries, and Tauri's own code-signing then covers the
 * patched bytes — the correct order for ad-hoc now and Developer ID once
 * enrolled, with no change needed here.
 *
 * macOS-only: the patcher uses otool/codesign. On Windows/Linux this is a clean
 * no-op so those bundles pass through untouched (their guards come later).
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const targetRoot = join(root, "src-tauri", "target");
const PRODUCT = "Spiral";

// The encrypted-frontend resource must EXIST for every platform/build because
// tauri.conf lists it in bundle.resources. When encryption is off (default) or
// unsupported (non-macOS), ship a sentinel that is NOT a valid container, so the
// runtime finds no decryptable frontend and loads the embedded one as usual.
const genDir = join(root, "src-tauri", "generated");
const frontendResource = join(genDir, "frontend.spe");
function writeSentinel() {
  mkdirSync(genDir, { recursive: true });
  writeFileSync(frontendResource, Buffer.from("SPIRAL_FRONTEND_OFF\n"));
}

// Integrity-keyed frontend is opt-in and macOS-only for now (it keys off the
// Mach-O __text the guards cover). Default off → normal embedded frontend.
const ENCRYPT = process.env.SPIRAL_ENCRYPT_FRONTEND === "1" && process.platform === "darwin";

if (process.platform !== "darwin") {
  writeSentinel(); // keep the resource present; guard patcher is macOS-only
  process.exit(0);
}

// Candidate locations for the just-compiled binary (per-arch or host triple).
const triple = process.env.TAURI_ENV_TARGET_TRIPLE;
const candidates = [];
if (triple) candidates.push(join(targetRoot, triple, "release", PRODUCT));
candidates.push(join(targetRoot, "release", PRODUCT));
for (const t of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
  candidates.push(join(targetRoot, t, "release", PRODUCT));
}

const MACHO_MAGICS = new Set([0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe]);
function isThinMachO(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const b = Buffer.alloc(4);
    readSync(fd, b, 0, 4, 0);
    return MACHO_MAGICS.has(b.readUInt32BE(0)) || MACHO_MAGICS.has(b.readUInt32LE(0));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Pick the newest existing thin Mach-O candidate (the one this build produced).
let bin = null;
let best = -1;
for (const p of candidates) {
  let st;
  try {
    st = statSync(p);
  } catch {
    continue;
  }
  if (!isThinMachO(p)) continue; // skip fat/universal or non-Mach-O
  if (st.mtimeMs > best) {
    best = st.mtimeMs;
    bin = p;
  }
}

if (!bin) {
  // No thin macOS binary to patch (e.g. a universal/fat build, or the binary
  // isn't where expected). Don't block bundling; warn loudly so it's visible.
  console.warn(
    "before-bundle: no thin macOS binary found to patch — guards NOT applied to this build",
  );
  process.exit(0);
}

const patcher = join(root, "scripts", "release", "patch-guards.mjs");
try {
  execFileSync("node", [patcher, bin], { stdio: "inherit" });
} catch (err) {
  // A genuine macOS patch failure is a real problem (guards would ship inert);
  // fail the build so it is caught rather than silently shipping unprotected.
  console.error(`before-bundle: guard patch FAILED for ${bin}`);
  process.exit(err.status || 1);
}

// Integrity-keyed frontend: encrypt the built frontend under key = SHA-256 of
// the (now final) binary's __text, into the bundle resource. Must run AFTER
// patch-guards so the shipped binary is final. Off by default → sentinel.
if (!ENCRYPT) {
  writeSentinel();
  console.log("before-bundle: frontend encryption off (sentinel resource written)");
} else {
  // stage-frontend.mjs moves the real bundle to dist-plain/ and stubs dist/
  // so the embedded frontend is not plaintext. There is no fallback: encrypting
  // dist/ would ship that same plaintext inside the binary.
  const distPlain = join(root, "dist-plain");
  if (!existsSync(distPlain)) {
    console.error(
      "before-bundle: SPIRAL_ENCRYPT_FRONTEND=1 but dist-plain/ is missing — stage-frontend did not run",
    );
    process.exit(1);
  }
  const encScript = join(root, "scripts", "release", "encrypt-frontend.mjs");
  mkdirSync(genDir, { recursive: true });
  try {
    execFileSync("node", [encScript, bin, distPlain, frontendResource], { stdio: "inherit" });
  } catch (err) {
    console.error(`before-bundle: frontend encryption FAILED for ${bin}`);
    process.exit(err.status || 1);
  }
}
