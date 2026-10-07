#!/usr/bin/env node
/**
 * Post-bundle smoke gate for the integrity-keyed frontend (anti-tamper).
 *
 *   node scripts/release/verify-encrypted-build.mjs [path/to/Spiral.app]
 *
 * Launches the BUILT .app, confirms it derives the key from its own __text,
 * decrypts `frontend.spe`, and actually serves the real UI over `spiralfe://`,
 * then exits 0. Exits NON-ZERO if an encrypted build fails to boot its UI — so a
 * broken-encryption build (bad key, bad container, bad pipeline step) can never
 * ship silently. This is the false-positive safety net for the whole scheme.
 *
 * Run it AFTER `tauri build` (it needs the bundled .app; it cannot run inside
 * before-bundle, which fires before the app exists). macOS + a GUI session only
 * (it launches a real window); a non-macOS or non-encrypted build is a clean
 * pass with a note. The launched app is told SPIRAL_FE_TRACE=1 so it reports its
 * decrypt + per-asset serving; shipping builds set no such var and stay silent.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function die(msg) {
  console.error(`verify-encrypted-build: ${msg}`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  console.log("verify-encrypted-build: non-macOS — skipping (encryption is macOS-only for now)");
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function findApp() {
  if (process.argv[2]) return process.argv[2];
  return [
    "src-tauri/target/release/bundle/macos/Spiral.app",
    "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Spiral.app",
    "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Spiral.app",
  ]
    .map((p) => join(root, p))
    .find(existsSync);
}

const app = findApp();
if (!app || !existsSync(app)) die("no Spiral.app found — build it first");
const bin = join(app, "Contents/MacOS/Spiral");
const spe = join(app, "Contents/Resources/frontend.spe");
if (!existsSync(bin)) die(`no executable at ${bin}`);

// A non-encrypted build ships the sentinel resource — nothing to verify.
const magic = existsSync(spe) ? readFileSync(spe).subarray(0, 4).toString("latin1") : "";
if (magic !== "SPE1") {
  console.log("verify-encrypted-build: not an encrypted build (sentinel resource) — nothing to verify");
  process.exit(0);
}

console.log(`verify-encrypted-build: launching ${app} …`);
const child = spawn(bin, [], { env: { ...process.env, SPIRAL_FE_TRACE: "1" } });
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
child.on("error", (e) => die(`could not launch: ${e.message}`));

// Boot is proven when the app reports it decrypted the bundle AND served the
// real entry point + the JS over the custom scheme (i.e. the webview ran it).
const RE_ACTIVE = /frontend_crypt: active \((\d+) files\)/;
const RE_HTML = /serve index\.html -> 200/;
const RE_JS = /serve assets\/\S+\.js -> 200/;
const RE_FAIL = /did not decrypt|__text region unavailable/;

const deadline = Date.now() + 15000;
const poll = setInterval(() => {
  const booted = RE_ACTIVE.test(out) && RE_HTML.test(out) && RE_JS.test(out);
  const failed = RE_FAIL.test(out);
  if (booted || failed || Date.now() > deadline) {
    clearInterval(poll);
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may already have exited.
    }
    try {
      execFileSync("osascript", ["-e", 'quit app "Spiral"'], { stdio: "ignore" });
    } catch {
      // App may already have quit.
    }
    if (booted) {
      console.log(`verify-encrypted-build: PASS — decrypted and served the UI (${out.match(RE_ACTIVE)[1]} files)`);
      process.exit(0);
    }
    console.error("verify-encrypted-build: FAIL — the encrypted UI did not boot.");
    const seen = out.split("\n").filter((l) => l.includes("frontend_crypt"));
    console.error(seen.length ? seen.join("\n") : "(no frontend_crypt output — check the build)");
    process.exit(1);
  }
}, 500);
