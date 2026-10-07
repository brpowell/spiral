#!/usr/bin/env node
/**
 * Integrity-keyed frontend encryptor (anti-tamper).
 *
 *   node scripts/release/encrypt-frontend.mjs <macho-binary> <dist-dir> <out-file>
 *   node scripts/release/encrypt-frontend.mjs --selftest
 *
 * Derives key = SHA-256(__TEXT,__text of <binary>) — the SAME region the
 * self-hash guards cover and that patch-guards wrote into G_OFF/G_LEN — then
 * encrypts every file under <dist-dir> into a single container <out-file> that
 * the Rust `frontend_crypt` module decrypts at runtime after re-deriving the
 * same key from its own code. A binary whose __text was patched yields a
 * different key and cannot decrypt the bundle.
 *
 * Run AFTER patch-guards (so the shipped binary is final) and BEFORE bundling
 * (so the container is copied into the .app as a resource). macOS-only for now
 * (uses otool), matching patch-guards.
 *
 * Container: "SPE1" | u32 LE manifest_len | enc(manifest JSON, stream 0)
 *            | enc(file_0, stream 1) | enc(file_1, stream 2) | ...
 * Keystream block i of a stream: SHA-256(key ‖ LE32(stream_id) ‖ LE64(i)).
 * The cipher + vectors are mirrored byte-for-byte in src/frontend_crypt.rs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";

const MAGIC = Buffer.from("SPE1", "ascii");

function die(msg) {
  console.error(`encrypt-frontend: ${msg}`);
  process.exit(1);
}

// ── cipher (mirrors src/frontend_crypt.rs) ─────────────────────────────────
function keystreamBlock(key, streamId, block) {
  const h = createHash("sha256");
  h.update(key);
  const n = Buffer.alloc(12);
  n.writeUInt32LE(streamId >>> 0, 0);
  n.writeBigUInt64LE(BigInt(block), 4);
  h.update(n);
  return h.digest();
}

function xorStream(key, streamId, data) {
  let block = 0n;
  for (let off = 0; off < data.length; off += 32) {
    const ks = keystreamBlock(key, streamId, block);
    const n = Math.min(32, data.length - off);
    for (let i = 0; i < n; i++) data[off + i] ^= ks[i];
    block += 1n;
  }
  return data;
}

// ── __text region (mirrors patch-guards textSection) ───────────────────────
function textSection(bin) {
  const out = execFileSync("otool", ["-l", bin], { encoding: "utf8" });
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "sectname __text") {
      const win = lines.slice(i, i + 8).map((l) => l.trim());
      if (!win.some((l) => l === "segname __TEXT")) continue;
      const size = win.find((l) => l.startsWith("size "));
      const offset = win.find((l) => l.startsWith("offset "));
      if (!size || !offset) die("could not read __text size/offset");
      return {
        size: Number(BigInt(size.split(/\s+/)[1])),
        offset: Number(offset.split(/\s+/)[1]),
      };
    }
  }
  die("no __TEXT,__text section found");
}

function deriveKey(bin) {
  const buf = readFileSync(bin);
  const { offset, size } = textSection(bin);
  if (offset + size > buf.length) die("__text extends past EOF");
  return createHash("sha256").update(buf.subarray(offset, offset + size)).digest();
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".txt": "text/plain",
};
function mimeFor(path) {
  return MIME[extname(path).toLowerCase()] || "application/octet-stream";
}

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, acc);
    else acc.push(relative(base, full).split(sep).join("/"));
  }
  return acc;
}

/** Build the encrypted container buffer from a dist dir, keyed by the binary. */
export function encryptFrontend(bin, distDir) {
  const key = deriveKey(bin);
  const paths = walk(distDir).sort();
  if (paths.length === 0) die(`no files under ${distDir}`);

  const manifest = [];
  const segments = [];
  paths.forEach((p, idx) => {
    const data = readFileSync(join(distDir, p));
    manifest.push({ p, len: data.length, ct: mimeFor(p) });
    segments.push(xorStream(key, idx + 1, Buffer.from(data))); // stream 1..
  });

  const manifestPlain = Buffer.from(JSON.stringify(manifest), "utf8");
  const manifestEnc = xorStream(key, 0, Buffer.from(manifestPlain)); // stream 0
  const header = Buffer.alloc(8);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(manifestEnc.length, 4);
  return { bundle: Buffer.concat([header, manifestEnc, ...segments]), count: paths.length };
}

// ── self-test: the shared vectors must match src/frontend_crypt.rs ─────────
function selftest() {
  const ks = keystreamBlock(Buffer.alloc(32, 0), 0, 0).toString("hex");
  const want1 = "85759b3811ff7dc47b03792ac85317be51431a3f9e01dcafce317ed736a391b0";
  if (ks !== want1) die(`keystream vector mismatch: ${ks}`);
  const key2 = createHash("sha256").update("spiral-key").digest();
  if (key2.toString("hex") !== "a3edd81c5d9654097953e3f0fbd2d88a9753eac6fff20c0c63b3eeb1c45831a2")
    die("key2 vector mismatch");
  const ct = xorStream(key2, 7, Buffer.from("spiral", "utf8")).toString("hex");
  if (ct !== "d7751e0a52d7") die(`xor vector mismatch: ${ct}`);
  console.log("encrypt-frontend: self-test OK (vectors match frontend_crypt.rs)");
}

const argv = process.argv.slice(2);
if (argv[0] === "--selftest") {
  selftest();
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  selftest(); // always verify the cipher before using it
  const [bin, distDir, outFile] = argv;
  if (!bin || !distDir || !outFile)
    die("usage: encrypt-frontend.mjs <binary> <dist-dir> <out-file>");
  const { bundle, count } = encryptFrontend(bin, distDir);
  writeFileSync(outFile, bundle);
  console.log(
    `encrypt-frontend: ${count} files → ${outFile} (${bundle.length} bytes), key=SHA-256(__text)`,
  );
}
