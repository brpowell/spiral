#!/usr/bin/env node
/**
 * Download and verify the pinned libmp3lame shared library from
 * spiral-powered/native-lame. Host triple by default; pass --target <triple>.
 *
 * Requires `gh` with `contents: read` on that private repo (`gh auth login`).
 * Does not compile LAME. Checksum mismatch or a missing asset fails loud.
 *
 * Invoked by `npm run bootstrap` (optionally `-- --target <triple>`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const lockPath = path.join(root, "src-tauri/native/lame.lock.json");
const extractRoot = path.join(root, "src-tauri/native/lame");
const stampName = ".native-lame-sha256";

function usage(code = 0) {
  console.log(`Fetch the pinned libmp3lame shared library.

Usage:
  node scripts/native-lame.mjs
  node scripts/native-lame.mjs --target <rustc-triple>

Needs \`gh\` authenticated to spiral-powered/native-lame (contents: read).
`);
  process.exit(code);
}

function parseArgs(argv) {
  /** @type {{ target: string | null, help: boolean }} */
  const out = { target: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg === "--target") {
      out.target = argv[++i] ?? "";
      if (!out.target) {
        console.error("--target requires a rustc triple");
        process.exit(1);
      }
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(1);
    }
  }
  return out;
}

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = out.match(/^host:\s+(\S+)/m);
  if (!match) {
    console.error("could not parse host triple from rustc -vV");
    process.exit(1);
  }
  return match[1];
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function alreadyFetched(destDir, expectedSha) {
  const stamp = path.join(destDir, stampName);
  if (!fs.existsSync(stamp)) return false;
  return fs.readFileSync(stamp, "utf8").trim() === expectedSha;
}

function runtimeLibName(rustcTriple) {
  if (rustcTriple.includes("apple-darwin")) return "libmp3lame.0.dylib";
  if (rustcTriple.includes("windows")) return "libmp3lame.dll";
  return "libmp3lame.so.0";
}

/** Stable path referenced by tauri.*.conf.json (triple dir stays the link/search root). */
function stageRuntime(fromDir, rustcTriple) {
  const name = runtimeLibName(rustcTriple);
  const src = path.join(fromDir, name);
  if (!fs.existsSync(src)) {
    console.error(`missing ${name} in ${path.relative(root, fromDir)}`);
    process.exit(1);
  }
  const runtimeDir = path.join(extractRoot, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (const entry of fs.readdirSync(runtimeDir)) {
    fs.rmSync(path.join(runtimeDir, entry), { recursive: true, force: true });
  }
  fs.copyFileSync(src, path.join(runtimeDir, name));
}

function runGh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    console.error(detail || `gh ${args.join(" ")} failed`);
    console.error(
      "Need `gh` with contents: read on spiral-powered/native-lame (`gh auth login`).",
    );
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

/** native-lame ships `.zip`. GNU tar (Linux CI) cannot extract zip; BSD tar can. */
function extractZip(zipPath, destDir) {
  const unzip = spawnSync("unzip", ["-o", "-q", zipPath, "-d", destDir], {
    encoding: "utf8",
  });
  if (unzip.error?.code !== "ENOENT") {
    if (unzip.status === 0) return;
    console.error((unzip.stderr || unzip.stdout || "unzip failed").trim());
    process.exit(unzip.status ?? 1);
  }

  const tar = spawnSync("tar", ["-xf", zipPath, "-C", destDir], {
    encoding: "utf8",
  });
  if (tar.status !== 0) {
    console.error(
      (
        tar.stderr ||
        tar.stdout ||
        tar.error?.message ||
        "zip extract failed (need unzip, or bsdtar)"
      ).trim(),
    );
    process.exit(tar.status ?? 1);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) usage(0);

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const triple = args.target || hostTriple();
const spec = lock.triples[triple];
if (!spec) {
  console.error(
    `no libmp3lame pin for triple ${triple} in ${path.relative(root, lockPath)}`,
  );
  process.exit(1);
}

const destDir = path.join(extractRoot, triple);
if (alreadyFetched(destDir, spec.sha256)) {
  stageRuntime(destDir, triple);
  console.log(`libmp3lame ${triple} already fetched (${lock.tag})`);
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "native-lame-"));
const zipPath = path.join(tmp, spec.asset);
try {
  runGh([
    "release",
    "download",
    lock.tag,
    "--repo",
    lock.repo,
    "--pattern",
    spec.asset,
    "--dir",
    tmp,
  ]);
  if (!fs.existsSync(zipPath)) {
    console.error(`gh did not download ${spec.asset}`);
    process.exit(1);
  }
  const digest = sha256File(zipPath);
  if (digest !== spec.sha256) {
    console.error(
      `checksum mismatch for ${spec.asset}: got ${digest}, expected ${spec.sha256}`,
    );
    process.exit(1);
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  extractZip(zipPath, destDir);
  fs.writeFileSync(path.join(destDir, stampName), `${spec.sha256}\n`);
  stageRuntime(destDir, triple);
  console.log(`fetched libmp3lame ${triple} from ${lock.repo}@${lock.tag}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
